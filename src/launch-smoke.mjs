// dsh-installer — launch-path integration test (offline, no real dsh, no API key).
//   node src/launch-smoke.mjs
// Spawns a fake "dsh CLI" that prints the ready line and serves HTTP on a
// dynamic port, then drives DshRuntimeController through start -> ready -> stop
// to prove the executable-as-node + ready-line + health-probe flow works.

import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DshRuntimeController } from './runtime-controller.mjs'

const FAKE_CLI = `
import http from 'node:http'
import net from 'node:net'
const probe = net.createServer((s) => s.end())
await new Promise((res) => probe.listen(0, '127.0.0.1', res))
const port = probe.address().port
await new Promise((res) => probe.close(res))
const server = http.createServer((req, res) => { res.writeHead(200); res.end('ok') })
await new Promise((res) => server.listen(port, '127.0.0.1', res))
process.stdout.write('dsh web: http://127.0.0.1:' + port + '/\\n')
// keep alive until killed
setInterval(() => {}, 1000)
`

async function main() {
  const base = await mkdtemp(join(tmpdir(), 'dsh-installer-launch-'))
  let failures = 0
  try {
    const cliPath = join(base, 'fake-cli.mjs')
    await writeFile(cliPath, FAKE_CLI, 'utf8')
    const dshHome = join(base, 'home')
    const controller = new DshRuntimeController({
      cliPath,
      cwd: base,
      dshHome,
      profile: 'desktop',
      executable: process.execPath,
      startupTimeoutMs: 10_000,
      autoRestart: false,
    })
    const url = await controller.start()
    const ok = typeof url === 'string' && /^http:\/\/127\.0\.0\.1:\d+\/$/.test(url)
    if (!ok) {
      failures += 1
      console.error(`  FAIL unexpected ready URL: ${url}`)
    } else {
      console.log(`  ok  started and reached ready at ${url}`)
    }
    await controller.stop()
    if (controller.status.state !== 'stopped') {
      failures += 1
      console.error('  FAIL controller did not stop')
    } else {
      console.log('  ok  stopped cleanly')
    }
    if (failures === 0) {
      console.log('PASS: dsh-installer launch smoke clean')
      process.exit(0)
    }
  } finally {
    await rm(base, { recursive: true, force: true })
  }
  console.error(`FAIL: ${failures} launch check(s) failed`)
  process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
