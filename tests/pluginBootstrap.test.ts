// SPDX-License-Identifier: AGPL-3.0-only
// The production installer and real panel entries: a plugin listed after a
// silent early return must not count as a working Edit Surface integration.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { installPlugins, plugins } from '../src/plugins/registry'
import { panelExtensions, PluginPanelExtensions } from '../src/plugins/panelExtensions'
import { workspaceEditors } from '../src/plugins/workspaceEditors'

it('installs the real dependent extensions and renders Edit Surface with its empty-model guard', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const installed = installPlugins()
    expect(installPlugins()).toBe(installed)
    expect(plugins()).toBe(installed)
    const ids = installed.map(p => p.id)
    expect(ids).toContain('tmar-model-tree')
    expect(ids.indexOf('reverse')).toBeLessThan(ids.indexOf('tmar-edit-surface'))
    expect(ids.indexOf('tmar-edit-surface')).toBeLessThan(ids.indexOf('tmar-surface-history'))
    expect(ids.indexOf('tmar-quick-notes')).toBeLessThan(ids.indexOf('tmar-mesh-review'))
    expect(ids.indexOf('tmar-zebra')).toBeLessThan(ids.indexOf('tmar-mesh-review'))
    const expected: Record<string, string[]> = {
      'reverse.create.after-network': ['tmar-edit-surface.open', 'tmar-surface-history.resume'],
      'reverse.analysis': ['tmar-zebra.analysis', 'tmar-cad-edges.reverse'],
      'reverse.export': ['tmar-body-export.stl'],
      'workspace.divider': ['tmar-display-controls.resize'],
      'view.tools': ['tmar-quick-notes.quick', 'tmar-display-controls.visibility', 'tmar-zebra.quick', 'tmar-mesh-review.quick', 'tmar-cad-edges.quick'],
      'mesh.smooth.controls': ['tmar-smooth-controls.intensity'],
      'mesh.notes': ['tmar-mesh-review.notes'],
      'mesh.analysis': ['tmar-mesh-review.analysis', 'tmar-cad-edges.mesh'],
    }
    for (const [slot, entries] of Object.entries(expected)) {
      expect(panelExtensions(slot).map(entry => entry.id).sort(), slot).toEqual([...entries].sort())
    }
    expect(workspaceEditors.capabilities()?.enabled).toBe(true)
    const html = renderToStaticMarkup(createElement(PluginPanelExtensions, { slot: 'reverse.create.after-network' }))
    expect(html).toMatch(/<button\b[^>]*data-test="feature-edit-surface"[^>]*disabled=""/)
    expect(html).toMatch(/<button\b[^>]*data-test="surface-history-reopen"[^>]*disabled=""/)
    expect(error).not.toHaveBeenCalled()
  } finally { error.mockRestore() }
})
