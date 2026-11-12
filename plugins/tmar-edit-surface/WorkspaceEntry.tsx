// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useCommandActivity } from '../../src/commands/activity'
import { useStore } from '../../src/state/store'
import { bodiesOfPick } from '../reverse/core/bodyFolders'
import { reEditorOpen, selectionItems, useReverse } from '../reverse/state/reStore'
import { EditSurfaceIcon } from './EditSurfaceIcon'
import { workspaceHost } from './workspaceHost'
import './workspaceSurface.css'
import { pluginText as tmarText, useLanguage as useTmarLanguage } from '../../src/i18n'


/** The shared host binds one actual project body before the editor opens. */
export function WorkspaceEntry() {
  useTmarLanguage()

  const [choosing, setChoosing] = useState(false)
  const [bodyId, setBodyId] = useState('')
  const [opening, setOpening] = useState(false)
  const busy = useStore(s => s.busy)
  const running = useCommandActivity(s => s.running !== null)
  const bodies = useReverse(s => s.bodies)
  const building = useReverse(s => s.building)
  const editing = useReverse(s => reEditorOpen(s))
  const playback = useReverse(s => s.playback !== null)
  const unavailable = !workspaceHost?.workspaceEditors.capabilities()?.enabled
  const open = async (id: number) => {
    if (!workspaceHost || opening) return
    setOpening(true)
    try {
      await workspaceHost.workspaceEditors.open('tmar-edit-surface', { bodyId: id })
      setChoosing(false)
    } catch (error) {
      useStore.getState().setError(error instanceof Error ? error.message : String(error))
    } finally { setOpening(false) }
  }
  const begin = () => {
    const state = useReverse.getState()
    const listed = bodiesOfPick(state.bodyFolders, state.listSelection)
    const chosen = new Set([...state.bodies.filter(body => listed.has(body.id)).map(body => body.id),
      ...selectionItems(state.selection).map(item => item.bodyId)])
    const ids = [...chosen].filter(id => state.bodies.some(body => body.id === id))
    if (ids.length === 1) { void open(ids[0]); return }
    if (ids.length === 0 && state.bodies.length === 1) { void open(state.bodies[0].id); return }
    setBodyId('')
    setChoosing(true)
  }
  return <div className="es-feature-entry" data-test="edit-surface-entry">
    <button type="button" data-test="feature-edit-surface" aria-label={tmarText("Edit Surface")}
      title={tmarText("Edit the control points of a CAD face in the main viewport.")}
      disabled={unavailable || !bodies.length || busy || running || building || editing || playback || opening} onClick={begin}>
      <EditSurfaceIcon /><span>{tmarText("Edit Surface")}</span>
    </button>
    {choosing && createPortal(<div className="workspace-surface-choose-back">
      <section className="workspace-surface-choose" role="dialog" aria-modal="true" aria-label={tmarText("Choose CAD body")}>
        <h2>{tmarText("Choose the CAD body")}</h2>
        <label>{tmarText("Body ")}<select data-test="surface-source-body" value={bodyId} onChange={e => setBodyId(e.target.value)}>
          <option value="">{tmarText("Choose…")}</option>{bodies.map(body => <option key={body.id} value={body.id}>{body.name}</option>)}
        </select></label>
        <div><button type="button" disabled={!bodyId || opening} onClick={() => void open(Number(bodyId))}>{tmarText("Continue")}</button>
          <button type="button" disabled={opening} onClick={() => setChoosing(false)}>{tmarText("Cancel")}</button></div>
      </section>
    </div>, document.body)}
  </div>
}
