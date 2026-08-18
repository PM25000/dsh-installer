// dsh-installer — post-pack verification + checksum generation.
//   node scripts/verify-package.mjs
// Finds the built installer artifact in dist/ (NSIS .exe on Windows, .dmg on
// macOS), verifies it exists and is non-empty, then writes SHA256SUMS.txt next
// to it (used by the release CI).

import { createHash } from 'node:crypto'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist')
const IS_MAC = process.platform === 'darwin'

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex').toLowerCase()
}

async function main() {
  let entries
  try {
    entries = await readdir(DIST)
  } catch {
    throw new Error(`pack output directory not found: ${DIST}`)
  }
  const candidates = entries.filter((name) =>
    IS_MAC ? /^dsh-installer-.*\.(?:dmg|zip)$/u.test(name) : /^dsh-installer-Setup-.*\.exe$/iu.test(name))
  if (candidates.length === 0) {
    throw new Error(`no ${IS_MAC ? 'macOS' : 'NSIS'} artifact found in ${DIST}`)
  }
  const artifact = IS_MAC
    ? candidates.find((name) => name.endsWith('.dmg')) ?? candidates[0]
    : candidates[0]
  const path = join(DIST, artifact)
  const info = await stat(path)
  if (info.size === 0) throw new Error(`installer is empty: ${path}`)

  const hash = sha256(await readFile(path))
  const sums = `${hash}  ${artifact}\n`
  await writeFile(join(DIST, 'SHA256SUMS.txt'), sums, 'ascii')
  console.log(`${artifact}  ${info.size} bytes  sha256=${hash}`)
}

main().catch((error) => {
  console.error(`verify-package: ${error?.message ?? error}`)
  process.exit(1)
})
