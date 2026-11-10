// SPDX-License-Identifier: AGPL-3.0-only
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { panelExtensions, PluginPanelExtensions, registerPanelExtension } from '../src/plugins/panelExtensions'

describe('optional workspace panel slots', () => {
  it('renders nothing with no contribution', () => {
    expect(renderToStaticMarkup(createElement(PluginPanelExtensions, { slot: 'test.empty' }))).toBe('')
  })
  it('orders contributions, keeps slots separate, rejects duplicates and unregisters', () => {
    const offA = registerPanelExtension({ id: 'test.a', slot: 'test.slot', order: 2, component: () => createElement('span', null, 'A') })
    const offB = registerPanelExtension({ id: 'test.b', slot: 'test.slot', order: 1, component: () => createElement('span', null, 'B') })
    try {
      expect(panelExtensions('test.slot').map((e) => e.id)).toEqual(['test.b', 'test.a'])
      expect(panelExtensions('test.other')).toEqual([])
      expect(renderToStaticMarkup(createElement(PluginPanelExtensions, { slot: 'test.slot' }))).toBe('<span>B</span><span>A</span>')
      expect(() => registerPanelExtension({ id: 'test.a', slot: 'test.slot', component: () => null })).toThrow(/Duplicate/)
    } finally { offA(); offB() }
    expect(panelExtensions('test.slot')).toEqual([])
  })
})
