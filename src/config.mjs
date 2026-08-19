// dsh-installer — configuration. THIS IS THE FILE YOU EDIT.
//
// 1. packageRoots  : the bundled dsh runtime + plugin packages that ship inside
//                    the exe (package name -> directory holding that package).
//                    The runtime bundles (@deepseek-ai/dsh-base, dsh-web-app,
//                    wallpbas) live in node_modules / bundled and are
//                    junction-linked into the assembled profile, so the dsh CLI
//                    can resolve them at boot.
// 2. cliPath        : the dsh runtime CLI entry (its compiled lib/bin.js).
//
// managedBundles is the ordered `dsh.profile.bundles` layer list — base first,
// then the web-app bundle (serves the GUI), then your selected plugins.

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const profileName = 'desktop'

// Isolated data directory, so an installed app never collides with a running
// local harness that uses the default ~/.dsh. An explicit $DSH_HOME still wins.
const defaultHome = process.platform === 'win32'
  ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'dsh-installer', 'data')
  : process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support', 'dsh-installer', 'data')
    : join(homedir(), '.local', 'share', 'dsh-installer', 'data')
export const dshHome = process.env.DSH_HOME || defaultHome

// Working directory the dsh child runs in (its `cwd`).
export const workspace = process.cwd()

// Ordered bundle layer list — base first, then web app, then your plugins.
// Managed bundles that were not actually packed into bundled/ (e.g. a plugin
// whose private source was unavailable at build time) are dropped below, so the
// assembled profile only references what ships in the app.
const ALL_BUNDLES = [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@deepseek-ai/dsh-client-ui-wallpaper',
  'dsh-course-selector',
]

// Root of this project. In the packaged Electron app, node_modules and bundled/
// are asar-unpacked to resources/app.asar.unpacked (real dirs, so junction links
// and module resolution work); `process.resourcesPath` is only defined there.
// Locally (plain node) it is this project directory.
const projectRoot = process.resourcesPath
  ? join(process.resourcesPath, 'app.asar.unpacked')
  : join(import.meta.dirname, '..')

// Candidate package roots: runtime base bundles resolve from node_modules, the
// wallpaper/course-selector plugins ship from bundled/. Only entries whose
// package.json is actually present are linked into the profile.
const candidateRoots = new Map([
  ['@deepseek-ai/dsh-base', join(projectRoot, 'node_modules', '@deepseek-ai', 'dsh-base')],
  ['@deepseek-ai/dsh-web-app', join(projectRoot, 'node_modules', '@deepseek-ai', 'dsh-web-app')],
  ['@deepseek-ai/dsh-host-directory-picker-browse', join(projectRoot, 'node_modules', '@deepseek-ai', 'dsh-host-directory-picker-browse')],
  ['@deepseek-ai/dsh-client-ui-directory-picker-browse', join(projectRoot, 'node_modules', '@deepseek-ai', 'dsh-client-ui-directory-picker-browse')],
  ['@deepseek-ai/dsh-client-ui-wallpaper', join(projectRoot, 'bundled', '@deepseek-ai', 'dsh-client-ui-wallpaper')],
  ['dsh-course-selector', join(projectRoot, 'bundled', 'dsh-course-selector')],
])

export const packageRoots = new Map(
  [...candidateRoots].filter(([, dir]) => existsSync(join(dir, 'package.json'))),
)

// Profile bundle layers, filtered to what actually ships in the app.
export const managedBundles = ALL_BUNDLES.filter((name) => packageRoots.has(name))

// dsh runtime CLI entry — the compiled binary, not source.
export const cliPath = join(projectRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
// Extra args inserted between the executable and cliPath (source-launch only).
export const cliArgs = []
