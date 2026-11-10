// SPDX-License-Identifier: AGPL-3.0-only
// First-paint HTML and the hydrated store must agree, including blocked storage.
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
if (!html.includes('<script src="/theme.js"></script>')) throw new Error('Missing blocking external first-paint theme script')
const boot = readFileSync(new URL('../public/theme.js', import.meta.url), 'utf8')
const cases = [
  { name: 'fresh light OS', saved: null, os: false, theme: 'dark', dark: true },
  { name: 'fresh dark OS', saved: null, os: true, theme: 'dark', dark: true },
  { name: 'invalid stored value', saved: 'broken', os: false, theme: 'dark', dark: true },
  { name: 'empty stored value', saved: '', os: false, theme: 'dark', dark: true },
  { name: 'explicit Light', saved: 'light', os: true, theme: 'light', dark: false },
  { name: 'explicit Dark', saved: 'dark', os: false, theme: 'dark', dark: true },
  { name: 'explicit System/light OS', saved: 'system', os: false, theme: 'system', dark: false },
  { name: 'explicit System/dark OS', saved: 'system', os: true, theme: 'system', dark: true },
]
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })
function environment(saved: string | null, os: boolean, blocked = false) {
  const values = new Map(saved === null ? [] : [['scanruler.uitheme', saved]])
  const storage = {
    getItem: (key: string) => { if (blocked) throw new Error('blocked'); return values.get(key) ?? null },
    setItem: (key: string, value: string) => { if (blocked) throw new Error('blocked'); values.set(key, value) },
  }
  const listeners: (() => void)[] = []
  const media = { matches: os, addEventListener: (_: string, cb: () => void) => listeners.push(cb), removeEventListener: () => {} }
  const doc = { documentElement: { dataset: { theme: 'dark' } } }
  return { storage, media, doc, values, change: (dark: boolean) => { media.matches = dark; listeners.forEach(cb => cb()) } }
}
describe('TMAR Dark default', () => {
  for (const c of cases) {
    it(`first paint: ${c.name}`, () => {
      const e = environment(c.saved, c.os)
      runInNewContext(boot!, { localStorage: e.storage, document: e.doc, matchMedia: () => e.media })
      expect(e.doc.documentElement.dataset.theme).toBe(c.dark ? 'dark' : 'light')
      expect(e.values.get('scanruler.uitheme') ?? null).toBe(c.saved)
    })
    it(`store: ${c.name}`, async () => {
      vi.resetModules()
      const e = environment(c.saved, c.os)
      vi.stubGlobal('localStorage', e.storage); vi.stubGlobal('document', e.doc); vi.stubGlobal('matchMedia', () => e.media)
      const { usePrefs } = await import('../src/state/prefsStore')
      expect(usePrefs.getState().uiTheme).toBe(c.theme)
      expect(usePrefs.getState().dark).toBe(c.dark)
      expect(e.doc.documentElement.dataset.theme).toBe(c.dark ? 'dark' : 'light')
      expect(e.values.get('scanruler.uitheme') ?? null).toBe(c.saved)
    })
  }
  it('starts dark when reading/writing storage throws', async () => {
    const e = environment(null, false, true)
    runInNewContext(boot!, { localStorage: e.storage, document: e.doc, matchMedia: () => e.media })
    expect(e.doc.documentElement.dataset.theme).toBe('dark')
    vi.stubGlobal('localStorage', e.storage); vi.stubGlobal('document', e.doc); vi.stubGlobal('matchMedia', () => e.media)
    const { usePrefs } = await import('../src/state/prefsStore')
    expect(usePrefs.getState().uiTheme).toBe('dark')
    usePrefs.getState().setUiTheme('light')
    expect(usePrefs.getState().dark).toBe(false)
  })
  it('works without matchMedia, with System retaining its light fallback', () => {
    for (const saved of [null, 'system']) {
      const e = environment(saved, false)
      runInNewContext(boot!, { localStorage: e.storage, document: e.doc })
      expect(e.doc.documentElement.dataset.theme).toBe(saved === 'system' ? 'light' : 'dark')
    }
  })
  it('only System follows OS changes; manual choices are remembered', async () => {
    const e = environment(null, false)
    vi.stubGlobal('localStorage', e.storage); vi.stubGlobal('document', e.doc); vi.stubGlobal('matchMedia', () => e.media)
    const { usePrefs } = await import('../src/state/prefsStore')
    e.change(true); e.change(false)
    expect(usePrefs.getState().dark).toBe(true)
    usePrefs.getState().setUiTheme('light'); e.change(true)
    expect(usePrefs.getState().dark).toBe(false)
    expect(e.values.get('scanruler.uitheme')).toBe('light')
    usePrefs.getState().setUiTheme('system'); e.change(false)
    expect(usePrefs.getState().dark).toBe(false)
    e.change(true); expect(usePrefs.getState().dark).toBe(true)
    usePrefs.getState().setUiTheme('dark'); e.change(false)
    expect(usePrefs.getState().dark).toBe(true)
    expect(e.values.get('scanruler.uitheme')).toBe('dark')
  })
  it('declares a dark shell even before JavaScript', () => {
    expect(html).toContain('<html lang="en" data-theme="dark">')
    expect(html).toContain('html { background: #1b1d20; }')
  })
})
