// SPDX-License-Identifier: AGPL-3.0-only
import type { ScanRulerPlugin } from '../../src/plugins/api'
import { registerPanelExtension } from '../../src/plugins/panelExtensions'
import { plugins } from '../../src/plugins/registry'
import { registerNoteWorkspace } from '../reverse/app/noteWorkspaces'
import { registerNoteListExtension } from '../reverse/app/listExtensions'
import { useNotes } from '../reverse/state/noteStore'
import { DeviationNotes } from './DeviationNotesPanel'
import { placeDeviationNote } from './notePlacement'
import { EnhancedNoteList } from './EnhancedNoteList'
import { NoteShortcutSettings, QuickNoteButton, useQuickAccess } from './quickAccess'
import './quickNotes.css'
const plugin: ScanRulerPlugin = {
  id: 'tmar-quick-notes',
  requires: ['reverse'],
  name: 'TMAR local notes and navigation',
  install() {
    if (!plugins().some((p) => p.id === 'reverse')) return
    useNotes.getState().showLocalNotes()
    registerNoteListExtension(EnhancedNoteList)
    registerNoteWorkspace({ workspace: 'deviation', place: placeDeviationNote })
    registerPanelExtension({ id: 'tmar-quick-notes.deviation', slot: 'deviation.extra', component: DeviationNotes })
    registerPanelExtension({ id: 'tmar-quick-notes.settings', slot: 'settings.tools', component: NoteShortcutSettings })
    registerPanelExtension({ id: 'tmar-quick-notes.quick', slot: 'view.tools', component: QuickNoteButton, order: 10 })
  },
  usePlugin() { useQuickAccess(); return {} },
}
export default plugin
