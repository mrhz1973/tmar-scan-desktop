// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react'
import { useStore } from '../../src/state/store'
import { useWorkspaceEditor, workspaceEditors } from '../../src/plugins/workspaceEditors'
import { selectionItems, useReverse } from '../reverse/state/reStore'
import { bodiesOfPick } from '../reverse/core/bodyFolders'

export function SurfaceHistoryEntry() {
  const [choosing, setChoosing] = useState(false)
  const [bodyId, setBodyId] = useState('')
  const phase = useWorkspaceEditor(s => s.phase)
  const bodies = useReverse(s => s.bodies)
  const features = useReverse(s => s.features)
  const building = useReverse(s => s.building)
  const busy = useStore(s => s.busy)
  const saved = bodies.filter(body => features.some(feature => feature.id === Math.floor(body.id) &&
    feature.kind === 'import' && feature.surfaceEditHistory !== undefined))
  const open = async (id: number) => {
    try {
      await workspaceEditors.reopen('tmar-edit-surface', { bodyId: id })
      setChoosing(false)
    } catch (error) { useStore.getState().setError(error instanceof Error ? error.message : String(error)) }
  }
  const begin = () => {
    const state = useReverse.getState()
    const picked = bodiesOfPick(state.bodyFolders, state.listSelection)
    const selected = new Set([...picked, ...selectionItems(state.selection).map(item => item.bodyId)])
    const matching = saved.filter(body => selected.has(body.id))
    if (matching.length === 1) { void open(matching[0].id); return }
    if (saved.length === 1) { void open(saved[0].id); return }
    setBodyId(''); setChoosing(true)
  }
  return <div className="es-feature-entry" data-test="surface-history-entry">
    <button type="button" data-test="surface-history-reopen" disabled={!saved.length || busy || building || phase !== 'closed'}
      title="Riprende poli e note di una modifica conservata nel progetto" onClick={begin}>Riprendi modifica</button>
    {choosing && <div role="group" aria-label="Scegli modifica salvata">
      <label>Modifica salvata <select data-test="surface-history-body" value={bodyId} onChange={event => setBodyId(event.target.value)}>
        <option value="">Scegli…</option>{saved.map(body => <option key={body.id} value={body.id}>{body.name}</option>)}
      </select></label>
      <button type="button" disabled={!bodyId || phase !== 'closed'} onClick={() => { void open(Number(bodyId)) }}>Riprendi</button>
      <button type="button" onClick={() => setChoosing(false)}>Annulla</button>
    </div>}
  </div>
}
