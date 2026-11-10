// SPDX-License-Identifier: AGPL-3.0-only
// Composition only: existing Edit Surface APIs, no geometry implementation.
import { registerWorkspaceEditorHistory, type ScanRulerPlugin } from '../../src/plugins/api'
import { plugins } from '../../src/plugins/registry'
import { registerPanelExtension } from '../../src/plugins/panelExtensions'
import { replaySurfaceHistory } from '../tmar-edit-surface/historyReplay'
import type { WorkspaceSurfaceSession } from '../tmar-edit-surface/workspaceSession'
import { SurfaceHistoryEntry } from './SurfaceHistoryEntry'

let installed = false
const plugin: ScanRulerPlugin = {
  id: 'tmar-surface-history', name: 'TMAR · Modifiche superficie riapribili',
  install() {
    if (installed || !plugins().some(p => p.id === 'reverse') || !plugins().some(p => p.id === 'tmar-edit-surface')) return
    registerWorkspaceEditorHistory('tmar-edit-surface', {
      replay: replaySurfaceHistory,
      canPrepare: controller => {
        const session = controller as WorkspaceSurfaceSession
        if (typeof session.getPanelState !== 'function' || typeof session.prepareHistoryRecipe !== 'function' ||
            typeof session.prepareAnnotatedHistory !== 'function' || typeof session.freezeHistory !== 'function') return false
        const state = session.getPanelState(), snapshot = controller.getSnapshot()
        return state.historyRecipeSupported === true && snapshot.dirty && snapshot.validation.kind === 'valid' && !!state.net
      },
    })
    registerPanelExtension({ id: 'tmar-surface-history.resume', slot: 'reverse.create.after-network',
      component: SurfaceHistoryEntry, order: 11 })
    installed = true
  },
}
export default plugin
