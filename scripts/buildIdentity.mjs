// SPDX-License-Identifier: AGPL-3.0-only
// Capture the source we actually compile, not the latest revision on a server.
import { execFileSync } from 'node:child_process'
export function readBuildIdentity(root, now = new Date()) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim()
  let revision = 'unknown', dirty = false
  try {
    const sha = git('rev-parse', 'HEAD')
    if (/^[0-9a-f]{40,64}$/.test(sha)) {
      revision = sha
      dirty = git('status', '--porcelain', '--untracked-files=normal').length > 0
    }
  } catch { /* Source archives without Git must say unknown, never invent a revision. */ }
  return { revision, dirty, builtAt: now.toISOString() }
}
