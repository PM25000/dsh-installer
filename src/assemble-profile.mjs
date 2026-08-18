// dsh-installer — runtime profile assembly.
//
// Creates a runnable dsh profile under $DSH_HOME/profiles/<name> and links the
// bundled plugin package roots into its node_modules without re-installing
// anything (offline, zero network). This is the "runtime assembly" idea drawn
// from third-party/deepseek-harness-desktop/profile.mjs#ensureDesktopProfile,
// written here as a small self-contained skeleton.
//
// Layout produced:
//   <dshHome>/profiles/<name>/
//     package.json         # profile manifest: deps (link:...) + dsh.profile.bundles
//     cordis.yml           # '[]\n' root
//     cordis.patch.yml     # managed defaults + user-provided overlay
//     pnpm-workspace.yaml  # nodeLinker=hoisted, allowBuilds placeholder
//     node_modules/<pkg>/  # junction (win32) / dir-symlink / copy of each root
//     .dsh-assembly.json   # link records (mode + source) for idempotent refresh

import {
  cp, lstat, mkdir, readFile, readlink, realpath, rename, rm, symlink, writeFile,
} from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'

export const MANAGED_PATCH_START = '# --- dsh-installer managed (do not edit) ---'
export const MANAGED_PATCH_END = '# --- end dsh-installer managed ---'

// Default managed patch layer. Extend here with per-plugin defaults that must
// ship with every install (llm retry policy, plugin config seeds, ...).
// The native Win32 directory dialog spawns a worker via process.execPath which
// fails in the packaged Electron-as-Node app, so disable it and use the browser
// browse variant (mirrors deepseek-harness-desktop).
export const MANAGED_PATCH_CONFIG = `${MANAGED_PATCH_START}
- id: directory-picker
  name: '@deepseek-ai/dsh-host-directory-picker-auto'
  disabled: true
- insert:
    - id: directory-picker-desktop-host
      name: '@deepseek-ai/dsh-host-directory-picker-browse'
    - id: directory-picker-desktop-client
      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'
- id: llm-deepseek
  config:
    retryPolicy:
      mode: normal
      maxRetries: 4
      retryableCodes:
        - EMPTY_RESPONSE
        - RATE_LIMIT
        - SERVER
        - TIMEOUT
        - TRANSPORT
        - STREAM_CLOSED
      backoff:
        initialDelayMs: 750
        maxDelayMs: 15000
        jitterRatio: 0.15
${MANAGED_PATCH_END}
`

const ROOT_CONFIG = '[]\n'
const WORKSPACE_CONFIG = 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n'

export function packagePathSegments(packageName) {
  if (typeof packageName !== 'string' || packageName.length === 0 || packageName.includes('..')) {
    throw new TypeError(`invalid package name: ${JSON.stringify(packageName)}`)
  }
  return packageName.split('/')
}

async function readJsonIfPresent(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }
}

async function writeIfChanged(path, content) {
  try {
    if ((await readFile(path, 'utf8')) === content) return false
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, { encoding: 'utf8' })
  return true
}

async function pathExists(path) {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

/**
 * Link one bundled package root into the profile's node_modules, preferring a
 * junction (win32) or dirent symlink and falling back to a copy when the
 * filesystem refuses links (e.g. restricted dirs). Records the resulting mode.
 */
async function linkManagedPackage({ packageName, profileDir, sourceDir, previous }) {
  const target = join(profileDir, 'node_modules', ...packagePathSegments(packageName))
  await mkdir(dirname(target), { recursive: true })
  if (await pathExists(target)) {
    try {
      if ((await realpath(target)) === (await realpath(sourceDir))) {
        return { changed: false, record: { mode: 'link', source: sourceDir } }
      }
    } catch {
      // not a link; fall through to the copy check
    }
    const installed = await readJsonIfPresent(join(target, 'package.json'))
    if (previous?.mode === 'copy' && previous.source === sourceDir && installed?.name === packageName) {
      return { changed: false, record: previous }
    }
    throw new Error(`refusing to replace unmanaged package at ${target}`)
  }

  try {
    await symlink(sourceDir, target, process.platform === 'win32' ? 'junction' : 'dir')
    return { changed: true, record: { mode: 'link', source: sourceDir } }
  } catch (error) {
    if (!['EACCES', 'EPERM', 'UNKNOWN'].includes(error?.code)) throw error
    await cp(sourceDir, target, { recursive: true, force: false, errorOnExist: true })
    return { changed: true, record: { mode: 'copy', source: sourceDir } }
  }
}

async function retireManagedPackage({ packageName, profileDir, previous }) {
  if (previous === undefined) return false
  const target = join(profileDir, 'node_modules', ...packagePathSegments(packageName))
  let metadata
  try {
    metadata = await lstat(target)
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
  if (previous.mode === 'link' && metadata.isSymbolicLink()) {
    let owned = false
    try {
      owned = (await realpath(target)) === (await realpath(previous.source))
    } catch {
      owned = false
    }
    if (!owned) return false
    await rm(target, { recursive: true, force: true })
    return true
  }
  if (previous.mode === 'copy' && metadata.isDirectory()) {
    const installed = await readJsonIfPresent(join(target, 'package.json'))
    if (installed?.name !== packageName || previous.source === undefined) return false
    await rm(target, { recursive: true, force: true })
    return true
  }
  return false
}

/**
 * Splice the managed patch section into an existing user patch (idempotent).
 * The managed block is replaced in place; the user's own lines are preserved.
 */
export function spliceManagedPatch(existing = '') {
  const start = existing.indexOf(MANAGED_PATCH_START)
  if (start !== -1) {
    const end = existing.indexOf(MANAGED_PATCH_END, start)
    if (end === -1) throw new Error('managed patch section is unterminated')
    const userSuffix = existing.slice(end + MANAGED_PATCH_END.length).trim()
    const body = MANAGED_PATCH_CONFIG.trimEnd()
    return userSuffix ? `${body}\n\n${userSuffix}\n` : `${body}\n`
  }
  const trimmed = existing.trim()
  return trimmed ? `${MANAGED_PATCH_CONFIG.trimEnd()}\n\n${trimmed}\n` : MANAGED_PATCH_CONFIG
}

/**
 * Build the profile manifest for a list of bundles, keeping any community
 * bundles the user already selected (they are not managed by this skeleton).
 */
export function createProfileManifest({ bundles, managedBundles, existing = {} }) {
  const existingBundles = Array.isArray(existing?.dsh?.profile?.bundles) ? existing.dsh.profile.bundles : []
  const community = existingBundles.filter((name) => !managedBundles.includes(name))
  return {
    name: 'dsh-profile-desktop',
    private: true,
    dependencies: { ...(existing?.dependencies ?? {}) },
    dsh: { profile: { bundles: [...managedBundles, ...community] } },
  }
}

/**
 * Assemble (or refresh) the profile under <dshHome>/profiles/<profileName>.
 *
 * @param {object} opts
 * @param {string} opts.dshHome           absolute path to the runtime home
 * @param {Map<string,string>} opts.packageRoots  package name -> source dir (bundled)
 * @param {string[]} opts.managedBundles  ordered bundle layer list (dsh.profile.bundles)
 * @param {string} [opts.profileName]     default 'desktop'
 * @param {string} [opts.userPatch]       existing user patch to preserve
 */
export async function assembleDesktopProfile({
  dshHome,
  packageRoots,
  managedBundles,
  profileName = 'desktop',
  userPatch = '',
}) {
  if (typeof dshHome !== 'string' || dshHome.length === 0) {
    throw new TypeError('dshHome must be a non-empty absolute path')
  }
  const profileDir = join(dshHome, 'profiles', profileName)
  await mkdir(profileDir, { recursive: true })

  const manifestPath = join(profileDir, 'package.json')
  const recordPath = join(profileDir, '.dsh-assembly.json')
  const previousRecords = (await readJsonIfPresent(recordPath)) ?? {}
  const existing = await readJsonIfPresent(manifestPath)
  const manifest = createProfileManifest({ bundles: managedBundles, managedBundles, existing })
  for (const [packageName, sourceDir] of packageRoots) {
    manifest.dependencies[packageName] = `link:${sourceDir.replaceAll('\\', '/')}`
  }
  manifest.dependencies = Object.fromEntries(
    Object.entries(manifest.dependencies).toSorted(([a], [b]) => a.localeCompare(b)),
  )

  let changed = false
  changed = (await writeIfChanged(join(profileDir, 'cordis.yml'), ROOT_CONFIG)) || changed
  changed = (await writeIfChanged(join(profileDir, 'cordis.patch.yml'), spliceManagedPatch(userPatch))) || changed
  changed = (await writeIfChanged(join(profileDir, 'pnpm-workspace.yaml'), WORKSPACE_CONFIG)) || changed
  changed = (await writeIfChanged(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)) || changed

  // Retire only packages that were previously managed but are no longer in the
  // active bundle set (removed plugins). Active ones are handled by the link
  // pass below, so a refresh stays idempotent.
  const active = new Set(packageRoots.keys())
  const toRetire = Object.keys(previousRecords).filter((name) => !active.has(name))
  const retired = await Promise.all(
    toRetire.map((name) =>
      retireManagedPackage({ packageName: name, profileDir, previous: previousRecords[name] })),
  )
  changed = retired.some(Boolean) || changed

  const linked = await Promise.all(
    [...packageRoots.entries()]
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(async ([packageName, sourceDir]) => ({
        packageName,
        result: await linkManagedPackage({
          packageName,
          profileDir,
          sourceDir,
          previous: previousRecords[packageName],
        }),
      })),
  )
  const nextRecords = {}
  for (const { packageName, result } of linked) {
    nextRecords[packageName] = result.record
    changed = result.changed || changed
  }
  changed = (await writeIfChanged(recordPath, `${JSON.stringify(nextRecords, null, 2)}\n`)) || changed

  return { changed, manifest, profileDir }
}

/** Is `child` inside `parent`? */
export function isPathInside(parent, child) {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !rel.includes(':'))
}
