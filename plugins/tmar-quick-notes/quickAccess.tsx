// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect } from 'react'
import { create } from 'zustand'
import { usePrefs } from '../../src/state/prefsStore'
import { useStore } from '../../src/state/store'
import { useShell } from '../../src/state/shellStore'
import { useCommandActivity } from '../../src/commands/activity'
import { reEditorOpen, useReverse } from '../reverse/state/reStore'
import { useNotes } from '../reverse/state/noteStore'
import { KeyIcon } from '../reverse/ui/reIcons'
import { noteWorkspace } from '../reverse/app/noteWorkspaces'
import { placementBlockNow } from './notePlacement'
import { clearNoteFocus, useNoteFocus } from './noteFocus'

const STORAGE_KEY = 'tmar.quickNotes.shortcut'
export const validNoteKey = (key: string): boolean => key === '' || /^[a-z]$/.test(key)
function storedKey(): string {
  try { const v = localStorage.getItem(STORAGE_KEY); return v !== null && validNoteKey(v) ? v : 'n' } catch { return 'n' }
}
export const useNoteShortcut = create<{ key: string; setKey: (key: string) => void }>((set) => ({
  key: storedKey(),
  setKey: (key) => {
    if (!validNoteKey(key)) return
    try { localStorage.setItem(STORAGE_KEY, key) } catch { /* Settings remain usable without storage. */ }
    set({ key })
  },
}))
export function canArmNote(): string | null {
  const workspace = useShell.getState().workspace, re = useReverse.getState(), model = useStore.getState()
  if (workspace !== 'reverse' && !noteWorkspace(workspace)) return 'Open a workspace with local notes to add a note.'
  if (useNotes.getState().editing) return 'Save or cancel the open note first.'
  if (model.busy || useCommandActivity.getState().running || re.building || reEditorOpen(re) || re.playback) return 'Finish the current operation or editor first.'
  if (workspace === 'deviation') return placementBlockNow()
  const blocked = noteWorkspace(workspace)?.placementBlocked?.()
  if (blocked) return blocked
  if (!model.fileName && !re.bodies.length) return 'Load a scan or build a body first.'
  return null
}
export function armNote(): boolean {
  const notes = useNotes.getState()
  if (notes.placing) { notes.setPlacing(false); return true }
  const blocked = canArmNote()
  if (blocked) { useStore.getState().setStatus(blocked); return false }
  clearNoteFocus()
  notes.showLocalNotes()
  notes.setPlacing(true)
  useStore.getState().setStatus('Click the scan or CAD body to write a note. Escape cancels.')
  return true
}
export function NoteShortcutSettings() {
  const key = useNoteShortcut((s) => s.key), setKey = useNoteShortcut((s) => s.setKey)
  return <section aria-label="Note shortcuts" data-test="note-shortcut-settings">
    <h3>Shortcuts</h3>
    <label className="setting">Add note
      <select data-test="note-shortcut" value={key} onChange={(e) => setKey(e.target.value)}>
        <option value="">Disabled</option>
        {'abcdefghijklmnopqrstuvwxyz'.split('').map((letter) => <option key={letter} value={letter}>{letter.toUpperCase()}</option>)}
      </select>
    </label>
    <p className="hint">One unmodified letter in workspaces with local notes (including Mesh Tools when installed). Inactive while typing, in dialogs or while a CAD editor is open. Does not enable an agent connection.</p>
    <button data-test="note-shortcut-reset" onClick={() => setKey('n')}>Reset to N</button>
  </section>
}
export function QuickNoteButton() {
  const workspace = useShell((s) => s.workspace)
  const placing = useNotes((s) => s.placing)
  const key = useNoteShortcut((s) => s.key)
  if (workspace !== 'reverse' && !noteWorkspace(workspace)) return null
  return <div className="keys"><button data-test="quick-note" aria-pressed={placing}
    className={placing ? 'on' : undefined} title={`Add a local note${key ? ` (${key.toUpperCase()})` : ''}`} onClick={armNote}>
    <KeyIcon name="note" size={16} />Note
  </button></div>
}
export function useQuickAccess(): void {
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.defaultPrevented || event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="textbox"], [role="dialog"], .modal')) return
      if (usePrefs.getState().settingsOpen || document.querySelector('[role="dialog"], .modalback')) return
      const key = useNoteShortcut.getState().key
      if (!key || event.key.toLowerCase() !== key || canArmNote()) return
      event.preventDefault(); event.stopImmediatePropagation(); armNote()
    }
    window.addEventListener('keydown', keydown, true)
    const stopWorkspace = useShell.subscribe((s, before) => { if (s.workspace !== before.workspace) clearNoteFocus() })
    const stopNotes = useNotes.subscribe((s, before) => {
      const id = useNoteFocus.getState().id
      if (id !== null && s.notes.find((n) => n.id === id) !== before.notes.find((n) => n.id === id)) clearNoteFocus()
    })
    return () => { window.removeEventListener('keydown', keydown, true); stopWorkspace(); stopNotes(); clearNoteFocus() }
  }, [])
}
