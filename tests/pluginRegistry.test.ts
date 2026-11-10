// SPDX-License-Identifier: AGPL-3.0-only
// Which plugins installPlugins puts in use: only the enabled ones are checked
// for a shared id, and one whose install() throws is left out of the list.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ScanRulerPlugin } from '../src/plugins/api'
import { installEnabled, plugins } from '../src/plugins/registry'

const plugin = (id: string, install?: () => void, requires?: readonly string[]): ScanRulerPlugin => ({ id, name: id, install, requires })

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('installing plugins', () => {
  it('lets ?plugins=none open a build whose plugins share an id', () => {
    vi.stubGlobal('location', { search: '?plugins=none' })
    expect(installEnabled([plugin('twin'), plugin('twin')])).toEqual([])
  })

  it('leaves a plugin whose install throws out of the list', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const good = plugin('good', () => {})
    const bad = plugin('bad', () => { throw new Error('broken') })
    expect(installEnabled([good, bad])).toEqual([good])
  })

  it('still refuses duplicate enabled ids before installing either plugin', () => {
    const install = vi.fn()
    expect(() => installEnabled([plugin('twin', install), plugin('twin', install)])).toThrow('Two plugins share the id')
    expect(install).not.toHaveBeenCalled()
  })

  it('installs later-named dependencies first and exposes only completed installations', () => {
    const before = plugins()
    const seen: [string, string[]][] = []
    const observe = (id: string) => () => { seen.push([id, plugins().map(p => p.id)]) }
    const base = plugin('z-base', observe('z-base'))
    const middle = plugin('b-middle', observe('b-middle'), ['z-base'])
    const entry = plugin('a-entry', observe('a-entry'), ['z-base', 'b-middle'])
    expect(installEnabled([entry, base, middle])).toEqual([base, middle, entry])
    expect(seen).toEqual([
      ['z-base', []],
      ['b-middle', ['z-base']],
      ['a-entry', ['z-base', 'b-middle']],
    ])
    expect(plugins()).toEqual(before)
  })

  it('does not run or report a dependent when its dependency fails', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const dependent = vi.fn()
    const bad = plugin('z-bad', () => { throw Error('broken dependency') })
    const good = plugin('good')
    expect(installEnabled([plugin('a-entry', dependent, ['z-bad']), bad, good])).toEqual([good])
    expect(dependent).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledTimes(1)
  })

  it('keeps dependents out when a required plugin is absent or disabled', () => {
    vi.stubGlobal('localStorage', { getItem: () => null })
    const dependent = vi.fn(), dependency = vi.fn()
    expect(installEnabled([
      plugin('needs-absent', dependent, ['absent']),
      plugin('needs-beta', dependent, ['beta']),
      { ...plugin('beta', dependency), beta: true },
    ])).toEqual([])
    expect(dependent).not.toHaveBeenCalled()
    expect(dependency).not.toHaveBeenCalled()
  })

  it('rejects cycles without hiding unrelated plugins or leaking installation state', () => {
    const before = plugins()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const cyclic = vi.fn(), good = plugin('good')
    expect(installEnabled([plugin('a', cyclic, ['b']), plugin('b', cyclic, ['a']), good])).toEqual([good])
    expect(cyclic).not.toHaveBeenCalled()
    expect(plugins()).toEqual(before)
  })
})
