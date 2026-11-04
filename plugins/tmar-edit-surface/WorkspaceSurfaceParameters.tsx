// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useSyncExternalStore } from 'react'
import type { WorkspaceSurfaceSession } from './workspaceSession'
import type { DragMode } from './localFrame'
import type { NetSelectionMode } from './netSelection'
import { hasSurfaceZebra } from './SurfaceViewport'
import './workspaceSurface.css'
import { useFieldUnits } from '../../src/ui/NumberField'
import { useUnits } from '../../src/app/useUnits'
import { fmtArea } from '../../src/core/units'

/** The host owns Apply and Cancel; this panel edits only the session draft. */
export function WorkspaceSurfaceParameters({ controller }: { controller: WorkspaceSurfaceSession }) {
  const fieldUnits = useFieldUnits('length', undefined)
  const units = useUnits()
  const state = useSyncExternalStore(controller.subscribe, controller.getPanelState, controller.getPanelState)
  const [error, setError] = useState('')
  const [distance, setDistance] = useState(0.1)
  const [smooth, setSmooth] = useState(0.5)
  const [factor, setFactor] = useState(1.1)
  const [stripDistance, setStripDistance] = useState(0.1)
  const disabled = state.busy || state.gesture !== 'idle'
  const editable = state.selected.filter(i => !state.locked.includes(i))
  const axisNames = state.dragMode === 'local' ? ['U', 'V', 'N'] : ['X', 'Y', 'Z']
  const strip = state.strip
  const attempt = (action: () => void | Promise<void>) => {
    try {
      const result = action()
      setError('')
      if (result) void result.catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  const chooseFace = (index: number) => {
    attempt(() => controller.requestFaceSelection(index))
  }
  const closeStrip = () => {
    if (!strip) return
    // Redo frames are still user work even when the current frame was undone.
    const modified = strip.hasResult || strip.canUndo || strip.canRedo
    if (modified && !window.confirm('Scartare le modifiche al bordo? La bozza dei poli rimarrà disponibile.')) return
    attempt(() => controller.cancelStrip(modified))
  }
  const extendStrip = () => {
    if (!strip || strip.selectedEdge < 0 || !Number.isFinite(stripDistance) || Math.abs(stripDistance) <= 1e-7) return
    const delta: [number, number, number] = [0, 0, 0]
    delta[strip.axis] = stripDistance
    attempt(() => controller.applyStripDelta(delta))
  }
  const exportStep = async () => {
    try {
      const output = await controller.exportStep()
      const url = URL.createObjectURL(new Blob([output.step], { type: 'model/step' }))
      const link = document.createElement('a')
      link.href = url
      link.download = output.name
      document.body.append(link)
      try { link.click() } finally {
        link.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 0)
      }
      setError('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  return <div className="workspace-surface-panel" data-test="workspace-surface-parameters">
    <p>Seleziona una faccia nella vista oppure nell’elenco. La modifica resta una bozza CAD fino ad Applica.</p>
    <p>Esporta STEP crea un file locale della geometria CAD convalidata; il file STEP non contiene le note.</p>
    <label>Faccia CAD
      <select data-test="surface-face" value={state.face < 0 ? '' : String(state.face)} disabled={disabled || !!strip}
        onChange={e => { if (e.target.value !== '') chooseFace(Number(e.target.value)) }}>
        <option value="">Scegli una faccia…</option>
        {state.faces.map(face => <option key={face.index} value={face.index} disabled={!!face.reason}>
          {face.index + 1} · {face.kind}{face.reason ? ` · ${face.reason}` : ''}
        </option>)}
      </select>
    </label>
    {state.net && <>
      <button type="button" data-test="surface-export-step" disabled={disabled || !state.canExportStep}
        title={state.notes.length || state.placingNote ? 'Le note non vengono incluse nello STEP: rimuovile prima di esportare.' : 'Scarica la geometria CAD convalidata come STEP.'}
        onClick={() => { void exportStep() }}>Esporta STEP</button>
      {strip ? <fieldset data-test="surface-strip-panel"><legend>Duplica bordo libero</legend>
        <p>Scegli un bordo e trascina D lungo l’asse scelto, oppure indica lo spostamento nelle unità selezionate.</p>
        <label>Bordo libero<select data-test="surface-strip-edge" value={strip.selectedEdge < 0 ? '' : String(strip.selectedEdge)}
          disabled={disabled || strip.pending} onChange={e => {
            if (e.target.value !== '') attempt(() => controller.selectStripEdge(Number(e.target.value)))
          }}>
          <option value="">Scegli un bordo…</option>
          {strip.paths.map((_, index) => <option key={index} value={index}>Bordo {index + 1}</option>)}
        </select></label>
        <label>Direzione<select data-test="surface-strip-axis" value={strip.axis} disabled={disabled || strip.pending}
          onChange={e => attempt(() => controller.setStripAxis(Number(e.target.value) as 0 | 1 | 2))}>
          <option value={0}>X</option><option value={1}>Y</option><option value={2}>Z</option>
        </select></label>
        <label>Spostamento · {fieldUnits.word}<input data-test="surface-strip-distance" type="number" step="any"
          value={Number.isFinite(stripDistance) ? fieldUnits.text(stripDistance) : ''} disabled={disabled || strip.pending}
          onChange={e => setStripDistance(fieldUnits.read(e.target.valueAsNumber))} /></label>
        <button type="button" data-test="surface-strip-extend"
          disabled={disabled || strip.pending || strip.selectedEdge < 0 || !Number.isFinite(stripDistance) || Math.abs(stripDistance) <= 1e-7}
          onClick={extendStrip}>Duplica e sposta il bordo</button>
        <p role="status" data-test="surface-strip-status">{strip.pending ? state.gesture === 'strip'
          ? 'Sposta il bordo; rilascia per verificare la superficie.' : 'Calcolo della superficie in corso…' : strip.hasResult
          ? 'Superficie estesa pronta: puoi continuare oppure usare Applica per creare la copia CAD.'
          : 'Scegli un bordo libero per iniziare.'}</p>
        {strip.hasResult && strip.addedArea !== null && strip.totalArea !== null && <p data-test="surface-strip-area">
          Area aggiunta: {fmtArea(strip.addedArea,units,3)} · Area totale: {fmtArea(strip.totalArea,units,3)}
        </p>}
        <div className="row"><button type="button" data-test="surface-strip-undo" disabled={disabled || strip.pending || !strip.canUndo}
          onClick={() => attempt(() => controller.undo())}>Annulla bordo</button>
          <button type="button" data-test="surface-strip-redo" disabled={disabled || strip.pending || !strip.canRedo}
            onClick={() => attempt(() => controller.redo())}>Ripeti bordo</button></div>
        <button type="button" data-test="surface-strip-cancel" disabled={disabled || strip.pending} onClick={closeStrip}>Torna ai poli</button>
      </fieldset> : <button type="button" data-test="surface-strip-begin" disabled={disabled || !state.canBeginStrip}
        title={!state.canBeginStrip ? 'Serve una superficie aperta a una sola faccia con anteprima valida e senza note.' : 'Duplica un bordo della superficie aperta.'}
        onClick={() => attempt(() => controller.beginStrip())}>Duplica bordo libero</button>}
      {!strip && <>
      {state.canBeginStrip && <label>Direzione CAD per il bordo D
        <select data-test="surface-direct-strip-axis" value={state.directStripAxis} disabled={disabled}
          onChange={e => attempt(() => controller.setDirectStripAxis(Number(e.target.value) as 0 | 1 | 2))}>
          <option value={0}>X</option><option value={1}>Y</option><option value={2}>Z</option>
        </select>
        <span>Clicca un bordo libero per mostrare D. Questa direzione è indipendente da U/V/N dei poli.</span>
      </label>}
      {state.directStripError && <div role="alert" data-test="surface-direct-strip-error">
        <p>{state.directStripError} Puoi riprovare.</p>
        <button type="button" data-test="surface-direct-strip-retry" disabled={disabled}
          onClick={() => attempt(() => controller.retryDirectStripEdges())}>Riprova</button>
      </div>}
      <label>Protezione dei bordi
        <select data-test="surface-continuity" value={state.continuity} disabled={disabled || state.freeBoundary}
          onChange={e => attempt(() => controller.setContinuity(e.target.value as 'G0' | 'G1'))}>
          <option value="G0">G0 · mantieni la posizione dei bordi</option>
          <option value="G1">G1 · mantieni anche le tangenti esistenti</option>
        </select>
      </label>
      <p>La protezione conserva le condizioni esistenti; non corregge automaticamente discontinuità già presenti.</p>
      {state.canFreeBoundary && <label className="inline"><input data-test="surface-free-boundary" type="checkbox"
        checked={state.freeBoundary} disabled={disabled} onChange={e => attempt(() => controller.setFreeBoundary(e.target.checked))} />
        Consenti movimento dei bordi liberi</label>}
      <label>Selezione del reticolo
        <select data-test="surface-selection-mode" value={state.selectionMode} disabled={disabled}
          onChange={e => attempt(() => controller.setSelectionMode(e.target.value as NetSelectionMode))}>
          <option value="auto">Punti, segmenti e celle</option><option value="points">Solo punti</option>
          <option value="edges">Solo segmenti</option><option value="cells">Solo celle</option>
          <option value="mixed">Punti e segmenti</option>
        </select>
      </label>
      <label>Trascinamento
        <select data-test="surface-drag-mode" value={state.dragMode} disabled={disabled}
          onChange={e => attempt(() => controller.setDragMode(e.target.value as DragMode))}>
          <option value="axis">Asse globale</option><option value="screen">Piano dello schermo</option>
          <option value="local">Locale · U / V / normale</option>
        </select>
      </label>
      <div className="row" aria-label="Asse di movimento">{axisNames.map((name, index) =>
        <button type="button" key={name} data-test={`surface-axis-${index}`} disabled={disabled}
          aria-pressed={state.axis === index} onClick={() => attempt(() => controller.setAxis(index as 0 | 1 | 2))}>{name}</button>)}</div>
      {state.dragMode !== 'screen' && <p>Se la direzione punta verso la vista, trascina in verticale per muovere il punto in profondità.</p>}
      <label>Intensità trascinamento · {Math.round(state.dragStrength * 100)}%
        <input data-test="surface-drag-strength" type="range" min="0.05" max="1" step="0.05" value={state.dragStrength}
          disabled={disabled} onChange={e => attempt(() => controller.setDragStrength(Number(e.target.value)))} />
      </label>
      <fieldset><legend>Magnete</legend>
        <label className="inline"><input data-test="surface-snap" type="checkbox" checked={state.snap} disabled={disabled}
          onChange={e => attempt(() => controller.setSnap(e.target.checked))} /> Aggancia a scansione e CAD vicini</label>
        {state.snap && <><label>Portata · {fieldUnits.word}<input data-test="surface-snap-distance" type="number" min={fieldUnits.min(0.001)} max={fieldUnits.min(1000)} step={fieldUnits.step(0.1)}
          value={fieldUnits.text(state.snapDistance)} disabled={disabled} onChange={e => { if (Number.isFinite(e.target.valueAsNumber)) attempt(() => controller.setSnapDistance(fieldUnits.read(e.target.valueAsNumber))) }} /></label>
          <p>Alt sospende il magnete durante il trascinamento. L’aggancio usa la geometria visualizzata.</p></>}
      </fieldset>
      <label className="inline"><input data-test="surface-control-net" type="checkbox" checked={state.showNet} disabled={disabled}
        onChange={e => attempt(() => controller.setShowNet(e.target.checked))} /> Mostra reticolo</label>
      <fieldset><legend>Simmetria dei poli</legend>
        <label className="inline"><input data-test="surface-symmetry" type="checkbox" checked={state.symmetry} disabled={disabled}
          onChange={e => attempt(() => controller.setSymmetry(e.target.checked))} /> Modifica anche il polo speculare</label>
        {state.symmetry && <>
          <label>Piano<select data-test="surface-mirror-plane" value={state.mirrorAxis} disabled={disabled}
            onChange={e => attempt(() => controller.setMirrorAxis(Number(e.target.value)))}>
            <option value={0}>YZ</option><option value={1}>XZ</option><option value={2}>XY</option>
          </select></label>
          <label>Posizione del piano · {fieldUnits.word}<input key={`${state.mirrorAxis}:${state.mirrorOffset}`} data-test="surface-mirror-offset"
            type="number" step="any" defaultValue={fieldUnits.text(state.mirrorOffset)} disabled={disabled} onBlur={e => {
              if (Number.isFinite(e.target.valueAsNumber)) attempt(() => controller.setMirrorOffset(fieldUnits.read(e.target.valueAsNumber)))
              else e.target.value = fieldUnits.text(state.mirrorOffset)
            }} /></label>
          <p role="status">{state.symmetryBlocked ? 'La selezione contiene un polo speculare mancante, ambiguo o bloccato.' :
            'I poli speculari sono mostrati in viola; quelli sul piano restano sul piano.'}</p>
          <button type="button" data-test="surface-project-poles" disabled={disabled || !editable.length}
            onClick={() => attempt(() => controller.projectSelectedToMirrorPlane())}>Porta i poli selezionati sul piano</button>
        </>}
      </fieldset>
      </>}
      {hasSurfaceZebra && <fieldset><legend>Analisi Zebra</legend>
        <label className="inline"><input data-test="surface-zebra" type="checkbox" checked={!!state.stripes} disabled={disabled}
          onChange={e => attempt(() => controller.setStripes(e.target.checked ? { orientation: 'horizontal', width: 3, color: '#5388b1' } : null))} /> Mostra strisce sulla preview</label>
        {state.stripes && <>
          <label>Orientamento<select data-test="surface-zebra-direction" value={state.stripes.orientation} disabled={disabled}
            onChange={e => attempt(() => controller.setStripes({ ...state.stripes!, orientation: e.target.value as 'horizontal' | 'vertical' }))}>
            <option value="horizontal">Orizzontale</option><option value="vertical">Verticale</option>
          </select></label>
          <label>Larghezza · {state.stripes.width}<input type="range" min="1" max="7" step="1" value={state.stripes.width} disabled={disabled}
            onChange={e => attempt(() => controller.setStripes({ ...state.stripes!, width: Number(e.target.value) }))} /></label>
          <label>Colore<input type="color" value={state.stripes.color} disabled={disabled}
            onChange={e => attempt(() => controller.setStripes({ ...state.stripes!, color: e.target.value }))} /></label>
        </>}
      </fieldset>}
      <label>Trasparenza superficie · {Math.round(state.transparency * 100)}%<input data-test="surface-transparency"
        type="range" min="0" max="0.9" step="0.05" value={state.transparency} disabled={disabled}
        onChange={e => attempt(() => controller.setTransparency(Number(e.target.value)))} /></label>
      {!strip && <>
      <p data-test="surface-selection">{state.selected.length} selezionati · {editable.length} modificabili</p>
      <div className="row"><button type="button" disabled={disabled} onClick={() => attempt(() => controller.selectAllFree())}>Seleziona liberi</button>
        <button type="button" disabled={disabled} onClick={() => attempt(() => controller.clearSelection())}>Nessuno</button></div>
      <div className="row"><button type="button" disabled={disabled || !state.selected.length} onClick={() => attempt(() => controller.lockSelected(true))}>Blocca punti</button>
        <button type="button" disabled={disabled || !state.selected.length} onClick={() => attempt(() => controller.lockSelected(false))}>Sblocca punti</button></div>
      <label>Spostamento · {fieldUnits.word}<input data-test="surface-distance" type="number" step={fieldUnits.step(0.1)} value={Number.isFinite(distance) ? fieldUnits.text(distance) : ''}
        onChange={e => setDistance(fieldUnits.read(e.target.valueAsNumber))} disabled={disabled} /></label>
      <button type="button" data-test="surface-move" disabled={disabled || state.symmetryBlocked || !editable.length || !Number.isFinite(distance)}
        onClick={() => attempt(() => controller.moveSelected(distance))}>Sposta lungo {axisNames[state.axis]}</button>
      <button type="button" disabled={disabled || state.symmetryBlocked || !editable.length} onClick={() => attempt(() => controller.flattenSelected())}>Spiana i punti selezionati</button>
      <label>Levigatura · {Math.round(smooth * 100)}%<input type="range" min="0.05" max="1" step="0.05" value={smooth}
        disabled={disabled} onChange={e => setSmooth(Number(e.target.value))} /></label>
      <button type="button" data-test="surface-smooth" disabled={disabled || state.symmetryBlocked || !editable.length}
        onClick={() => attempt(() => controller.smoothSelected(smooth))}>Leviga i punti selezionati</button>
      <label>Fattore di stiramento<input type="number" min="0.1" max="3" step="0.1" value={Number.isFinite(factor) ? factor : ''}
        disabled={disabled} onChange={e => setFactor(e.target.valueAsNumber)} /></label>
      <button type="button" disabled={disabled || state.symmetryBlocked || !editable.length || !(factor > 0 && factor <= 3)}
        onClick={() => attempt(() => controller.stretchSelected(factor))}>Stira lungo {['X', 'Y', 'Z'][state.axis]}</button>
      <div className="row"><button type="button" data-test="surface-undo" disabled={disabled || !state.canUndo} onClick={() => attempt(() => controller.undo())}>Annulla modifica</button>
        <button type="button" data-test="surface-redo" disabled={disabled || !state.canRedo} onClick={() => attempt(() => controller.redo())}>Ripeti</button>
        <button type="button" disabled={disabled} onClick={() => attempt(() => controller.restoreOriginal())}>Ripristina</button></div>
      <fieldset><legend>Note sulla superficie</legend>
        <button type="button" data-test="surface-note-add" disabled={disabled || state.calculating} aria-pressed={state.placingNote}
          onClick={() => attempt(() => controller.setPlacingNote(!state.placingNote))}>{state.placingNote ? 'Annulla scelta punto' : 'Aggiungi nota'}</button>
        {state.placingNote && <p>Clicca sulla faccia modificata per posizionare la nota.</p>}
        {state.notes.map((note, index) => <div key={note.id}><label>Nota {index + 1}<input data-test="surface-note-text" value={note.text} maxLength={2000} disabled={disabled}
          onChange={e => attempt(() => controller.setNoteText(note.id, e.target.value))} /></label>
          <button type="button" disabled={disabled} onClick={() => attempt(() => controller.removeNote(note.id))}>Rimuovi nota</button></div>)}
        {state.noteResolutionError && <div role="alert"><p>Non è stato possibile aggiornare la posizione delle note. Sono ancora nella bozza.</p>
          <button type="button" data-test="surface-note-retry" disabled={disabled} onClick={() => attempt(() => controller.retryNoteResolution())}>Riprova</button></div>}
        {!!state.notes.length && <p>{state.annotatedCopyAvailable
          ? 'Con Applica le note complete vengono salvate nel progetto insieme alla copia CAD. Per esportare solo lo STEP, rimuovi prima le note dalla bozza.'
          : 'Le note restano nella bozza e non vengono incluse nello STEP né salvate nel progetto. Rimuovile prima di esportare o applicare.'}</p>}
        {state.annotatedCopyAvailable && state.notes.some(note => !note.text.trim()) && <p>Scrivi il testo di tutte le note prima di applicare.</p>}
      </fieldset>
      </>}
    </>}
    {error && <p role="alert">{error}</p>}
  </div>
}
