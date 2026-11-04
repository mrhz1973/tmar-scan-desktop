// SPDX-License-Identifier: AGPL-3.0-only
import type { ScanRulerPlugin } from '../../src/plugins/api'
import { registerPanelExtension } from '../../src/plugins/panelExtensions'
import { plugins } from '../../src/plugins/registry'
import { registerHistory } from '../../src/state/historyStore'
import { EditSurface, useSurfaceDialogs } from './EditSurface'
import { installWorkspaceIntegration } from './workspaceIntegration'
const plugin: ScanRulerPlugin = {
  id: 'tmar-edit-surface', name: 'TMAR Edit Surface · CAD prototype',
  install() {
    if (!plugins().some(p => p.id === 'reverse')) return
    const sharedViewEntry = installWorkspaceIntegration()
    if (sharedViewEntry) {
      registerPanelExtension({ id: 'tmar-edit-surface.open', slot: 'reverse.create.after-network', component: sharedViewEntry, order: 10 })
      return
    }
    // Older builds do not have the shared-view host; retain their legacy editor.
    registerHistory({
      blocked: () => useSurfaceDialogs.getState().count > 0,
      useWatch: () => useSurfaceDialogs(s => s.count > 0),
    })
    registerPanelExtension({ id: 'tmar-edit-surface.open', slot: 'reverse.export', component: EditSurface, order: 10 })
  },
}
export default plugin
