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
  const capabilities = workspaceEditors.capabilities()
  const annotated = capabilities?.annotationVersion === 1 && capabilities.commitKinds.includes('annotated-cad-copy') &&
    !!state.controller?.prepareAnnotatedApply && !!state.controller?.freezeAnnotated
  return <aside className="workspace-editor-dock" data-test="workspace-editor-dock" aria-label="Edit Surface" aria-busy={state.phase !== 'editing'}>
    <header><strong>Edit Surface</strong><span>Modifica nella vista principale</span></header>
    <div className="workspace-editor-parameters" data-slot="workspace.editor.parameters">
      {state.controller && Parameters ? <Parameters controller={state.controller} /> : <p>Apertura del corpo CAD…</p>}
    </div>
    <footer>
      <div data-slot="workspace.editor.status" role="status" aria-live="polite">
        {state.error ?? state.snapshot?.message ?? (state.phase === 'editing' ? 'Bozza locale · originale conservato' : 'Elaborazione CAD…')}
        {!!state.snapshot?.draftNoteCount && <p>{annotated ? `${state.snapshot.draftNoteCount} note da includere nella copia CAD; gli ancoraggi saranno verificati prima della pubblicazione.` : 'La preparazione annotata non è disponibile per questo controller: Applica resta bloccato.'}</p>}
      </div>
      <label className="workspace-editor-copy-visibility" title="Conserva l'originale nel progetto ma lo nasconde dopo Applica. Undo ripristina la visibilità precedente; Redo mostra la copia e nasconde nuovamente l'originale.">
        <input type="checkbox" data-test="workspace-editor-hide-source" checked={state.hideSourceAfterApply}
          disabled={state.phase !== 'editing'} onChange={e => { workspaceEditors.setHideSourceAfterApply(e.target.checked) }} />
        <span>Nascondi l’originale dopo Applica</span>
      </label>
      {state.canPreserveHistory && <label className="workspace-editor-copy-visibility"
        title="Conserva nel progetto la modifica e le note per riprenderle anche dopo salvataggio e riapertura.">
        <input type="checkbox" data-test="workspace-editor-preserve-history" checked={state.preserveHistory}
          disabled={state.phase !== 'editing'} onChange={event => { workspaceEditors.setPreserveHistory(event.target.checked) }} />
        <span>Mantieni la modifica riapribile</span>
      </label>}
      <div className="keys">
        <button type="button" data-test="workspace-editor-frame-reticle" disabled={!state.canFrameReticle}
          title="Inquadra il reticolo corrente senza cambiare l'orientamento della vista; non si attiva automaticamente"
          onClick={() => { workspaceEditors.frameReticle() }}>Inquadra reticolo</button>
      </div>
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
