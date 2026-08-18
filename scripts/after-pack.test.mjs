// dsh-installer — offline test for the afterPack pruner.
//   node --test scripts/after-pack.test.mjs   (or: npm run test:scripts)
// Validates classifyPrunableFile against representative package paths and runs
// prunePackagedRuntime on a fake node_modules tree.

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { classifyPrunableFile, prunePackagedRuntime } from '../scripts/after-pack.cjs'

test('classifyPrunableFile identifies prunable and keepable paths', () => {
  assert.equal(classifyPrunableFile('openai/src/_client.ts'), 'published-source')
  assert.equal(classifyPrunableFile('@deepseek-ai/dsh/lib/types.d.ts'), 'type-declaration')
  assert.equal(classifyPrunableFile('some-pkg/test/foo.js'), 'development-material')
  assert.equal(classifyPrunableFile('some-pkg/tsdown.config.ts'), 'development-material')
  assert.equal(classifyPrunableFile('node-pty/prebuilds/darwin-x64/foo.node'), 'foreign-native-binary')
  assert.equal(classifyPrunableFile('some-pkg/lib/main.js'), undefined)
  assert.equal(classifyPrunableFile('some-pkg/package.json'), undefined)
})

test('prunePackagedRuntime removes prunable files and counts them', async () => {
  const base = await mkdtemp(join(tmpdir(), 'dsh-installer-prune-'))
  try {
    const nm = join(base, 'node_modules')
    await mkdir(join(nm, '@deepseek-ai', 'dsh', 'lib'), { recursive: true })
    await mkdir(join(nm, 'openai', 'src'), { recursive: true })
    await mkdir(join(nm, 'keep', 'lib'), { recursive: true })
    await writeFile(join(nm, '@deepseek-ai', 'dsh', 'lib', 'types.d.ts'), 'x'.repeat(10), 'utf8')
    await writeFile(join(nm, 'openai', 'src', '_client.ts'), 'x'.repeat(20), 'utf8')
    await writeFile(join(nm, 'keep', 'lib', 'main.js'), 'x'.repeat(30), 'utf8')

    const report = await prunePackagedRuntime(nm)
    assert.equal(report.removedFiles, 2, 'removes the two prunable files')
    assert.ok(report.removedBytes >= 10)
    assert.equal(report.categories['type-declaration'], 1)
    assert.equal(report.categories['published-source'], 1)
    // keepable file survives
    const fs = await import('node:fs/promises')
    await assert.doesNotReject(() => fs.access(join(nm, 'keep', 'lib', 'main.js')))
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
