// SPDX-License-Identifier: AGPL-3.0-only
import { useState, type MouseEvent } from 'react'
import { useListSelection } from '../../src/plugins/listSelection'
import { useStore } from '../../src/state/store'
import { usePrefs } from '../../src/state/prefsStore'
import { CollapseButton } from '../../src/ui/CollapseButton'
import { Icon } from '../../src/ui/icons'
import { InfoDot } from '../../src/ui/InfoDot'
import { useNotes } from '../reverse/state/noteStore'
import { reEditorOpen, useReverse } from '../reverse/state/reStore'
import { NoteCard, noteWhere } from '../reverse/ui/NoteList'
import type { NoteListProps } from '../reverse/app/listExtensions'
import { armNote, canArmNote, useNoteShortcut } from './quickAccess'
import { clearNoteFocus, goToNote, useNoteFocus } from './noteFocus'
import { pluginText as tmarText, useLanguage as useTmarLanguage } from '../../src/i18n'


const COLLAPSE_KEY = 'tmar.quickNotes.collapsed'
const collapsedBefore = () => { try { return localStorage.getItem(COLLAPSE_KEY) === '1' } catch { return false } }
export function EnhancedNoteList({ placementBlocked = null }: NoteListProps) {
  useTmarLanguage()

  const notes = useNotes((s) => s.notes), placing = useNotes((s) => s.placing), editing = useNotes((s) => s.editing)
  const bodies = useReverse((s) => s.bodies)
  const agentOn = usePrefs((s) => s.agentLink)
  useReverse((s) => s.building || reEditorOpen(s) || !!s.playback)
  useStore((s) => s.busy)
  const part = useStore((s) => s.fileName)
  const listed = notes.filter((n) => n.text.trim() !== '')
  const selection = useListSelection(listed.map((n) => n.id), part)
  const focused = useNoteFocus((s) => s.id), canReturn = useNoteFocus((s) => s.canReturn)
  const message = useNoteFocus((s) => s.message), warning = useNoteFocus((s) => s.warning)
  const key = useNoteShortcut((s) => s.key)
  const [collapsed, setCollapsed] = useState(collapsedBefore)
  const blocked = placementBlocked ?? canArmNote()
  const selected = new Set(selection.ids)
  const openCount = listed.filter((n) => !n.done && n.by !== 'agent').length
  const questions = listed.filter((n) => !n.done && n.by === 'agent' && !n.reply).length
  const counts = [openCount > 0 && tmarText('{0} open', [openCount]), questions > 0 && tmarText('{0} question{1}', [questions, questions === 1 ? '' : 's'])].filter(Boolean).join(' · ')
  const collapse = () => {
    const next = !collapsed
    setCollapsed(next)
    try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0') } catch { /* optional preference */ }
  }
  const edit = (id: number, event: MouseEvent<HTMLButtonElement>) => {
    if (editing) { useStore.getState().setStatus('Save or cancel the current note first.'); return }
    clearNoteFocus()
    const r = event.currentTarget.getBoundingClientRect()
    useNotes.getState().edit({ id, at: { x: r.left, y: r.bottom - 6 } })
  }
  const remove = (ids: readonly number[]) => {
    if (editing || !ids.length) return
    if (!window.confirm(tmarText('Delete {0} selected note{1}? This cannot be undone.', [ids.length, ids.length === 1 ? '' : 's']))) return
    const removeIds = new Set(ids)
    clearNoteFocus()
    useNotes.setState((s) => ({ notes: s.notes.filter((n) => !removeIds.has(n.id)) }))
    selection.clear()
  }
  const done = (value: boolean) => {
    if (editing) return
    // Preserve imported provenance and every unselected note.
    useNotes.setState((s) => ({ notes: s.notes.map((n) => selected.has(n.id) ? { ...n, done: value } : n) }))
  }
  return <div className="group notes" data-test="note-list" onKeyDown={(event) => {
    if ((event.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]')) return
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'a') {
      event.preventDefault(); event.stopPropagation(); selection.all()
    } else if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); selection.clear(); clearNoteFocus()
      if (placing) useNotes.getState().setPlacing(false)
      if (editing) useNotes.getState().closeEditor()
    }
  }}>
    <div className="tmar-notes-heading">
      <CollapseButton label={agentOn ? tmarText("Notes for the agent") : tmarText("Notes")} collapsed={collapsed} count={listed.length}
        controls="tmar-notes-content" testId="notes-collapse" onToggle={collapse}/>
      <InfoDot title={tmarText("Local notes")}><p>{tmarText("Single-click selects; Ctrl/Cmd adds or removes a row; Shift selects a range. Double-click or use the target to center and highlight its saved position. The pencil edits.")}</p><p>{tmarText("Locating a note never changes geometry, target visibility or imported-note provenance. A warning identifies hidden or changed geometry.")}</p></InfoDot>
    </div>
    <div className="tmar-note-summary"><b data-test="note-count">{counts || ((listed.length ? tmarText("all handled") : '0'))}</b></div>
    {message && <p role="status" className={'tmar-focus-feedback' + (warning ? ' warn' : '')} data-test="note-focus-feedback">{tmarText(message)}</p>}
    <div id="tmar-notes-content" hidden={collapsed}>
      <div className="toolrow">
        <button data-test="note-add" aria-pressed={placing} className={placing ? 'on' : undefined} disabled={!placing && !!blocked} title={tmarText(blocked) ?? (tmarText("Add note{0}", [key ? tmarText(" ({0})", [key.toUpperCase()]) : '']))} onClick={armNote}>{placing ? tmarText("Click the part…") : tmarText("Note")}</button>
        <button data-test="notes-select-all" onClick={selection.all} disabled={!listed.length}>{tmarText("Select all")}</button>
        <button data-test="notes-clear-selection" onClick={() => { selection.clear(); clearNoteFocus() }} disabled={!selected.size}>{tmarText("Clear")}</button>
        <span data-test="notes-selected-count">{selection.ids.length}{tmarText(" selected")}</span>
      </div>
      {/* Keep row coordinates stable between the two clicks of a double-click. */}
      <div className="toolrow">
        <button data-test="notes-delete-selected" disabled={!!editing || !selected.size} onClick={() => remove(selection.ids)}>{tmarText("Delete selected")}</button>
        <button data-test="notes-done-selected" disabled={!!editing || !selected.size} onClick={() => done(true)}>{tmarText("Mark handled")}</button>
        <button data-test="notes-open-selected" disabled={!!editing || !selected.size} onClick={() => done(false)}>{tmarText("Reopen")}</button>
      </div>
      {canReturn && <button className="block" data-test="note-return-view" onClick={() => clearNoteFocus(true)}>{tmarText("Return to previous view")}</button>}
      <div role="listbox" aria-label={tmarText("Notes")} aria-multiselectable="true" tabIndex={0}>
        {listed.map((note) => <div key={note.id} data-test="note-row" data-note-id={note.id} role="option" aria-selected={selected.has(note.id)} tabIndex={0}
          className={'noterow' + (selected.has(note.id) ? ' tmar-selected' : '') + (focused === note.id ? ' tmar-focused' : '') + (note.done ? ' done' : '') + (note.by === 'agent' ? ' agent' : '')}
          onClick={(event) => { if (!(event.target as HTMLElement).closest('.notekeys')) selection.select(note.id, event) }}
          onDoubleClick={(event) => { if (!(event.target as HTMLElement).closest('.notekeys') && !event.ctrlKey && !event.metaKey && !event.shiftKey) { event.preventDefault(); goToNote(note.id) } }}
          onKeyDown={(event) => { if (event.target === event.currentTarget && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); goToNote(note.id) } }}>
          <span className={'notebadge' + (note.by === 'agent' ? ' agent' : '') + (note.done ? ' done' : '')}>{note.id}</span>
          <div className="notebody" data-test="note-select">
            <span className="notetext" data-test="note-row-text">{note.text}</span>
            <small>{note.fromFile ? tmarText("From the project file, on ") : note.by === 'agent' ? tmarText("The agent asks, on ") : tmarText("on ")}{noteWhere(note.on, bodies)}</small>
            {note.reply && <small data-test="note-row-reply">{note.fromFile ? tmarText("Reply in the file") : note.by === 'agent' ? tmarText("You") : tmarText("Agent")}: {note.reply}</small>}
            {note.by === 'agent' && !note.fromFile && !note.reply && !note.done && <small className="noteask" data-test="note-row-ask">{tmarText("Click to answer (pencil)")}</small>}
          </div>
          <span className="notekeys" onDoubleClick={(e) => e.stopPropagation()}>
            <button className="x" data-test="note-locate" aria-label={tmarText("Go to note {0}", [note.id])} title={tmarText("Go to note")} disabled={!!editing} onClick={() => goToNote(note.id)}>
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="M10 0v6M10 14v6M0 10h6M14 10h6"/></svg>
            </button>
            <button className="x" data-test="note-edit" title={tmarText("Edit or answer note")} aria-label={tmarText("Edit note {0}", [note.id])} disabled={!!editing} onClick={(e) => edit(note.id, e)}><Icon name="edit" size={14}/></button>
            <button className={'x notedone' + (note.done ? ' on' : '')} data-test="note-done" title={note.done ? tmarText("Reopen note") : tmarText("Mark handled")} aria-pressed={!!note.done} disabled={!!editing} onClick={() => useNotes.getState().setDone(note.id, !note.done)}>✓</button>
            <button className="x" data-test="note-remove" aria-label={tmarText("Delete note {0}", [note.id])} title={tmarText("Delete this note")} disabled={!!editing} onClick={() => remove([note.id])}>{tmarText("×")}</button>
          </span>
        </div>)}
      </div>
      {!listed.length && <p className="hint">{tmarText("Press Note or its shortcut, then click the part. No agent connection is needed.")}</p>}
    </div>
    {/* Outside the collapsible list: never discard an unsaved draft. */}
    <NoteCard />
  </div>
}
