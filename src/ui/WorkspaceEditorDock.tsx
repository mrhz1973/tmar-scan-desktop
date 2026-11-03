// SPDX-License-Identifier: AGPL-3.0-only
import { useWorkspaceEditor, workspaceEditors } from '../plugins/workspaceEditors'
import './workspaceEditor.css'

export function requestEditorCancel(): void {
  const state = useWorkspaceEditor.getState()
  if (state.phase === 'committing' || state.phase === 'closing') return
  if (workspaceEditors.cancelGesture()) return
  if (state.snapshot?.dirty && !window.confirm('Scartare la modifica corrente e le note in bozza?')) return
  void workspaceEditors.cancel().catch(error => useWorkspaceEditor.setState({ error: String(error) }))
}
/** Logical outlets: the layout host places this dock, never the plugin. */
export function WorkspaceEditorDock() {
  const state = useWorkspaceEditor()
  if (state.phase === 'closed') return null
  const Parameters = state.definition?.Parameters
  return <aside className="workspace-editor-dock" data-test="workspace-editor-dock" aria-label="Edit Surface" aria-busy={state.phase !== 'editing'}>
    <header><strong>Edit Surface</strong><span>Modifica nella vista principale</span></header>
    <div className="workspace-editor-parameters" data-slot="workspace.editor.parameters">
      {state.controller && Parameters ? <Parameters controller={state.controller} /> : <p>Apertura del corpo CAD…</p>}
    </div>
    <footer>
      <div data-slot="workspace.editor.status" role="status" aria-live="polite">
        {state.error ?? state.snapshot?.message ?? (state.phase === 'editing' ? 'Bozza locale · originale conservato' : 'Elaborazione CAD…')}
        {!!state.snapshot?.draftNoteCount && <p>Le note in bozza richiedono il supporto della transazione annotata, non ancora disponibile.</p>}
      </div>
      <label className="workspace-editor-copy-visibility" title="Conserva l'originale nel progetto ma lo nasconde dopo Applica. Undo ripristina la visibilità precedente; Redo mostra la copia e nasconde nuovamente l'originale.">
        <input type="checkbox" data-test="workspace-editor-hide-source" checked={state.hideSourceAfterApply}
          disabled={state.phase !== 'editing'} onChange={e => { workspaceEditors.setHideSourceAfterApply(e.target.checked) }} />
        <span>Nascondi l’originale dopo Applica</span>
      </label>
      <div data-slot="workspace.editor.actions" className="keys">
        <button type="button" data-test="workspace-editor-apply" disabled={!state.canApply}
          title="Pubblica una copia CAD verificata come un'unica operazione del progetto"
          onClick={() => { void workspaceEditors.apply().catch(() => { /* Error is in the shared state. */ }) }}>Applica</button>
        <button type="button" data-test="workspace-editor-cancel" disabled={state.phase === 'committing' || state.phase === 'closing'}
          title="Annulla la bozza senza modificare l'originale" onClick={requestEditorCancel}>Annulla</button>
      </div>
    </footer>
  </aside>
}
