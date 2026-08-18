// dsh-installer — smoke test. Runs offline, no real server, no network.
//   node src/smoke.mjs
// Verifies profile assembly (files + junction links + idempotence) and the
// ready-line/loopback parsing the launcher depends on.

import { mkdtemp, mkdir, realpath, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  assembleDesktopProfile,
  isPathInside,
  spliceManagedPatch,
} from './assemble-profile.mjs'
import { parseDshReadyUrl, validateLoopbackUrl } from './runtime-controller.mjs'

let failures = 0
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ok  ${name}`)
  } else {
    failures += 1
    console.error(`  FAIL ${name}${detail ? ` :: ${detail}` : ''}`)
  }
}

async function makeStubPackage(root, packageName) {
  const dir = join(root, ...packageName.split('/'))
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), `${JSON.stringify({ name: packageName, version: '0.0.0' }, null, 2)}\n`)
  await writeFile(join(dir, 'index.js'), 'export const name = "stub"\n')
}

async function main() {
  const base = await mkdtemp(join(tmpdir(), 'dsh-installer-smoke-'))
  try {
    // --- ready-line / loopback parsing ---
    console.log('ready-line parsing')
    check('accepts 127.0.0.1 http', parseDshReadyUrl('dsh web: http://127.0.0.1:34567/') === 'http://127.0.0.1:34567/')
    check('accepts localhost', (() => { try { return parseDshReadyUrl('dsh web: http://localhost:3080/') === 'http://localhost:3080/' } catch { return false } })())
    let rejected = false
    try { validateLoopbackUrl('http://evil.example/x') } catch { rejected = true }
    check('rejects non-loopback host', rejected)
    rejected = false
    try { validateLoopbackUrl('http://127.0.0.1:1234@x/') } catch { rejected = true }
    check('rejects embedded credentials', rejected)
    check('ignores unrelated lines', parseDshReadyUrl('[boot] loading plugins') === undefined)

    // --- patch splicing ---
    console.log('managed patch splice')
    const first = spliceManagedPatch('')
    check('seeded from empty', first.includes('# --- dsh-installer managed'))
    check('seeded ends with marker', first.includes('# --- end dsh-installer managed ---'))
    const withUser = spliceManagedPatch(`${first}\n- id: my-user-row\n  config: { a: 1 }\n`)
    check('preserves user lines after managed block', withUser.includes('- id: my-user-row'))
    check('managed block not duplicated', withUser.split('# --- dsh-installer managed').length === 2)

    // --- assembly ---
    console.log('profile assembly')
    const src = join(base, 'src')
    const stubA = join(src, '@deepseek-ai', 'dsh-base')
    const stubB = join(src, '@acme', 'dsh-my-plugin')
    await makeStubPackage(src, '@deepseek-ai/dsh-base')
    await makeStubPackage(src, '@acme/dsh-my-plugin')

    const dshHome = join(base, 'home')
    const managedBundles = ['@deepseek-ai/dsh-base', '@acme/dsh-my-plugin']
    const packageRoots = new Map([
      ['@deepseek-ai/dsh-base', stubA],
      ['@acme/dsh-my-plugin', stubB],
    ])

    const firstRun = await assembleDesktopProfile({ dshHome, packageRoots, managedBundles })
    check('created package.json', (await realpath(join(firstRun.profileDir, 'package.json'))).length > 0)
    const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(join(firstRun.profileDir, 'package.json'), 'utf8'))
    check('bundles listed in order', JSON.stringify(manifest.dsh.profile.bundles) === JSON.stringify(managedBundles))
    check('deps use link:', Object.entries(manifest.dependencies).every(([, v]) => v.startsWith('link:')))
    const linkedTarget = await realpath(join(firstRun.profileDir, 'node_modules', '@deepseek-ai', 'dsh-base'))
    const sourceReal = await realpath(stubA)
    check('node_modules link resolves to source', linkedTarget === sourceReal, `${linkedTarget} != ${sourceReal}`)

    const secondRun = await assembleDesktopProfile({ dshHome, packageRoots, managedBundles, userPatch: '' })
    check('second run is a no-op', secondRun.changed === false)

    check('isPathInside sanity', isPathInside(base, join(base, 'home', 'profiles')) && !isPathInside(base, 'C:\\other'))

    console.log(failures === 0 ? '\nPASS: dsh-installer smoke clean' : `\nFAIL: ${failures} check(s) failed`)
    process.exit(failures === 0 ? 0 : 1)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
