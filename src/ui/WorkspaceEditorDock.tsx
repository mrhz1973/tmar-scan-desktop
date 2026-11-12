// SPDX-License-Identifier: AGPL-3.0-only
import { useWorkspaceEditor, workspaceEditors } from '../plugins/workspaceEditors'
import './workspaceEditor.css'
import { coreText as tmarText, useLanguage as useTmarLanguage } from '../i18n'


export function requestEditorCancel(): void {
  const state = useWorkspaceEditor.getState()
  if (state.phase === 'committing' || state.phase === 'closing') return
  if (workspaceEditors.cancelGesture()) return
  if (state.snapshot?.dirty && !window.confirm(tmarText('Discard the current edit and draft notes?'))) return
  void workspaceEditors.cancel().catch(error => useWorkspaceEditor.setState({ error: String(error) }))
}
/** Logical outlets: the layout host places this dock, never the plugin. */
export function WorkspaceEditorDock() {
  useTmarLanguage()

  const state = useWorkspaceEditor()
  if (state.phase === 'closed') return null
  const Parameters = state.definition?.Parameters
  const capabilities = workspaceEditors.capabilities()
  const annotated = capabilities?.annotationVersion === 1 && capabilities.commitKinds.includes('annotated-cad-copy') &&
    !!state.controller?.prepareAnnotatedApply && !!state.controller?.freezeAnnotated
  return <aside className="workspace-editor-dock" data-test="workspace-editor-dock" aria-label={tmarText("Edit Surface")} aria-busy={state.phase !== 'editing'}>
    <header><strong>{tmarText("Edit Surface")}</strong><span>{tmarText("Edit in main viewport")}</span></header>
    <div className="workspace-editor-parameters" data-slot="workspace.editor.parameters">
      {state.controller && Parameters ? <Parameters controller={state.controller} /> : <p>{tmarText("Opening CAD body…")}</p>}
    </div>
    <footer>
      <div data-slot="workspace.editor.status" role="status" aria-live="polite">
        {state.error ?? state.snapshot?.message ?? ((state.phase === 'editing' ? tmarText("Local draft · original preserved") : tmarText("Processing CAD…")))}
        {!!state.snapshot?.draftNoteCount && <p>{annotated ? tmarText("{0} notes will be included in the CAD copy; anchors are checked before publishing.", [state.snapshot.draftNoteCount]) : tmarText("Annotated preparation is unavailable for this controller: Apply is disabled.")}</p>}
      </div>
      <label className="workspace-editor-copy-visibility" title={tmarText("Keep the original in the project but hide it after Apply. Undo restores visibility; Redo shows the copy and hides the original again.")}>
        <input type="checkbox" data-test="workspace-editor-hide-source" checked={state.hideSourceAfterApply}
          disabled={state.phase !== 'editing'} onChange={e => { workspaceEditors.setHideSourceAfterApply(e.target.checked) }} />
        <span>{tmarText("Hide original after Apply")}</span>
      </label>
      {state.canPreserveHistory && <label className="workspace-editor-copy-visibility"
        title={tmarText("Keep the edited geometry and notes in the project so editing can resume after saving and reopening.")}>
        <input type="checkbox" data-test="workspace-editor-preserve-history" checked={state.preserveHistory}
          disabled={state.phase !== 'editing'} onChange={event => { workspaceEditors.setPreserveHistory(event.target.checked) }} />
        <span>{tmarText("Preserve editable history")}</span>
      </label>}
      <div className="keys">
        <button type="button" data-test="workspace-editor-frame-reticle" disabled={!state.canFrameReticle}
          title={tmarText("Frame the control net without changing camera orientation; this does not activate automatically")}
          onClick={() => { workspaceEditors.frameReticle() }}>{tmarText("Frame control net")}</button>
      </div>
      <div data-slot="workspace.editor.actions" className="keys">
        <button type="button" data-test="workspace-editor-apply" disabled={!state.canApply}
          title={tmarText("Publish a validated CAD copy as one project action")}
          onClick={() => { void workspaceEditors.apply().catch(() => { /* Error is in the shared state. */ }) }}>{tmarText("Apply")}</button>
        <button type="button" data-test="workspace-editor-cancel" disabled={state.phase === 'committing' || state.phase === 'closing'}
          title={tmarText("Cancel the draft without modifying the original")} onClick={requestEditorCancel}>{tmarText("Cancel")}</button>
      </div>
    </footer>
  </aside>
}
