// SPDX-License-Identifier: AGPL-3.0-only
// Human delivery numbers are explicit, never inferred from commits or build time.
import { readFileSync, writeFileSync, openSync, closeSync, renameSync, unlinkSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
export function readTmarVersion(root) {
  const value = JSON.parse(readFileSync(join(root, 'tmar-version.json'), 'utf8'))
  if (!value || value.schema !== 1 || !Number.isSafeInteger(value.number) || value.number < 1 || !['preview', 'stable'].includes(value.channel)) {
    throw new Error('Invalid TMAR version: expected schema 1, positive integer number and preview/stable channel.')
  }
  return { schema: 1, number: value.number, channel: value.channel }
}
export function advanceTmarVersion(root, expected) {
  const path = join(root, 'tmar-version.json'), lockPath = path + '.lock'
  // Do not delete another writer's lock; acquiring it must succeed first.
  const lock = openSync(lockPath, 'wx'), temp = path + '.' + randomUUID() + '.tmp'
  try {
    const current = readTmarVersion(root)
    if (!Number.isSafeInteger(expected) || current.number !== expected) throw new Error('TMAR version changed; re-read the current number before advancing.')
    if (!Number.isSafeInteger(current.number + 1)) throw new Error('TMAR version number overflow.')
    const next = { ...current, number: current.number + 1 }
    writeFileSync(temp, JSON.stringify(next, null, 2) + '\n', { flag: 'wx' })
    renameSync(temp, path)
    return next
  } finally {
    try { unlinkSync(temp) } catch (error) { if (error.code !== 'ENOENT') throw error }
    closeSync(lock); unlinkSync(lockPath)
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv[2] !== 'next' || !/^[1-9][0-9]*$/.test(process.argv[3] ?? '') || process.argv.length !== 4) throw new Error('Usage: node scripts/tmarVersion.mjs next <current-number>')
    const next = advanceTmarVersion(process.cwd(), Number(process.argv[3]))
    console.log(`TMAR Versione ${next.number} (${next.channel}). Review CHANGELOG, test, commit and package before delivery. No deployment performed.`)
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
