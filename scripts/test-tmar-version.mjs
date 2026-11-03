// SPDX-License-Identifier: AGPL-3.0-only
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readTmarVersion, advanceTmarVersion } from './tmarVersion.mjs'
const fixture = fn => { const dir = mkdtempSync(join(tmpdir(), 'tmar-numbering-')); try { fn(dir) } finally { rmSync(dir, { recursive: true, force: true }) } }
const save = (root, value) => writeFileSync(join(root, 'tmar-version.json'), JSON.stringify(value))
const first = { schema: 1, number: 1, channel: 'preview' }
test('repeated build reads keep Version 1 and never mutate the manifest', () => fixture(root => {
  save(root, first); const before = readFileSync(join(root, 'tmar-version.json'), 'utf8')
  for (let i = 0; i < 5; i++) assert.deepEqual(readTmarVersion(root), first)
  assert.equal(readFileSync(join(root, 'tmar-version.json'), 'utf8'), before)
}))
test('explicit advances follow 1, 2, 3; stale callers cannot skip a version', () => fixture(root => {
  save(root, first); assert.equal(advanceTmarVersion(root, 1).number, 2)
  assert.throws(() => advanceTmarVersion(root, 1), /changed/)
  assert.equal(readTmarVersion(root).number, 2)
  assert.equal(advanceTmarVersion(root, 2).number, 3)
  assert.equal(readTmarVersion(root).channel, 'preview')
  assert.equal(existsSync(join(root, 'tmar-version.json.lock')), false)
}))
test('bad numbers, schema and channels cannot silently label a build', () => fixture(root => {
  for (const value of [null, {}, { ...first, schema: 2 }, ...[0, -1, 1.5, '1', null, 1e20].map(number => ({ ...first, number })), { ...first, channel: 'unknown' }]) {
    save(root, value); assert.throws(() => readTmarVersion(root))
  }
  writeFileSync(join(root, 'tmar-version.json'), '{'); assert.throws(() => readTmarVersion(root))
}))
test('an absent manifest does not invent Version 1', () => fixture(root => assert.throws(() => readTmarVersion(root))))
test('an existing writer lock is respected and left intact', () => fixture(root => {
  save(root, first); writeFileSync(join(root, 'tmar-version.json.lock'), 'other writer')
  assert.throws(() => advanceTmarVersion(root, 1), /EEXIST/)
  assert.equal(readTmarVersion(root).number, 1)
  assert.equal(readFileSync(join(root, 'tmar-version.json.lock'), 'utf8'), 'other writer')
}))
test('version advance never promotes preview to stable and rejects overflow', () => fixture(root => {
  save(root, { ...first, channel: 'stable' }); assert.equal(advanceTmarVersion(root, 1).channel, 'stable')
  save(root, { ...first, number: Number.MAX_SAFE_INTEGER }); assert.throws(() => advanceTmarVersion(root, Number.MAX_SAFE_INTEGER), /overflow/)
  assert.equal(readTmarVersion(root).number, Number.MAX_SAFE_INTEGER)
}))
