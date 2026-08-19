// dsh-installer — sync bundled plugins from their source builds before packing.
//   node scripts/sync-bundled.mjs
// Copies each bundled plugin's built artifacts (lib/, data/, manifest) from the
// source checkout into bundled/, so `pnpm pack:win` always ships the latest
// build. Edit SOURCES when plugins move or get added.

import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..')

// package (bundled/ subdir) -> how to find its source build.
// Source resolution order:
//   1. env var (e.g. COURSE_SELECTOR_SOURCE=/path/to/course-selector-assistant)
//   2. <project>/plugin-sources/<relative> (a gitignored local checkout dir)
// Copy list selects which built artifacts to ship (the plugin's own build
// outputs, never its sources).
const SOURCES = [
  {
    package: 'dsh-course-selector',
    env: 'COURSE_SELECTOR_SOURCE',
    relative: 'course-selector-assistant',
    copy: ['lib', 'data', 'cordis.patch.yml', 'package.json'],
  },
  {
    package: '@deepseek-ai/dsh-client-ui-wallpaper',
    env: 'WALLPAPER_SOURCE',
    relative: 'deepseek-harness/packages/client/ui-wallpaper',
    copy: ['lib', 'cordis.patch.yml', 'package.json'],
    // Private source: not available on the public CI runners. When the source
    // is missing this plugin is skipped, and config.mjs drops it from the
    // profile (only plugins that shipped in bundled/ are assembled).
    optional: true,
  },
]

function resolveSource(entry) {
  const fromEnv = entry.env ? process.env[entry.env] : undefined
  if (fromEnv && fromEnv.length > 0) return fromEnv
  return join(projectRoot, 'plugin-sources', entry.relative)
}

async function syncEntry(entry) {
  const source = resolveSource(entry)
  const target = join(projectRoot, 'bundled', ...entry.package.split('/'))
  // Optional plugins are skipped (with a warning) when their source is missing,
  // so a public CI build that cannot fetch a private plugin still succeeds.
  const firstFrom = join(source, entry.copy[0])
  try {
    await stat(firstFrom)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    if (entry.optional) {
      console.log(`[sync-bundled] SKIP ${entry.package}: optional source missing (${source})`)
      return null
    }
    throw new Error(
      `sync-bundled: source missing ${firstFrom}\n`
      + `Point ${entry.env ?? entry.relative} at the plugin's built checkout, or place it under `
      + `plugin-sources/${entry.relative}`,
    )
  }
  const stats = []
  for (const item of entry.copy) {
    const from = join(source, item)
    const to = join(target, item)
    await rm(to, { recursive: true, force: true })
    await mkdir(join(target, ...item.split('/').slice(0, -1)), { recursive: true })
    await cp(from, to, { recursive: true, force: true })
    const meta = await stat(from)
    stats.push(`${item} (${meta.mtime.toISOString().slice(0, 19)})`)
  }
  return `${entry.package}: ${stats.join(', ')}`
}

async function main() {
  const targets = []
  for (const entry of SOURCES) {
    const report = await syncEntry(entry)
    if (report === null) continue
    console.log(`[sync-bundled] ${report}`)
    targets.push(join(projectRoot, 'bundled', ...entry.package.split('/')))
  }
  // Sanity: the packed plugin entry points must exist after sync.
  for (const dir of targets) {
    const hasLib = (await readdir(join(dir, 'lib'))).length > 0
    if (!hasLib) throw new Error(`sync-bundled: ${dir}/lib is empty after sync`)
  }
  console.log('[sync-bundled] all bundled plugins synced')
}

main().catch((error) => {
  console.error(error?.message ?? error)
  process.exit(1)
})
