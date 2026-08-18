// dsh-installer — electron-builder afterPack hook (win32 only).
// Prunes dev material and foreign binaries from the packaged node_modules to
// keep the installer small, then restores the peers the DSH boot graph needs.
// Ported (and slimmed) from
// third-party/deepseek-harness-desktop/apps/dsh-desktop/scripts/after-pack.cjs.

const { cp, mkdir, readdir, rm, stat, writeFile } = require('node:fs/promises')
const { dirname, join, relative } = require('node:path')

// electron-builder cannot always disambiguate peer-dependency snapshots; these
// are required by the DSH boot graph, so restore the explicitly pinned instance
// when the collector omitted it.
const REQUIRED_PACKAGED_PEERS = Object.freeze([
  '@deepseek-ai/dsh-attachment',
  '@deepseek-ai/dsh-brand',
  '@deepseek-ai/dsh-sandbox-policy',
  '@deepseek-ai/dsh-settings',
  '@deepseek-ai/dsh-timeout',
  '@deepseek-ai/dsh-typert-protocol',
])

const SOURCE_ROOTS = new Map([
  ['@anthropic-ai/sdk', ['src']],
  ['ajv', ['lib']],
  ['openai', ['src']],
  ['zod', ['src']],
])

const DEVELOPMENT_DIRECTORIES = new Set([
  '__tests__', 'coverage', 'example', 'examples', 'test', 'tests',
])

const FIRST_PARTY_BUILD_FILES = /^(?:tsconfig(?:\.[^.]+)?\.json|tsdown\.config\.[cm]?[jt]s|vitest\.config\.[cm]?[jt]s)$/u

function splitPackagePath(relativePath) {
  const parts = relativePath.split(/[\\/]/u)
  if (parts[0]?.startsWith('@')) {
    return { packageName: `${parts[0]}/${parts[1]}`, packageParts: parts.slice(2) }
  }
  return { packageName: parts[0], packageParts: parts.slice(1) }
}

function classifyPrunableFile(relativePath) {
  const normalized = relativePath.replaceAll('\\', '/')
  const { packageName, packageParts } = splitPackagePath(normalized)
  const fileName = packageParts.at(-1) ?? ''

  if (/\.d\.(?:ts|mts|cts)$/u.test(fileName)) return 'type-declaration'
  if (packageParts.some((part) => DEVELOPMENT_DIRECTORIES.has(part))) return 'development-material'
  if (FIRST_PARTY_BUILD_FILES.test(fileName)) return 'development-material'

  const sourceRoots = SOURCE_ROOTS.get(packageName) ?? []
  if (sourceRoots.includes(packageParts[0])) return 'published-source'

  if (packageName === 'node-pty') {
    const packagePath = packageParts.join('/')
    if (/^prebuilds\/(?:darwin-|win32-arm64)/u.test(packagePath)) return 'foreign-native-binary'
    if (/^third_party\/conpty\/[^/]+\/win10-arm64\//u.test(packagePath)) return 'foreign-native-binary'
  }
  return undefined
}

async function listFiles(root) {
  const pending = [root]
  const files = []
  while (pending.length > 0) {
    const directory = pending.pop()
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) pending.push(path)
      else if (entry.isFile()) files.push(path)
    }
  }
  return files
}

async function prunePackagedRuntime(nodeModulesRoot) {
  const files = await listFiles(nodeModulesRoot)
  const report = { removedBytes: 0, removedFiles: 0, categories: {} }
  for (const path of files) {
    const relativePath = relative(nodeModulesRoot, path)
    const category = classifyPrunableFile(relativePath)
    if (category === undefined) continue
    const metadata = await stat(path)
    await rm(path, { force: true })
    report.removedBytes += metadata.size
    report.removedFiles += 1
    report.categories[category] = (report.categories[category] ?? 0) + 1
  }
  return report
}

async function restoreRequiredPackagedPeers(nodeModulesRoot) {
  const restored = []
  for (const packageName of REQUIRED_PACKAGED_PEERS) {
    const target = join(nodeModulesRoot, ...packageName.split('/'))
    try {
      await stat(target)
      continue
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    // Only restore peers actually present in this build; a project that has not
    // wired the dsh runtime packages yet resolves none and is skipped.
    let source
    try {
      source = dirname(require.resolve(`${packageName}/package.json`))
    } catch {
      continue
    }
    await mkdir(dirname(target), { recursive: true })
    await cp(source, target, { recursive: true, force: false, errorOnExist: true })
    restored.push(packageName)
  }
  return restored
}

async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return
  const nodeModulesRoot = join(
    context.appOutDir,
    'resources',
    'app.asar.unpacked',
    'node_modules',
  )
  const restoredPeers = await restoreRequiredPackagedPeers(nodeModulesRoot)
  const report = await prunePackagedRuntime(nodeModulesRoot)
  report.restoredPeers = restoredPeers
  const outputPath = join(context.outDir, 'runtime-prune-report.json')
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`  - pruned runtime  files=${report.removedFiles} bytes=${report.removedBytes}\n`)
}

module.exports = afterPack
module.exports.classifyPrunableFile = classifyPrunableFile
module.exports.prunePackagedRuntime = prunePackagedRuntime
module.exports.restoreRequiredPackagedPeers = restoreRequiredPackagedPeers
