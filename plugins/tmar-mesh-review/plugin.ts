// SPDX-License-Identifier: AGPL-3.0-only
import type { ScanRulerPlugin } from '../../src/plugins/api'
import { plugins } from '../../src/plugins/registry'
import { registerPanelExtension } from '../../src/plugins/panelExtensions'
import { registerNoteWorkspace } from '../reverse/app/noteWorkspaces'
import { inspectionBlockNow, meshNoteBlockNow, meshFocusWarning, placeMeshNote } from './meshNotes'
import { MeshNotesPanel, MeshZebraButton, MeshZebraPanel } from './MeshReview'
const plugin: ScanRulerPlugin = {
  id: 'tmar-mesh-review', name: 'TMAR Mesh Tools notes and Zebra',
  requires: ['mesh-tools', 'reverse', 'tmar-quick-notes', 'tmar-zebra'],
  install() {
    if (!['mesh-tools', 'reverse', 'tmar-quick-notes', 'tmar-zebra'].every(id => plugins().some(p => p.id === id))) return
    registerNoteWorkspace({ workspace: 'mesh', place: placeMeshNote, placementBlocked: meshNoteBlockNow,
      focusProblem: () => inspectionBlockNow(), focusWarning: meshFocusWarning })
    registerPanelExtension({ id: 'tmar-mesh-review.notes', slot: 'mesh.notes', component: MeshNotesPanel })
    registerPanelExtension({ id: 'tmar-mesh-review.analysis', slot: 'mesh.analysis', component: MeshZebraPanel })
    registerPanelExtension({ id: 'tmar-mesh-review.quick', slot: 'view.tools', component: MeshZebraButton, order: 30 })
  },
}
export default plugin
