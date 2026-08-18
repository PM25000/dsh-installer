// dsh-installer — CLI entry.
// `node src/main.mjs --assemble-only` : assemble the profile, print layout.
// `node src/main.mjs`                 : assemble + launch dsh web, then open a
//                                       window (Electron) or the system browser
//                                       (plain node) at the ready URL.
//
// This is a skeleton: point `src/config.mjs` at your bundled packages and dsh
// CLI, then run it. No installer yet — M1 validates the assembly + launch path
// in folder form.

import { execFile, execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { assembleDesktopProfile } from './assemble-profile.mjs'
import { DshRuntimeController } from './runtime-controller.mjs'
import { cliArgs, cliPath, dshHome, managedBundles, packageRoots, profileName, workspace } from './config.mjs'

const ASSEMBLE_ONLY = process.argv.includes('--assemble-only')

async function assemble() {
  const result = await assembleDesktopProfile({
    dshHome,
    packageRoots,
    managedBundles,
    profileName,
    userPatch: '',
  })
  console.error(`[assemble] profile=${result.profileDir} changed=${result.changed} bundles=${managedBundles.length}`)
  for (const [name, root] of packageRoots) {
    console.error(`[assemble]   link ${name} <- ${root}`)
  }
  return result
}

function openInBrowser(url) {
  try {
    if (process.platform === 'win32') {
      execFileSync('cmd.exe', ['/c', 'start', '', url], { windowsHide: true, stdio: 'ignore' })
    } else if (process.platform === 'darwin') {
      execFile('open', [url])
    } else {
      execFile('xdg-open', [url])
    }
    console.error(`[launch] opened system browser at ${url}`)
  } catch (error) {
    console.error(`[launch] could not auto-open browser: ${error.message}`)
    console.log(url)
  }
}

async function launch({ cwd, cliPath: cli }) {
  const controller = new DshRuntimeController({
    cliPath: cli,
    cliArgs,
    cwd,
    dshHome,
    profile: profileName,
    autoRestart: true,
  })
  const url = await controller.start()
  console.error(`[launch] dsh web ready at ${url}`)
  return { controller, url }
}

async function main() {
  const result = await assemble()
  if (ASSEMBLE_ONLY) {
    console.log(JSON.stringify({ profileDir: result.profileDir, cliPath, dshHome }, null, 2))
    return
  }
  const { controller, url } = await launch({ cwd: workspace, cliPath })

  const isElectron = Boolean(process.versions.electron)
  if (isElectron) {
    // Electron: host the web UI in a native window (the desktop end state). The
    // skeleton only prints the URL; wiring a BrowserWindow is M2.
    console.log(url)
  } else {
    openInBrowser(url)
  }

  const shutdown = async () => {
    await controller.stop()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((error) => {
  console.error(`[fatal] ${error?.stack ?? error}`)
  process.exit(1)
})
