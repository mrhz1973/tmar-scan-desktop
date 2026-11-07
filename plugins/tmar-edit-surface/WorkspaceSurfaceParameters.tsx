// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect,useRef,useState, useSyncExternalStore } from 'react'
import type { WorkspaceSurfaceSession, WholeBoundarySide } from './workspaceSession'
import type { DragMode } from './localFrame'
import type { NetSelectionMode } from './netSelection'
import { hasSurfaceZebra } from './SurfaceViewport'
import { formatTangentSpanDisplacement } from './tangentSpan'
import { wholeBoundaryIndices } from './wholeBoundary'
import { parseNumericInput } from './numericInput'
import './workspaceSurface.css'

/** The host owns Apply and Cancel; this panel edits only the session draft. */
export function WorkspaceSurfaceParameters({ controller }: { controller: WorkspaceSurfaceSession }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getPanelState, controller.getPanelState)
  const [error, setError] = useState('')
  const [smooth, setSmooth] = useState(0.5)
  const [pointBudgetText, setPointBudgetText] = useState('1')
  const [multipleTargets,setMultipleTargets]=useState(false)
  const panelRef=useRef<HTMLDivElement>(null),removedPair=useRef<number|null>(null)
  const previousTarget=useRef<typeof state.surfaceTarget>(null)
  useEffect(()=>{
    const panel=panelRef.current
    if(!panel)return
    if(removedPair.current!==null&&state.surfaceTargetBatch){
      const buttons=panel.querySelectorAll<HTMLButtonElement>('[data-test=surface-point-remove]')
      const next=buttons[Math.min(removedPair.current,buttons.length-1)]??panel.querySelector<HTMLButtonElement>('[data-test=surface-point-cancel]')
      next?.focus();removedPair.current=null
    }
    const previous=previousTarget.current;previousTarget.current=state.surfaceTarget
    if(previous&&!state.surfaceTarget){
      const active=panel.ownerDocument.activeElement
      if(active===panel.ownerDocument.body||(active&&panel.contains(active))){
        const start=panel.querySelector<HTMLButtonElement>(`[data-test=surface-point-${previous}]`)
        const fallback=panel.querySelector<HTMLInputElement>('[data-test=surface-point-multiple]')
        ;(start&&!start.disabled?start:fallback)?.focus()
      }
    }
  },[state.surfaceTargetBatch,state.surfaceTarget])
  const [wholeBoundary,setWholeBoundary] = useState<WholeBoundarySide>('U0')
  const [boundaryAxis,setBoundaryAxis] = useState<0|1|2>(2)
  const [boundaryDistanceText,setBoundaryDistanceText] = useState('0.1')
  const [distanceText,setDistanceText] = useState('0.1')
  const [factorText,setFactorText] = useState('1.1')
  const distanceValue=parseNumericInput(distanceText)
  const factorValue=parseNumericInput(factorText)
  const [stripDistanceText, setStripDistanceText] = useState('0.1')
  const stripDistance=parseNumericInput(stripDistanceText)
  const pointBudget=parseNumericInput(pointBudgetText)
  const boundaryDistance=parseNumericInput(boundaryDistanceText)
  const [g1Pending, setG1Pending] = useState<'load' | 'apply' | null>(null)
  const [g1Error, setG1Error] = useState('')
  const disabled = state.busy || state.gesture !== 'idle'
  const hiddenPoles = controller.getViewState().hiddenPoles
  const editable = state.selected.filter(i => !state.locked.includes(i) && !hiddenPoles.includes(i))
  const activeWholeBoundary=state.wholeBoundaryDrag ?? wholeBoundary
  const boundaryPoles = state.canFreeBoundary && state.net ? wholeBoundaryIndices(state.net,activeWholeBoundary) : []
  const boundaryManuallyLocked = boundaryPoles.length > 0 && boundaryPoles.every(id => state.manualLocks.includes(id))
  const hasFreeVisiblePoint = !!state.net?.poles.some((_, index) => !state.locked.includes(index) && !hiddenPoles.includes(index))
  const axisNames = state.dragMode === 'local' ? ['U', 'V', 'N'] : ['X', 'Y', 'Z']
  const strip = state.strip
  const cylinder = !!state.faces[state.face]?.experimentalCylinder
  const g1Candidates = state.g1Candidates ?? []
  const tangencyActive = state.planeTangencyActive || state.curvedTangencyActive
  const curvedSupportChosen = g1Candidates.some(candidate => candidate.id === state.g1Choice && candidate.kind === 'compatible-bspline')
  const g1Disabled = disabled || state.calculating || g1Pending !== null
  const runG1 = async (operation: 'load' | 'apply') => {
    setG1Pending(operation)
    setG1Error('')
    try {
      if (operation === 'load') await controller.loadG1Supports()
      else await controller.applyG1()
    } catch (reason) {
      setG1Error(reason instanceof Error ? reason.message : String(reason))
    } finally { setG1Pending(null) }
  }
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
    if (!strip || strip.selectedEdge < 0 || stripDistance===null || Math.abs(stripDistance) <= 1e-7) return
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
  return <div ref={panelRef} className="workspace-surface-panel" data-test="workspace-surface-parameters">
    <p>Seleziona una faccia nella vista oppure nell’elenco. La modifica resta una bozza CAD fino ad Applica.</p>
    <p>Esporta STEP crea un file locale della geometria CAD convalidata; il file STEP non contiene le note.</p>
    <label>Faccia CAD
      <select data-test="surface-face" value={state.face < 0 ? '' : String(state.face)} disabled={disabled || !!strip}
        onChange={e => { if (e.target.value !== '') chooseFace(Number(e.target.value)) }}>
        <option value="">Scegli una faccia…</option>
        {state.faces.map(face => <option key={face.index} value={face.index} disabled={!!face.reason && !face.experimentalCylinder && !(face.kind==='plane' && face.reason==='Tutti i poli influenzano un contorno ritagliato.')}>
          {face.index + 1} · {face.kind}{face.experimentalCylinder ? ' · anteprima sperimentale' : face.kind==='plane' && face.reason==='Tutti i poli influenzano un contorno ritagliato.' ? ' · tenta raffinamento protetto' : face.reason ? ` · ${face.reason}` : ''}
        </option>)}
      </select>
    </label>
    {state.net && <>
      {cylinder && <div><p>Cilindro sperimentale: i controlli CAD sono campionati; verifica il risultato prima dell’uso e prima di aggiungere note.</p>
        <button type="button" data-test="surface-validate-cylinder" disabled={disabled || state.calculating}
          onClick={() => attempt(() => controller.validateCylinder())}>Verifica CAD del cilindro</button></div>}
      <button type="button" data-test="surface-export-step" disabled={disabled || !state.canExportStep}
        title={state.notes.length || state.placingNote ? 'Le note non vengono incluse nello STEP: rimuovile prima di esportare.' : 'Scarica la geometria CAD convalidata come STEP.'}
        onClick={() => { void exportStep() }}>Esporta STEP</button>
      {(state.duplicateCadFace || state.faces[state.face]?.canDuplicateCadFace) && <div>
        <label className="inline"><input data-test="surface-duplicate-cad-face" type="checkbox" checked={state.duplicateCadFace}
          disabled={disabled || (!state.duplicateCadFace && !state.canDuplicateCadFace)} onChange={e => attempt(() => controller.setDuplicateCadFace(e.target.checked))} />
          Duplica faccia CAD</label>
        {state.duplicateCadFace && <p role="status">{state.duplicateCadFaceStale
          ? 'Preview cambiata. Togli la spunta e scegli di nuovo cosa applicare.'
          : 'Con Applica, la faccia della preview diventa una superficie CAD separata. Il solido resta nel progetto. Per mantenerlo visibile, togli la spunta a «Nascondi l’originale dopo Applica».'}</p>}
      </div>}
      <label className="inline"><input data-test="surface-navigation-only" type="checkbox" checked={state.navigationOnly} disabled={disabled}
        onChange={e => attempt(() => controller.setNavigationOnly(e.target.checked))} />
        Naviga nella vista (sospendi modifica del reticolo)</label>
      {strip ? <fieldset data-test="surface-strip-panel"><legend>Duplica bordo libero</legend>
        <p>Scegli un bordo e trascina D lungo l’asse scelto, oppure indica lo spostamento in millimetri.</p>
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
        <label>Spostamento · mm<input data-test="surface-strip-distance" type="text" inputMode="decimal"
          value={stripDistanceText} disabled={disabled || strip.pending}
          onChange={e => setStripDistanceText(e.target.value)} /></label>
        <button type="button" data-test="surface-strip-extend"
          disabled={disabled || strip.pending || strip.selectedEdge < 0 || stripDistance===null || Math.abs(stripDistance) <= 1e-7}
          onClick={extendStrip}>Duplica e sposta il bordo</button>
        <p role="status" data-test="surface-strip-status">{strip.pending ? state.gesture === 'strip'
          ? 'Sposta il bordo; rilascia per verificare la superficie.' : 'Calcolo della superficie in corso…' : strip.hasResult
          ? 'Superficie estesa pronta: puoi continuare oppure usare Applica per creare la copia CAD.'
          : 'Scegli un bordo libero per iniziare.'}</p>
        {strip.hasResult && strip.addedArea !== null && strip.totalArea !== null && <p data-test="surface-strip-area">
          Area aggiunta: {strip.addedArea.toLocaleString('it-IT', { maximumFractionDigits: 3 })} mm² · Area totale: {strip.totalArea.toLocaleString('it-IT', { maximumFractionDigits: 3 })} mm²
        </p>}
        <div className="row"><button type="button" data-test="surface-strip-undo" disabled={disabled || strip.pending || !strip.canUndo}
          onClick={() => attempt(() => controller.undo())}>Annulla bordo</button>
          <button type="button" data-test="surface-strip-redo" disabled={disabled || strip.pending || !strip.canRedo}
            onClick={() => attempt(() => controller.redo())}>Ripeti bordo</button></div>
        <button type="button" data-test="surface-strip-cancel" disabled={disabled || strip.pending} onClick={closeStrip}>Torna ai poli</button>
      </fieldset> : <button type="button" data-test="surface-strip-begin" disabled={disabled || !state.canBeginStrip}
        title={!state.canBeginStrip ? 'Serve una superficie aperta con anteprima valida e senza note o vincoli G1 attivi.' : 'Duplica un bordo libero della superficie aperta.'}
        onClick={() => attempt(() => controller.beginStrip())}>Duplica bordo libero</button>}
      {!strip && <>
      <fieldset data-test="surface-point-target"><legend>Porta un punto della superficie sul riferimento</legend>
        <p>Seleziona i poli liberi, scegli il riferimento e clicca un punto della faccia. Cerco il riferimento esterno più vicino lungo la normale CAD, nei due versi, entro {state.snapDistance} mm. Il punto della superficie si muove; i poli possono muoversi di più.</p>
        <label>Limite spostamento di ciascun polo · mm<input data-test="surface-point-budget" type="text" inputMode="decimal" value={pointBudgetText}
          disabled={disabled || !!state.surfaceTarget} onChange={e=>setPointBudgetText(e.target.value)} /></label>
        <label><input data-test="surface-point-multiple" type="checkbox" checked={multipleTargets} disabled={disabled||!!state.surfaceTarget}
          onChange={e=>setMultipleTargets(e.target.checked)}/>Raccogli più punti prima di applicare</label>
        <div className="row"><button type="button" data-test="surface-point-scan" disabled={disabled || !!state.surfaceTarget || !state.canTargetPoint || pointBudget===null || pointBudget<=0 || pointBudget>1000}
          onClick={()=>{if(pointBudget!==null&&pointBudget>0&&pointBudget<=1000)attempt(()=>controller.beginSurfaceTarget('scan',pointBudget,multipleTargets))}}>{multipleTargets?'Raccogli sulla scansione':'Punto sulla scansione'}</button>
        <button type="button" data-test="surface-point-cad" disabled={disabled || !!state.surfaceTarget || !state.canTargetPoint || pointBudget===null || pointBudget<=0 || pointBudget>1000}
          onClick={()=>{if(pointBudget!==null&&pointBudget>0&&pointBudget<=1000)attempt(()=>controller.beginSurfaceTarget('cad',pointBudget,multipleTargets))}}>{multipleTargets?'Raccogli sul CAD esterno':'Punto sul CAD esterno'}</button></div>
        {(state.surfaceTarget === 'scan' || state.surfaceTarget === 'cad') && <><p role="status" aria-live="polite" aria-atomic="true" data-test="surface-point-announcement">{state.surfaceTargetBatch?
          `Punti raccolti: ${state.surfaceTargetBatch.length} di 8. ${state.surfaceTargetBatch.length>=2?'Puoi applicare gli agganci con una sola Undo.':'Servono almeno due punti per applicare.'} Destinazione: ${state.surfaceTarget==='scan'?'scansione':'CAD esterno'}.`:
          `Clicca un punto sulla faccia selezionata. Destinazione: ${state.surfaceTarget==='scan'?'scansione':'CAD esterno'}.`}</p>
          {state.surfaceTargetBatch && <>
            <p>Da 2 a 8 agganci simultanei. Nessuna geometria cambia durante la raccolta. Blu: punto CAD; arancio: destinazione. Le coordinate sono nel corpo, in mm.</p>
            <ol data-test="surface-point-pairs">{state.surfaceTargetBatch.map((pair,index)=><li key={index}>
              {pair.label}: ({pair.at.map(x=>x.toFixed(3)).join(', ')}) → ({pair.target.map(x=>x.toFixed(3)).join(', ')}) · {Math.hypot(...pair.at.map((x,d)=>x-pair.target[d])).toFixed(4)} mm
              <button type="button" data-test="surface-point-remove" disabled={disabled} onClick={()=>attempt(()=>{removedPair.current=index;controller.removeSurfaceTarget(index)})}>Rimuovi punto {index+1}</button>
            </li>)}</ol>
            <button type="button" data-test="surface-point-apply" disabled={disabled||state.surfaceTargetBatch.length<2}
              onClick={()=>attempt(()=>controller.applySurfaceTargets())}>Applica {state.surfaceTargetBatch.length} agganci · una Undo</button>
          </>}
          <button type="button" data-test="surface-point-cancel" onClick={()=>controller.cancelSurfaceTarget()}>Annulla scelta punto</button></>}
        <p>Il riferimento usa i triangoli visualizzati. L’esito richiede la verifica CAD; le protezioni dei bordi restano attive. Disattiva simmetria e tangenze aggiunte per usare questo comando.</p>
      </fieldset>
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
        <select data-test="surface-continuity" value={state.continuity} disabled={disabled || state.freeBoundary || tangencyActive}
          onChange={e => attempt(() => controller.setContinuity(e.target.value as 'G0' | 'G1'))}>
          <option value="G0">G0 · mantieni la posizione dei bordi</option>
          <option value="G1">G1 · mantieni anche le tangenti esistenti</option>
        </select>
      </label>
      <p>La protezione conserva le condizioni esistenti; non corregge automaticamente discontinuità già presenti.</p>
      <fieldset data-test="surface-g1-panel"><legend>Tangente a una faccia adiacente</legend>
        <p>Scegli un bordo condiviso e un supporto piano o B-spline compatibile a cui rendere tangente la superficie. La modifica resta nella bozza fino ad Applica.</p>
        <button type="button" data-test="surface-g1-load" disabled={g1Disabled || !state.canLoadG1}
          onClick={() => { void runG1('load') }}>Carica supporti G1</button>
        <label>Bordo e faccia di supporto
          <select data-test="surface-g1-support" value={state.g1Choice ?? ''}
            disabled={g1Disabled || !state.canLoadG1 || !g1Candidates.length} onChange={e => {
              if (!e.target.value) return
              setG1Error('')
              try { controller.chooseG1Support(e.target.value) }
              catch (reason) { setG1Error(reason instanceof Error ? reason.message : String(reason)) }
            }}>
            <option value="">Scegli bordo e faccia…</option>
            {g1Candidates.map(candidate => <option key={candidate.id} value={candidate.id}>
              Bordo {candidate.edgeIndex + 1} · faccia {candidate.kind === 'compatible-bspline' ? 'B-spline compatibile' : 'piana'} {candidate.supportFaceIndex + 1} · {candidate.lengthMm.toLocaleString('it-IT', { maximumFractionDigits: 3 })} mm
            </option>)}
          </select>
        </label>
        <button type="button" data-test="surface-g1-apply" disabled={g1Disabled || !state.canApplyG1}
          onClick={() => { void runG1('apply') }}>Applica tangente alla bozza</button>
        <p role="status" data-test="surface-g1-status">{g1Pending === 'load' ? 'Ricerca dei supporti CAD in corso…'
          : g1Pending === 'apply' ? 'Calcolo e verifica della tangente in corso…'
          : state.planeTangencyActive ? 'Vincolo di tangente al supporto piano attivo nella bozza.'
          : state.curvedTangencyActive ? 'Vincolo di tangente al supporto B-spline compatibile attivo nella bozza.'
          : state.g1Choice ? `Supporto ${curvedSupportChosen ? 'B-spline compatibile' : 'piano'} scelto: applica la tangente alla bozza.`
          : g1Candidates.length ? 'Scegli il bordo e la faccia piana o B-spline compatibile di supporto.'
          : state.message === 'Nessun bordo naturale con un supporto adiacente compatibile disponibile.' ? state.message
          : 'Carica i supporti per cercare bordi condivisi con facce piane o B-spline compatibili.'}</p>
        {g1Error && <p role="alert" data-test="surface-g1-error">{g1Error}</p>}
        {state.g1SearchNotice && <p role="status" data-test="surface-g1-search-notice">{state.g1SearchNotice}</p>}
        <p data-test="surface-g1-limits">Sono ammessi solo bordi condivisi rettilinei su facce naturali a quattro lati senza fori. Per i supporti B-spline servono superfici native non razionali con basi compatibili sul bordo; non viene eseguito un adattamento automatico. Il vincolo riguarda il bordo scelto; non certifica la continuità G1 dell’intero modello. La Zebra aiuta il controllo visivo.</p>
        {(curvedSupportChosen || state.curvedTangencyActive) && <p data-test="surface-g1-curved-limits">Quando disponibile, la vista evidenzia il supporto B-spline in arancione e il bordo comune in giallo. Applica crea la copia CAD. Il salvataggio del vincolo come ricetta modificabile non è ancora disponibile.</p>}
      </fieldset>
      {state.canFreeBoundary && <label className="inline"><input data-test="surface-free-boundary" type="checkbox"
        checked={state.freeBoundary} disabled={disabled} onChange={e => attempt(() => controller.setFreeBoundary(e.target.checked))} />
        Consenti movimento dei bordi liberi</label>}
      {state.canFreeBoundary && <fieldset data-test="surface-whole-boundary"><legend>Sposta o blocca un bordo naturale</legend>
        <p>Disponibile su una sola faccia aperta con quattro bordi naturali. Attiva prima il movimento dei bordi liberi. Il comando muove l’intero bordo; i suoi estremi modificano anche i bordi adiacenti.</p>
        <label>Bordo naturale<select data-test="surface-whole-boundary-side" value={activeWholeBoundary} disabled={disabled}
          onChange={e=>{const side=e.target.value as WholeBoundarySide;setWholeBoundary(side);if(state.wholeBoundaryDrag)attempt(()=>controller.setWholeBoundaryDrag(side))}}>
          <option value="U0">U iniziale</option><option value="U1">U finale</option><option value="V0">V iniziale</option><option value="V1">V finale</option>
        </select></label>
        <button type="button" data-test="surface-whole-boundary-lock"
          disabled={disabled || !state.canMoveWholeBoundary || boundaryManuallyLocked}
          onClick={() => attempt(() => {
            controller.lockWholeBoundary(activeWholeBoundary)
            setWholeBoundary(activeWholeBoundary)
          })}>
          {boundaryManuallyLocked ? 'Poli del bordo bloccati' : 'Blocca i poli del bordo'}
        </button>
        <p>Il blocco include gli angoli condivisi. Puoi annullarlo con Undo o gestire i singoli poli con i comandi di blocco.</p>
        <label>Direzione XYZ del corpo<select data-test="surface-whole-boundary-axis" value={boundaryAxis} disabled={disabled}
          onChange={e=>setBoundaryAxis(Number(e.target.value) as 0|1|2)}>
          <option value={0}>X</option><option value={1}>Y</option><option value={2}>Z</option>
        </select></label>
        <label>Spostamento · mm<input data-test="surface-whole-boundary-distance" type="text" inputMode="decimal" value={boundaryDistanceText}
          disabled={disabled} onChange={e=>setBoundaryDistanceText(e.target.value)} /></label>
        <button type="button" data-test="surface-whole-boundary-move" disabled={disabled || !state.canMoveWholeBoundary ||
          boundaryPoles.some(id => state.locked.includes(id) || hiddenPoles.includes(id)) ||
          boundaryDistance===null || Math.abs(boundaryDistance)<=1e-7 || Math.abs(boundaryDistance)>1000}
          onClick={()=>{if(boundaryDistance!==null&&Math.abs(boundaryDistance)>1e-7&&Math.abs(boundaryDistance)<=1000)attempt(()=>{const delta:[number,number,number]=[0,0,0];delta[boundaryAxis]=boundaryDistance;controller.moveWholeBoundary(activeWholeBoundary,delta)})}}>Sposta intero bordo</button>
        <label className="inline"><input data-test="surface-whole-boundary-drag" type="checkbox" checked={!!state.wholeBoundaryDrag}
          disabled={disabled || (!state.wholeBoundaryDrag && !state.canMoveWholeBoundary)}
          onChange={e=>attempt(()=>{if(!e.target.checked)setWholeBoundary(activeWholeBoundary);controller.setWholeBoundaryDrag(e.target.checked?activeWholeBoundary:null)})} />Trascina un bordo naturale nella vista</label>
        {state.wholeBoundaryDrag && <p>Puoi afferrare uno qualsiasi dei quattro bordi naturali. Il bordo indicato nel pannello segue quello scelto nella vista. Il gesto usa direzione e intensità del reticolo, senza magnete. Fuori dai bordi puoi navigare; Escape annulla il gesto. Il comando numerico usa invece l’asse XYZ qui sopra.</p>}
        <p>Un polo bloccato impedisce il movimento di tutto il bordo. Il risultato richiede la verifica CAD e si annulla con un solo Undo. Non viene aggiunta una striscia.</p>
      </fieldset>}
      {state.canFreeBoundary && <fieldset data-test="surface-whole-face">
        <legend>Sposta intera faccia aperta</legend>
        <label className="inline"><input data-test="surface-whole-face-drag" type="checkbox"
          checked={state.wholeFaceDrag} disabled={disabled || (!state.wholeFaceDrag && !state.canMoveWholeFace)}
          onChange={e => attempt(() => controller.setWholeFaceDrag(e.target.checked))} />Trascina la faccia nella vista</label>
        <p>Attiva i bordi liberi su una singola faccia naturale e sblocca tutti i poli. Afferra la superficie per traslarla senza magnete. In modalità Locale, gli assi U, V e N si calcolano nel punto CAD cliccato. Con un piano di sezione attivo, usa Schermo o Assi XYZ. Il trascinamento richiede la verifica CAD e si annulla in un solo passaggio.</p>
      </fieldset>}
      <label>Selezione del reticolo
        <select data-test="surface-selection-mode" value={state.selectionMode} disabled={disabled}
          onChange={e => attempt(() => controller.setSelectionMode(e.target.value as NetSelectionMode))}>
          <option value="auto">Punti, segmenti e celle</option><option value="points">Solo punti</option>
          <option value="edges">Solo segmenti</option><option value="cells">Solo celle</option>
          <option value="mixed">Punti e segmenti</option>
        </select>
      </label>
      {state.selectionMode === 'auto' && <p>Per spostare una cella, selezionala con un clic e poi trascinala. Un trascinamento su una cella non selezionata resta disponibile per la navigazione.</p>}
      <fieldset data-test="surface-refine-net"><legend>Raffina reticolo</legend>
        <p>Aggiungi punti di controllo nella direzione scelta per modificare il reticolo più finemente.</p>
        <div className="row">{(['U', 'V', 'both'] as const).map(axis => {
          const direction = axis === 'both' ? 'in entrambe le direzioni U e V' : `nella direzione ${axis}`
          return <button type="button" key={axis} data-test={`surface-refine-${axis}`}
            disabled={disabled || !state.canRefineNet}
            title={`Aggiunge punti di controllo ${direction}.\nScegli U, V oppure entrambe per il reticolo attuale.\nRichiede una faccia modificabile e nessuna operazione in corso.\nIl risultato resta nella bozza fino ad Applica.`}
            onClick={() => attempt(() => controller.refineNet(axis))}>
            {axis === 'both' ? 'Raffina U e V' : `Raffina ${axis}`}
          </button>
        })}</div>
      </fieldset>
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
        {state.snap && <><label>Portata · mm<input key={state.snapDistance} data-test="surface-snap-distance" type="number" min="0.001" max="1000" step="any"
          defaultValue={state.snapDistance} disabled={disabled} onBlur={e => {
            const value = e.currentTarget.valueAsNumber
            if (Number.isFinite(value) && value >= .001 && value <= 1000) attempt(() => controller.setSnapDistance(value))
            else { e.currentTarget.value = String(state.snapDistance); setError('Portata magnete: inserisci un valore tra 0,001 e 1000 mm.') }
          }} onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.currentTarget.value = String(state.snapDistance); e.currentTarget.blur() }
          }} /></label>
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
          <label>Posizione del piano · mm<input key={`${state.mirrorAxis}:${state.mirrorOffset}`} data-test="surface-mirror-offset"
            type="number" step="any" defaultValue={state.mirrorOffset} disabled={disabled} onBlur={e => {
              if (Number.isFinite(e.target.valueAsNumber)) attempt(() => controller.setMirrorOffset(e.target.valueAsNumber))
              else e.target.value = String(state.mirrorOffset)
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
      <div className="row"><button type="button" data-test="surface-next-free" disabled={disabled || !hasFreeVisiblePoint}
        title="Seleziona il prossimo punto visibile e non bloccato, utile nei reticoli fitti."
        onClick={() => attempt(() => {
          const view=controller.getViewState(), net=view.net
          if (!net) throw new Error('Seleziona prima una faccia.')
          const available=net.poles.map((_,index)=>index).filter(index=>!view.locked.includes(index) && !view.hiddenPoles.includes(index))
          if (!available.length) throw new Error('Nessun punto modificabile disponibile.')
          const current=available.indexOf(view.selected.length===1 ? view.selected[0] : -1)
          controller.selectPoints([available[(current+1)%available.length]],false)
        })}>Prossimo punto modificabile</button>
        <button type="button" disabled={disabled} onClick={() => attempt(() => controller.selectAllFree())}>Seleziona liberi</button>
        <button type="button" disabled={disabled} onClick={() => attempt(() => controller.clearSelection())}>Nessuno</button></div>
      <div className="row"><button type="button" disabled={disabled || !state.selected.length} onClick={() => attempt(() => controller.lockSelected(true))}>Blocca punti</button>
        <button type="button" disabled={disabled || !state.selected.length} onClick={() => attempt(() => controller.lockSelected(false))}>Sblocca punti</button></div>
      <label>Spostamento · mm<input data-test="surface-distance" type="text" inputMode="decimal" value={distanceText}
        onChange={e => setDistanceText(e.target.value)}
        onBlur={() => { if(distanceText.trim()==='-')setDistanceText('') }} disabled={disabled} /></label>
      <button type="button" data-test="surface-move" disabled={disabled || state.symmetryBlocked || !editable.length || distanceValue===null}
        onClick={() => { if(distanceValue!==null)attempt(() => controller.moveSelected(distanceValue)) }}>Sposta lungo {axisNames[state.axis]}</button>
      <button type="button" disabled={disabled || state.symmetryBlocked || !editable.length} onClick={() => attempt(() => controller.flattenSelected())}>Spiana i poli sul piano originale</button>
      <button type="button" data-test="surface-point-tangent-plane" disabled={disabled || !!state.surfaceTarget || !state.canTargetPoint}
        onClick={() => attempt(() => controller.beginTangentPlane())}>Spiana i poli sul piano tangente nel punto</button>
      <button type="button" data-test="surface-point-tangent-span" disabled={disabled || !!state.surfaceTarget || !state.canTargetPoint || state.freeBoundary}
        onClick={() => attempt(() => controller.beginTangentPlane('span'))}>Spiana una zona UV sul piano tangente</button>
      {state.surfaceTarget === 'tangent-span' && <>
        <p>Il clic sceglie un intervallo tra nodi U e V. I poli di supporto fuori piano devono essere selezionati e liberi. Il movimento può interessare le zone adiacenti.</p>
        {state.tangentSpanReview && <p role="status" data-test="surface-tangent-span-review">
          U da {state.tangentSpanReview.u[0].toPrecision(7)} a {state.tangentSpanReview.u[1].toPrecision(7)}, V da {state.tangentSpanReview.v[0].toPrecision(7)} a {state.tangentSpanReview.v[1].toPrecision(7)}.
          Verranno mossi {state.tangentSpanReview.movedCount} dei {state.tangentSpanReview.supportCount} poli di supporto. Gli altri sono già sul piano entro la tolleranza.
          {' '}Il limite superiore stimato per lo spostamento della superficie è {formatTangentSpanDisplacement(state.tangentSpanReview.maxSurfaceDisplacementMm)} mm, calcolato dai poli. Lo spostamento effettivo può essere inferiore e variare tra punti.
        </p>}
        <button type="button" data-test="surface-tangent-span-apply" disabled={disabled || !state.tangentSpanReview}
          onClick={() => attempt(() => controller.applyTangentSpan())}>Applica alla zona UV</button>
        <button type="button" data-test="surface-tangent-span-cancel" onClick={() => controller.cancelSurfaceTarget()}>Annulla scelta della zona</button>
      </>}
      {state.surfaceTarget === 'tangent-plane' && <>
        <p role="status">Clicca sulla faccia CAD selezionata per scegliere il piano. La proiezione riguarda i poli selezionati e liberi.</p>
        <button type="button" data-test="surface-tangent-plane-cancel" onClick={() => controller.cancelSurfaceTarget()}>Annulla scelta del piano</button>
      </>}
      <label>Levigatura · {Math.round(smooth * 100)}%<input type="range" min="0.05" max="1" step="0.05" value={smooth}
        disabled={disabled} onChange={e => setSmooth(Number(e.target.value))} /></label>
      <button type="button" data-test="surface-smooth" disabled={disabled || state.symmetryBlocked || !editable.length}
        onClick={() => attempt(() => controller.smoothSelected(smooth))}>Leviga i punti selezionati</button>
      <label>Fattore di stiramento<input data-test="surface-stretch-factor" type="text" inputMode="decimal" value={factorText}
        disabled={disabled} onChange={e => setFactorText(e.target.value)}
        onBlur={() => { if(factorText.trim()==='-')setFactorText('') }} /></label>
      <p>Lo stiramento usa il centro del reticolo. In modalità locale segue la direzione del primo punto selezionato.</p>
      <button type="button" data-test="surface-stretch" disabled={disabled || state.symmetryBlocked || !editable.length || factorValue===null || !(factorValue>0&&factorValue<=3)}
        onClick={() => { if(factorValue!==null&&factorValue>0&&factorValue<=3)attempt(() => controller.stretchSelected(factorValue)) }}>Stira lungo {axisNames[state.axis]}</button>
      <div className="row"><button type="button" data-test="surface-undo" disabled={disabled || !state.canUndo} onClick={() => attempt(() => controller.undo())}>Annulla modifica</button>
        <button type="button" data-test="surface-redo" disabled={disabled || !state.canRedo} onClick={() => attempt(() => controller.redo())}>Ripeti</button>
        <button type="button" disabled={disabled || tangencyActive} onClick={() => attempt(() => controller.restoreOriginal())}>Ripristina</button></div>
      <fieldset><legend>Note sulla superficie</legend>
        <button type="button" data-test="surface-note-add" disabled={disabled || state.calculating || (!state.placingNote && !state.canPlaceNote)} aria-pressed={state.placingNote}
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
