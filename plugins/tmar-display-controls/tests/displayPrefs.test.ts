// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readDisplayPrefs } from '../DisplayControls'
afterEach(() => vi.unstubAllGlobals())
describe('workspace display preferences', () => {
  it('defaults safely with unavailable storage', () => { vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') } }); expect(readDisplayPrefs('reverse')).toEqual({ labels: true, pins: true }) })
  it('separates workspaces and rejects invalid fields', () => {
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ reverse: { labels: false, pins: true }, mesh: { labels: true, pins: false }, bad: { labels: 'false' } }) })
    expect(readDisplayPrefs('reverse')).toEqual({ labels: false, pins: true })
    expect(readDisplayPrefs('mesh')).toEqual({ labels: true, pins: false })
    expect(readDisplayPrefs('bad')).toEqual({ labels: true, pins: true })
  })
})
