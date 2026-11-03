// SPDX-License-Identifier: AGPL-3.0-only
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EditSurfaceIcon } from '../EditSurfaceIcon'

const text = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8')
describe('Edit Surface feature entry', () => {
  it('uses the existing icon frame, square patches and nine theme-aware poles', () => {
    const svg = renderToStaticMarkup(createElement(EditSurfaceIcon))
    expect(svg).toContain('viewBox="0 0 24 24"')
    expect(svg).toContain('class="icon"')
    expect(svg).toContain('aria-hidden="true"')
    expect(svg).toContain('M4 4h16v16H4Z')
    expect(svg).toContain('M12 4v16M4 12h16')
    expect(svg.match(/<circle /g)).toHaveLength(9)
    expect(svg).not.toMatch(/#[0-9a-f]{3,8}/i)
  })
  it('registers one create-grid entry and no bottom export entry', () => {
    const plugin = text('../plugin.ts')
    expect(plugin).toContain("slot: 'reverse.create.after-network'")
    expect(plugin.match(/registerPanelExtension\(\{/g)).toHaveLength(1)
    expect(plugin).not.toContain("slot: 'reverse.export'")
    const panel = text('../../reverse/ui/ReversePanel.tsx')
    const patch = panel.indexOf('<span>Patch network</span>')
    const slot = panel.indexOf('<PluginPanelExtensions slot="reverse.create.after-network" />')
    const trim = panel.indexOf('data-test="feature-trim"')
    expect(slot).toBeGreaterThan(patch)
    expect(slot).toBeLessThan(trim)
    expect(panel).not.toContain('tmar-edit-surface')
  })
  it('portals the unchanged dialog out of feature-grid button styles', () => {
    const source = text('../EditSurface.tsx').split('function SurfaceDialog')[0]
    expect(source).toContain('data-test="feature-edit-surface"')
    expect(source).toContain('<span>Edit Surface</span>')
    expect(source).toContain('aria-haspopup="dialog"')
    expect(source).toContain('createPortal(<SurfaceDialog')
    expect(source).toContain('document.body)')
    expect(source).toContain('disabled={busy || running || re.building || re.editing || re.playback}')
  })
})
