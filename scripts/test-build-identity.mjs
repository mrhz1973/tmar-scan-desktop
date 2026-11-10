// SPDX-License-Identifier: AGPL-3.0-only
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { readBuildIdentity } from './buildIdentity.mjs'
const now = new Date('2026-11-02T00:00:00Z')
test('source archive has an honest unknown revision', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tmar-build-archive-'))
  try { assert.deepEqual(readBuildIdentity(dir, now), { revision: 'unknown', dirty: false, builtAt: now.toISOString() }) }
  finally { rmSync(dir, { recursive: true, force: true }) }
})
test('records actual commit, tracked changes and new files, but not ignored output', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tmar-build-repo-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }).trim()
  try {
    git('init'); writeFileSync(join(dir,'source.txt'), 'one'); writeFileSync(join(dir,'.gitignore'), 'output.txt\n')
    git('add','.'); git('-c','user.name=Build Test','-c','user.email=build-test@example.invalid','commit','-m','fixture')
    const revision = git('rev-parse','HEAD')
    assert.deepEqual(readBuildIdentity(dir, now), { revision, dirty: false, builtAt: now.toISOString() })
    writeFileSync(join(dir,'output.txt'),'ignored'); assert.equal(readBuildIdentity(dir,now).dirty,false)
    writeFileSync(join(dir,'source.txt'),'two'); assert.equal(readBuildIdentity(dir,now).dirty,true)
    writeFileSync(join(dir,'source.txt'),'one'); assert.equal(readBuildIdentity(dir,now).dirty,false)
    writeFileSync(join(dir,'new-source.txt'),'untracked'); assert.equal(readBuildIdentity(dir,now).dirty,true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
