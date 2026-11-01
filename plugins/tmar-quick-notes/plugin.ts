// SPDX-License-Identifier: AGPL-3.0-only
import type { ScanRulerPlugin } from '../../src/plugins/api'
import { registerPanelExtension } from '../../src/plugins/panelExtensions'
import { plugins } from '../../src/plugins/registry'
import { registerNoteWorkspace } from '../reverse/app/noteWorkspaces'
import { DeviationNotes } from './DeviationNotesPanel'
import { placeDeviationNote } from './notePlacement'

const plugin: ScanRulerPlugin = {
  id: 'tmar-quick-notes',
  name: 'TMAR notes in Deviation',
  install() {
    if (!plugins().some((p) => p.id === 'reverse')) return
    registerNoteWorkspace({ workspace: 'deviation', place: placeDeviationNote })
    registerPanelExtension({ id: 'tmar-quick-notes.deviation', slot: 'deviation.extra', component: DeviationNotes })
  },
}
export default plugin
