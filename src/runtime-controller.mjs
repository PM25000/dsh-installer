// dsh-installer — launch dsh web as a child of this executable (which may be an
// Electron binary acting as Node via ELECTRON_RUN_AS_NODE, or plain node.exe),
// with a dynamic port, ready-line parsing, loopback validation, and a health
// probe. Bare-bones port of the essentials from
// third-party/deepseek-harness-desktop/runtime-controller.mjs.

import { execFile, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { delimiter, join } from 'node:path'

export const READY_LINE = /^dsh web:\s+(http:\/\/\S+)/iu
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
export const DEFAULT_STARTUP_TIMEOUT_MS = 120_000

export function validateLoopbackUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new TypeError(`invalid runtime URL: ${JSON.stringify(value)}`)
  }
  if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new TypeError('runtime URL must use loopback HTTP')
  }
  if (url.username || url.password) throw new TypeError('runtime URL must not contain credentials')
  if (!url.port) throw new TypeError('runtime URL must contain an explicit port')
  return `${url.origin}/`
}

export function parseDshReadyUrl(line) {
  const match = READY_LINE.exec(String(line).trim())
  return match === null ? undefined : validateLoopbackUrl(match[1])
}

export async function probeHttpReady(
  url,
  { fetchImpl = fetch, attempts = 30, delayMs = 50, schedule = setTimeout } = {},
) {
  let lastError
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(1_000) })
      if (response.ok) return
      lastError = new Error(`runtime health probe returned HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => schedule(resolve, delayMs))
  }
  throw new Error(`runtime URL did not accept HTTP requests: ${lastError?.message ?? 'unknown error'}`)
}

function createLineReader(onLine) {
  let buffer = ''
  return {
    write(chunk) {
      buffer += chunk.toString('utf8')
      const lines = buffer.split(/\r?\n/u)
      buffer = lines.pop() ?? ''
      for (const line of lines) onLine(line)
    },
    end() {
      if (buffer) onLine(buffer)
      buffer = ''
    },
  }
}

export function terminateChildProcessTree(
  child,
  { platform = process.platform, systemRoot = process.env.SystemRoot, execFileFn = execFile } = {},
) {
  if (!child || child.exitCode !== null) return Promise.resolve()
  if (platform !== 'win32' || !Number.isInteger(child.pid) || child.pid <= 0) {
    child.kill('SIGTERM')
    return Promise.resolve()
  }
  const executable = systemRoot ? join(systemRoot, 'System32', 'taskkill.exe') : 'taskkill.exe'
  return new Promise((resolve, reject) => {
    execFileFn(
      executable,
      ['/PID', String(child.pid), '/T', '/F'],
      { windowsHide: true, timeout: 5_000 },
      (error) => (error ? reject(error) : resolve()),
    )
  })
}

export class DshRuntimeController extends EventEmitter {
  constructor({
    cliPath,
    cwd,
    dshHome,
    profile = 'desktop',
    cliArgs = [],
    executable = process.execPath,
    spawnProcess = spawn,
    startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
    shutdownTimeoutMs = 5_000,
    autoRestart = false,
    probeReady = probeHttpReady,
    schedule = setTimeout,
    terminateProcessTree = terminateChildProcessTree,
  }) {
    super()
    if (!cliPath || !cwd || !dshHome) throw new TypeError('cliPath, cwd, and dshHome are required')
    this.cliPath = cliPath
    this.cwd = cwd
    this.dshHome = dshHome
    this.profile = profile
    this.cliArgs = cliArgs
    this.executable = executable
    this.spawnProcess = spawnProcess
    this.startupTimeoutMs = startupTimeoutMs
    this.shutdownTimeoutMs = shutdownTimeoutMs
    this.autoRestart = autoRestart
    this.probeReady = probeReady
    this.schedule = schedule
    this.terminateProcessTree = terminateProcessTree
    this.child = undefined
    this.readyPromise = undefined
    this.status = Object.freeze({ state: 'stopped', url: undefined, error: undefined })
  }

  #setStatus(details = {}) {
    this.status = Object.freeze({
      state: details.state,
      url: details.url,
      error: details.error,
      pid: this.child?.pid,
    })
    this.emit('status', this.status)
  }

  start() {
    if (this.status.state === 'ready') return Promise.resolve(this.status.url)
    if (this.readyPromise) return this.readyPromise
    this.#setStatus({ state: 'starting' })

    const readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })
    this.readyPromise = readyPromise

    const environment = {
      ...process.env,
      DSH_HOME: this.dshHome,
      DSH_PROFILE: this.profile,
      ELECTRON_RUN_AS_NODE: '1',
    }
    try {
      this.child = this.spawnProcess(
        this.executable,
        ['--expose-internals', ...this.cliArgs, this.cliPath, '--profile', this.profile, '--port', '0'],
        { cwd: this.cwd, env: environment, shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
      )
    } catch (error) {
      this.#failBeforeReady(error)
      return readyPromise
    }

    const stdout = createLineReader((line) => this.#handleLine('stdout', line))
    const stderr = createLineReader((line) => this.#handleLine('stderr', line))
    this.child.stdout?.on('data', (chunk) => stdout.write(chunk))
    this.child.stdout?.on('end', () => stdout.end())
    this.child.stderr?.on('data', (chunk) => stderr.write(chunk))
    this.child.stderr?.on('end', () => stderr.end())
    this.child.once('error', (error) => this.#handleChildError(error))
    this.child.once('exit', (code, signal) => this.#handleExit(code, signal))
    this.startupTimer = this.schedule(() => {
      if (this.status.state !== 'starting') return
      this.#failBeforeReady(new Error(`DSH runtime did not become ready within ${this.startupTimeoutMs}ms`))
      this.child?.kill('SIGKILL')
    }, this.startupTimeoutMs)
    return readyPromise
  }

  async #handleLine(stream, line) {
    if (stream !== 'stdout' || this.status.state !== 'starting') return
    let url
    try {
      url = parseDshReadyUrl(line)
    } catch (error) {
      this.#failBeforeReady(error)
      this.child?.kill('SIGKILL')
      return
    }
    if (url === undefined) return
    try {
      await this.probeReady(url)
    } catch (error) {
      if (this.status.state === 'starting') {
        this.#failBeforeReady(error)
        this.child?.kill('SIGKILL')
      }
      return
    }
    if (this.status.state !== 'starting') return
    this.#clearStartupTimer()
    this.#setStatus({ state: 'ready', url })
    this.resolveReady?.(url)
    this.resolveReady = undefined
    this.rejectReady = undefined
    this.readyPromise = undefined
  }

  #clearStartupTimer() {
    if (this.startupTimer !== undefined) {
      this.schedule.clearTimeout?.(this.startupTimer)
      this.startupTimer = undefined
    }
  }

  #failBeforeReady(error) {
    this.#clearStartupTimer()
    this.#setStatus({ state: 'crashed', error: error.message })
    this.rejectReady?.(error)
    this.resolveReady = undefined
    this.rejectReady = undefined
    this.readyPromise = undefined
  }

  #handleChildError(error) {
    if (this.status.state === 'starting') this.#failBeforeReady(error)
  }

  #handleExit(code) {
    this.#clearStartupTimer()
    const previousState = this.status.state
    this.child = undefined
    if (previousState === 'starting' && this.rejectReady) {
      this.#failBeforeReady(new Error(`DSH runtime exited before readiness with code ${String(code)}`))
      return
    }
    if (previousState !== 'crashed') {
      this.#setStatus({ state: 'crashed', error: `runtime exited with code ${String(code)}` })
    }
    if (this.autoRestart) this.child?.kill?.(undefined) // placeholder; see README for restart policy
  }

  async stop() {
    if (this.status.state === 'stopped') return
    this.#setStatus({ state: 'stopping' })
    const child = this.child
    if (child === undefined || child.exitCode !== null) {
      this.child = undefined
      this.#setStatus({ state: 'stopped' })
      return
    }
    const exited = new Promise((resolve) => {
      this.child.once?.('exit', resolve)
    })
    const forceTimer = setTimeout(() => child.kill('SIGKILL'), this.shutdownTimeoutMs)
    try {
      await this.terminateProcessTree(child)
    } catch {
      child.kill('SIGKILL')
    }
    await exited
    clearTimeout(forceTimer)
    this.child = undefined
    this.#setStatus({ state: 'stopped' })
  }
}
