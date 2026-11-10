// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { shortBuildRevision } from '../../../src/buildIdentity'
describe('build display is a revision, not an invented release', () => {
  it('shows a recognizable short commit', () => expect(shortBuildRevision({ revision: 'a'.repeat(40), dirty: false, builtAt: '' })).toBe('aaaaaaa'))
  it('does not invent a version when the source is unknown', () => expect(shortBuildRevision({ revision: 'unknown', dirty: false, builtAt: '' })).toBe('unknown'))
})
