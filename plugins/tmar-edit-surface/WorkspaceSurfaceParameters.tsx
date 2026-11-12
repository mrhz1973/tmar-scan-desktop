// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect,useRef,useState, useSyncExternalStore } from 'react'
import type { WorkspaceSurfaceSession, WholeBoundarySide } from './workspaceSession'
import type { DragMode } from './localFrame'
import type { NetSelectionMode } from './netSelection'
import { hasSurfaceZebra } from './SurfaceViewport'
import { useLength } from '../../src/app/useUnits'
import { lengthInputText } from '../../src/core/units'
import { formatSurfaceDisplacementUpper } from './surfaceDisplay'
import { useSurfaceLengthInput } from './useSurfaceLengthInput'
import { wholeBoundaryIndices } from './wholeBoundary'
import { parseNumericInput } from './numericInput'
import { evaluatePoleLockState, poleLockDescription, suggestedPoleUnlock, type PoleLockReason } from './poleEditability'
import { SURFACE_TOOLS, surfaceToolInfo, type SurfaceTool } from './surfaceTools'
import './workspaceSurface.css'
import { pluginText as tmarText, useLanguage as useTmarLanguage, setLanguage } from '../../src/i18n'


/** The host owns Apply and Cancel; this panel edits only the session draft. */
export function WorkspaceSurfaceParameters({ controller }: { controller: WorkspaceSurfaceSession }) {
  const language = useTmarLanguage()
  const [selectedTool, setSelectedTool] = useState<SurfaceTool>('select')

  const len = useLength()
  const state = useSyncExternalStore(controller.subscribe, controller.getPanelState, controller.getPanelState)
  const [error, setError] = useState('')
  const [smooth, setSmooth] = useState(0.5)
  const [pointBudgetText, setPointBudgetText, pointBudget] = useSurfaceLengthInput(1)
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
  const [boundaryDistanceText,setBoundaryDistanceText,boundaryDistance] = useSurfaceLengthInput(0.1)
  const [distanceText,setDistanceText,distanceValue] = useSurfaceLengthInput(0.1)
  const [factorText,setFactorText] = useState('1.1')
  const factorValue=parseNumericInput(factorText)
  const [stripDistanceText, setStripDistanceText, stripDistance] = useSurfaceLengthInput(0.1)
  const [g1Pending, setG1Pending] = useState<'load' | 'apply' | null>(null)
  const [g1Error, setG1Error] = useState('')
  const disabled = state.busy || state.gesture !== 'idle'
  const hiddenPoles = controller.getViewState().hiddenPoles
  const editable = state.selected.filter(i => !state.locked.includes(i) && !hiddenPoles.includes(i))
  // Describe selected protected controls without loosening the CAD guard.
  const polePolicy = state.net ? evaluatePoleLockState(state.net, {
    continuity: state.continuity, freeBoundary: state.freeBoundary,
    trimLocks: state.faces[state.face]?.trimLocks ?? [],
    manualLocks: state.manualLocks, hiddenPoles,
  }) : null
  const selectedLocked = state.selected.filter(i => state.locked.includes(i))
    .map(i => ({ index: i, reason: (polePolicy?.reasons[i] === 'editable' ? 'manual' : polePolicy?.reasons[i] ?? 'manual') as PoleLockReason }))
  const g0MayHelp = !state.freeBoundary && !state.planeTangencyActive && !state.curvedTangencyActive &&
    selectedLocked.some(x => suggestedPoleUnlock(x.reason, true, state.canFreeBoundary)==='g0')
  const activeWholeBoundary=state.wholeBoundaryDrag ?? wholeBoundary
  const boundaryPoles = state.canFreeBoundary && state.net ? wholeBoundaryIndices(state.net,activeWholeBoundary) : []
  const boundaryManuallyLocked = boundaryPoles.length > 0 && boundaryPoles.every(id => state.manualLocks.includes(id))
  const hasFreeVisiblePoint = !!state.net?.poles.some((_, index) => !state.locked.includes(index) && !hiddenPoles.includes(index))
  const axisNames = state.dragMode === 'local' ? ['U', 'V', 'N'] : ['X', 'Y', 'Z']
  const strip = state.strip
  // Keep active drafts and gestures visible in their owning tool group.
  const lockedTool: SurfaceTool | null = strip ? 'edges' :
    state.surfaceTarget === 'scan' || state.surfaceTarget === 'cad' ? 'move' :
    state.surfaceTarget ? 'modify' : state.placingNote ? 'analysis' : null
  const activeTool: SurfaceTool = lockedTool ?? selectedTool
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
    if (modified && !window.confirm(tmarText('Scartare le modifiche al bordo? La bozza dei poli rimarrà disponibile.'))) return
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
  return <div ref={panelRef} className="workspace-surface-panel" data-test="workspace-surface-parameters" data-active-tool={activeTool}>
    <div className="ws-tool-header">
      <strong>{language === 'it' ? 'Strumenti superficie' : 'Surface tools'}</strong>
      <label>{language === 'it' ? 'Lingua' : 'Language'}
        <select data-test="workspace-surface-language" aria-label={language === 'it' ? 'Lingua interfaccia' : 'Interface language'} value={language} onChange={event => setLanguage(event.target.value as 'it' | 'en')}>
          <option value="it">Italiano</option><option value="en">English</option>
        </select>
      </label>
    </div>
    <nav className="ws-tool-grid" data-test="workspace-surface-tool-grid" aria-label={language === 'it' ? 'Strumenti Edit Surface' : 'Edit Surface tools'}>
      {SURFACE_TOOLS.map(tool => {
        const info = surfaceToolInfo(tool, language)
        return <button key={tool} type="button" data-test={'workspace-surface-tool-'+tool}
          className={'ws-tool-tab ws-tool-'+info.className} aria-pressed={activeTool===tool}
          disabled={(lockedTool !== null || state.gesture !== 'idle') && tool!==activeTool}
          title={info.summary} onClick={() => setSelectedTool(tool)}>
          <span className="ws-tool-icon" aria-hidden="true">{info.icon}</span><span className="ws-tool-name">{info.title}</span>
        </button>
      })}
    </nav>
    <details className="ws-tool-help"><summary>{language === 'it' ? 'Guida rapida' : 'Quick help'}</summary>
      <p>{tmarText("Seleziona una faccia nella vista oppure nell’elenco. La modifica resta una bozza CAD fino ad Applica.")}</p>
      <p>{tmarText("Esporta STEP crea un file locale della geometria CAD convalidata; il file STEP non contiene le note.")}</p>
    </details>
    <label>{tmarText("Faccia CAD")}<select data-test="surface-face" value={state.face < 0 ? '' : String(state.face)} disabled={disabled || state.calculating || !!strip}
        onChange={e => { if (e.target.value !== '') chooseFace(Number(e.target.value)) }}>
        <option value="">{tmarText("Scegli una faccia…")}</option>
        {state.faces.map(face => <option key={face.index} value={face.index} disabled={!!face.reason && !face.experimentalCylinder && !(face.kind==='plane' && face.reason==='Tutti i poli influenzano un contorno ritagliato.')}>
          {face.index + 1} · {tmarText(face.kind)}{face.experimentalCylinder ? tmarText(" · anteprima sperimentale") : face.kind==='plane' && face.reason==='Tutti i poli influenzano un contorno ritagliato.' ? tmarText(" · tenta raffinamento protetto") : face.reason ? tmarText(" · {0}", [tmarText(face.reason)]) : ''}
        </option>)}
      </select>
    </label>
    {state.net && <>
      <section className="ws-tool-group" data-tool-group="analysis">
      {cylinder && <div><p>{tmarText("Cilindro sperimentale: i controlli CAD sono campionati; verifica il risultato prima dell’uso e prima di aggiungere note.")}</p>
        <button type="button" data-test="surface-validate-cylinder" disabled={disabled || state.calculating}
          onClick={() => attempt(() => controller.validateCylinder())}>{tmarText("Verifica CAD del cilindro")}</button></div>}
      </section>
      <section className="ws-tool-group" data-tool-group="history">
      <button type="button" data-test="surface-export-step" disabled={disabled || !state.canExportStep}
        title={state.notes.length || state.placingNote ? tmarText("Le note non vengono incluse nello STEP: rimuovile prima di esportare.") : tmarText("Scarica la geometria CAD convalidata come STEP.")}
        onClick={() => { void exportStep() }}>{tmarText("Esporta STEP")}</button>
      </section>
      <section className="ws-tool-group" data-tool-group="modify">
      {(state.duplicateCadFace || state.faces[state.face]?.canDuplicateCadFace) && <div>
        <label className="inline"><input data-test="surface-duplicate-cad-face" type="checkbox" checked={state.duplicateCadFace}
          disabled={disabled || (!state.duplicateCadFace && !state.canDuplicateCadFace)} onChange={e => attempt(() => controller.setDuplicateCadFace(e.target.checked))} />{tmarText("Duplica faccia CAD")}</label>
        {state.duplicateCadFace && <p role="status">{state.duplicateCadFaceStale ? tmarText("Preview cambiata. Togli la spunta e scegli di nuovo cosa applicare.") : tmarText("Con Applica, la faccia della preview diventa una superficie CAD separata. Il solido resta nel progetto. Per mantenerlo visibile, togli la spunta a «Nascondi l’originale dopo Applica».")}</p>}
      </div>}
      </section>
      <section className="ws-tool-group" data-tool-group="select">
      <label className="inline"><input data-test="surface-navigation-only" type="checkbox" checked={state.navigationOnly} disabled={disabled}
        onChange={e => attempt(() => controller.setNavigationOnly(e.target.checked))} />{tmarText("Naviga nella vista (sospendi modifica del reticolo)")}</label>
      </section>
      <section className="ws-tool-group" data-tool-group="edges">
      {strip ? <fieldset data-test="surface-strip-panel"><legend>{tmarText("Duplica bordo libero")}</legend>
        <p>{tmarText("Scegli un bordo e trascina D lungo l’asse scelto, oppure indica lo spostamento nell’unità indicata.")}</p>
        <label>{tmarText("Bordo libero")}<select data-test="surface-strip-edge" value={strip.selectedEdge < 0 ? '' : String(strip.selectedEdge)}
          disabled={disabled || strip.pending} onChange={e => {
            if (e.target.value !== '') attempt(() => controller.selectStripEdge(Number(e.target.value)))
          }}>
          <option value="">{tmarText("Scegli un bordo…")}</option>
          {strip.paths.map((_, index) => <option key={index} value={index}>{tmarText("Bordo ")}{index + 1}</option>)}
        </select></label>
        <label>{tmarText("Direzione")}<select data-test="surface-strip-axis" value={strip.axis} disabled={disabled || strip.pending}
          onChange={e => attempt(() => controller.setStripAxis(Number(e.target.value) as 0 | 1 | 2))}>
          <option value={0}>{tmarText("X")}</option><option value={1}>{tmarText("Y")}</option><option value={2}>{tmarText("Z")}</option>
        </select></label>
        <label>{tmarText("Spostamento · ")}{len.word()}<input data-test="surface-strip-distance" type="text" inputMode="decimal"
          value={stripDistanceText} disabled={disabled || strip.pending}
          onChange={e => setStripDistanceText(e.target.value)} /></label>
        <button type="button" data-test="surface-strip-extend"
          disabled={disabled || strip.pending || strip.selectedEdge < 0 || stripDistance===null || Math.abs(stripDistance) <= 1e-7}
          onClick={extendStrip}>{tmarText("Duplica e sposta il bordo")}</button>
        <p role="status" data-test="surface-strip-status">{strip.pending ? state.gesture === 'strip' ? tmarText("Sposta il bordo; rilascia per verificare la superficie.") : tmarText("Calcolo della superficie in corso…") : strip.hasResult ? tmarText("Superficie estesa pronta: puoi continuare oppure usare Applica per creare la copia CAD.") : tmarText("Scegli un bordo libero per iniziare.")}</p>
        {strip.hasResult && strip.addedArea !== null && strip.totalArea !== null && <p data-test="surface-strip-area">{tmarText("Area aggiunta: ")}{len.area(strip.addedArea, 3)}{tmarText(" · Area totale: ")}{len.area(strip.totalArea, 3)}
        </p>}
        <div className="row"><button type="button" data-test="surface-strip-undo" disabled={disabled || strip.pending || !strip.canUndo}
          onClick={() => attempt(() => controller.undo())}>{tmarText("Annulla bordo")}</button>
          <button type="button" data-test="surface-strip-redo" disabled={disabled || strip.pending || !strip.canRedo}
            onClick={() => attempt(() => controller.redo())}>{tmarText("Ripeti bordo")}</button></div>
        <button type="button" data-test="surface-strip-cancel" disabled={disabled || strip.pending} onClick={closeStrip}>{tmarText("Torna ai poli")}</button>
      </fieldset> : <button type="button" data-test="surface-strip-begin" disabled={disabled || !state.canBeginStrip}
        title={!state.canBeginStrip ? tmarText("Serve una superficie aperta con anteprima valida e senza note o vincoli G1 attivi.") : tmarText("Duplica un bordo libero della superficie aperta.")}
        onClick={() => attempt(() => controller.beginStrip())}>{tmarText("Duplica bordo libero")}</button>}
      </section>
      {!strip && <>
      <section className="ws-tool-group" data-tool-group="move">
      <fieldset data-test="surface-point-target"><legend>{tmarText("Porta un punto della superficie sul riferimento")}</legend>
        <p>{tmarText("Seleziona i poli liberi, scegli il riferimento e clicca un punto della faccia. Cerco il riferimento esterno più vicino lungo la normale CAD, nei due versi, entro ")}{len.fmt(state.snapDistance)}{tmarText(". Il punto della superficie si muove; i poli possono muoversi di più.")}</p>
        <label>{tmarText("Limite spostamento di ciascun polo · ")}{len.word()}<input data-test="surface-point-budget" type="text" inputMode="decimal" value={pointBudgetText}
          disabled={disabled || !!state.surfaceTarget} onChange={e=>setPointBudgetText(e.target.value)} /></label>
        <p>{tmarText("Il limite deve essere positivo e non superiore a ")}{len.fmt(1000)}.</p>
        <label><input data-test="surface-point-multiple" type="checkbox" checked={multipleTargets} disabled={disabled||!!state.surfaceTarget}
          onChange={e=>setMultipleTargets(e.target.checked)}/>{tmarText("Raccogli più punti prima di applicare")}</label>
        <div className="row"><button type="button" data-test="surface-point-scan" disabled={disabled || !!state.surfaceTarget || !state.canTargetPoint || pointBudget===null || pointBudget<=0 || pointBudget>1000}
          onClick={()=>{if(pointBudget!==null&&pointBudget>0&&pointBudget<=1000)attempt(()=>controller.beginSurfaceTarget('scan',pointBudget,multipleTargets))}}>{multipleTargets ? tmarText("Raccogli sulla scansione") : tmarText("Punto sulla scansione")}</button>
        <button type="button" data-test="surface-point-cad" disabled={disabled || !!state.surfaceTarget || !state.canTargetPoint || pointBudget===null || pointBudget<=0 || pointBudget>1000}
          onClick={()=>{if(pointBudget!==null&&pointBudget>0&&pointBudget<=1000)attempt(()=>controller.beginSurfaceTarget('cad',pointBudget,multipleTargets))}}>{multipleTargets ? tmarText("Raccogli sul CAD esterno") : tmarText("Punto sul CAD esterno")}</button></div>
        {(state.surfaceTarget === 'scan' || state.surfaceTarget === 'cad') && <><p role="status" aria-live="polite" aria-atomic="true" data-test="surface-point-announcement">{state.surfaceTargetBatch ? tmarText("Punti raccolti: {0} di 8. {1} Destinazione: {2}.", [state.surfaceTargetBatch.length, state.surfaceTargetBatch.length>=2 ? tmarText("Puoi applicare gli agganci con una sola Undo.") : tmarText("Servono almeno due punti per applicare."), state.surfaceTarget==='scan' ? tmarText("scansione") : tmarText("CAD esterno")]) : tmarText("Clicca un punto sulla faccia selezionata. Destinazione: {0}.", [state.surfaceTarget==='scan' ? tmarText("scansione") : tmarText("CAD esterno")])}</p>
          {state.surfaceTargetBatch && <>
            <p>{tmarText("Da 2 a 8 agganci simultanei. Nessuna geometria cambia durante la raccolta. Blu: punto CAD; arancio: destinazione. Le coordinate sono nel corpo, in ")}{len.word()}.</p>
            <ol data-test="surface-point-pairs">{state.surfaceTargetBatch.map((pair,index)=><li key={index}>
              {pair.label}: ({pair.at.map(x=>len.fmt(x,3,{bare:true})).join(', ')}) → ({pair.target.map(x=>len.fmt(x,3,{bare:true})).join(', ')}) · {len.fmt(Math.hypot(...pair.at.map((x,d)=>x-pair.target[d])),4)}
              <button type="button" data-test="surface-point-remove" disabled={disabled} onClick={()=>attempt(()=>{removedPair.current=index;controller.removeSurfaceTarget(index)})}>{tmarText("Rimuovi punto ")}{index + 1}</button>
            </li>)}</ol>
            <button type="button" data-test="surface-point-apply" disabled={disabled||state.surfaceTargetBatch.length<2}
              onClick={()=>attempt(()=>controller.applySurfaceTargets())}>{tmarText("Applica ")}{state.surfaceTargetBatch.length}{tmarText(" agganci · una Undo")}</button>
          </>}
          <button type="button" data-test="surface-point-cancel" onClick={()=>controller.cancelSurfaceTarget()}>{tmarText("Annulla scelta punto")}</button></>}
        <p>{tmarText("Il riferimento usa i triangoli visualizzati. L’esito richiede la verifica CAD; le protezioni dei bordi restano attive. Disattiva simmetria e tangenze aggiunte per usare questo comando.")}</p>
      </fieldset>
      </section>
      <section className="ws-tool-group" data-tool-group="edges">
      {state.canBeginStrip && <label>{tmarText("Direzione CAD per il bordo D")}<select data-test="surface-direct-strip-axis" value={state.directStripAxis} disabled={disabled}
          onChange={e => attempt(() => controller.setDirectStripAxis(Number(e.target.value) as 0 | 1 | 2))}>
          <option value={0}>{tmarText("X")}</option><option value={1}>{tmarText("Y")}</option><option value={2}>{tmarText("Z")}</option>
        </select>
        <span>{tmarText("Clicca un bordo libero per mostrare D. Questa direzione è indipendente da U/V/N dei poli.")}</span>
      </label>}
      {state.directStripError && <div role="alert" data-test="surface-direct-strip-error">
        <p>{tmarText(state.directStripError)}{tmarText(" Puoi riprovare.")}</p>
        <button type="button" data-test="surface-direct-strip-retry" disabled={disabled}
          onClick={() => attempt(() => controller.retryDirectStripEdges())}>{tmarText("Riprova")}</button>
      </div>}
      <label>{tmarText("Protezione dei bordi")}<select data-test="surface-continuity" value={state.continuity} disabled={disabled || state.freeBoundary || tangencyActive}
          onChange={e => attempt(() => controller.setContinuity(e.target.value as 'G0' | 'G1'))}>
          <option value="G0">{tmarText("G0 · mantieni la posizione dei bordi")}</option>
          <option value="G1">{tmarText("G1 · mantieni anche le tangenti esistenti")}</option>
        </select>
      </label>
      <p>{tmarText("La protezione conserva le condizioni esistenti; non corregge automaticamente discontinuità già presenti.")}</p>
      <fieldset data-test="surface-g1-panel"><legend>{tmarText("Tangente a una faccia adiacente")}</legend>
        <p>{tmarText("Scegli un bordo condiviso e un supporto piano o B-spline compatibile a cui rendere tangente la superficie. La modifica resta nella bozza fino ad Applica.")}</p>
        <button type="button" data-test="surface-g1-load" disabled={g1Disabled || !state.canLoadG1}
          onClick={() => { void runG1('load') }}>{tmarText("Carica supporti G1")}</button>
        <label>{tmarText("Bordo e faccia di supporto")}<select data-test="surface-g1-support" value={state.g1Choice ?? ''}
            disabled={g1Disabled || !state.canLoadG1 || !g1Candidates.length} onChange={e => {
              if (!e.target.value) return
              setG1Error('')
              try { controller.chooseG1Support(e.target.value) }
              catch (reason) { setG1Error(reason instanceof Error ? reason.message : String(reason)) }
            }}>
            <option value="">{tmarText("Scegli bordo e faccia…")}</option>
            {g1Candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{tmarText("Bordo ")}{candidate.edgeIndex + 1}{tmarText(" · faccia ")}{candidate.kind === 'compatible-bspline' ? tmarText("B-spline compatibile") : tmarText("piana")} {candidate.supportFaceIndex + 1} · {len.fmt(candidate.lengthMm,3)}
            </option>)}
          </select>
        </label>
        <button type="button" data-test="surface-g1-apply" disabled={g1Disabled || !state.canApplyG1}
          onClick={() => { void runG1('apply') }}>{tmarText("Applica tangente alla bozza")}</button>
        <p role="status" data-test="surface-g1-status">{g1Pending === 'load' ? tmarText("Ricerca dei supporti CAD in corso…") : g1Pending === 'apply' ? tmarText("Calcolo e verifica della tangente in corso…") : state.planeTangencyActive ? tmarText("Vincolo di tangente al supporto piano attivo nella bozza.") : state.curvedTangencyActive ? tmarText("Vincolo di tangente al supporto B-spline compatibile attivo nella bozza.") : state.g1Choice ? tmarText("Supporto {0} scelto: applica la tangente alla bozza.", [curvedSupportChosen ? tmarText("B-spline compatibile") : tmarText("piano")]) : g1Candidates.length ? tmarText("Scegli il bordo e la faccia piana o B-spline compatibile di supporto.") : state.message === 'Nessun bordo naturale con un supporto adiacente compatibile disponibile.' ? tmarText(state.message) : tmarText("Carica i supporti per cercare bordi condivisi con facce piane o B-spline compatibili.")}</p>
        {g1Error && <p role="alert" data-test="surface-g1-error">{tmarText(g1Error)}</p>}
        {state.g1SearchNotice && <p role="status" data-test="surface-g1-search-notice">{tmarText(state.g1SearchNotice)}</p>}
        <p data-test="surface-g1-limits">{tmarText("Sono ammessi solo bordi condivisi rettilinei su facce naturali a quattro lati senza fori. Per i supporti B-spline servono superfici native non razionali con basi compatibili sul bordo; non viene eseguito un adattamento automatico. Il vincolo riguarda il bordo scelto; non certifica la continuità G1 dell’intero modello. La Zebra aiuta il controllo visivo.")}</p>
        {(curvedSupportChosen || state.curvedTangencyActive) && <p data-test="surface-g1-curved-limits">{tmarText("Quando disponibile, la vista evidenzia il supporto B-spline in arancione e il bordo comune in giallo. Applica crea la copia CAD. Il salvataggio del vincolo come ricetta modificabile non è ancora disponibile.")}</p>}
      </fieldset>
      {state.canFreeBoundary && <label className="inline"><input data-test="surface-free-boundary" type="checkbox"
        checked={state.freeBoundary} disabled={disabled} onChange={e => attempt(() => controller.setFreeBoundary(e.target.checked))} />{tmarText("Consenti movimento dei bordi liberi")}</label>}
      {state.canFreeBoundary && <fieldset data-test="surface-whole-boundary"><legend>{tmarText("Sposta o blocca un bordo naturale")}</legend>
        <p>{tmarText("Disponibile su una sola faccia aperta con quattro bordi naturali. Attiva prima il movimento dei bordi liberi. Il comando muove l’intero bordo; i suoi estremi modificano anche i bordi adiacenti.")}</p>
        <label>{tmarText("Bordo naturale")}<select data-test="surface-whole-boundary-side" value={activeWholeBoundary} disabled={disabled}
          onChange={e=>{const side=e.target.value as WholeBoundarySide;setWholeBoundary(side);if(state.wholeBoundaryDrag)attempt(()=>controller.setWholeBoundaryDrag(side))}}>
          <option value="U0">{tmarText("U iniziale")}</option><option value="U1">{tmarText("U finale")}</option><option value="V0">{tmarText("V iniziale")}</option><option value="V1">{tmarText("V finale")}</option>
        </select></label>
        <button type="button" data-test="surface-whole-boundary-lock"
          disabled={disabled || !state.canMoveWholeBoundary || boundaryManuallyLocked}
          onClick={() => attempt(() => {
            controller.lockWholeBoundary(activeWholeBoundary)
            setWholeBoundary(activeWholeBoundary)
          })}>
          {boundaryManuallyLocked ? tmarText("Poli del bordo bloccati") : tmarText("Blocca i poli del bordo")}
        </button>
        <p>{tmarText("Il blocco include gli angoli condivisi. Puoi annullarlo con Undo o gestire i singoli poli con i comandi di blocco.")}</p>
        <label>{tmarText("Direzione XYZ del corpo")}<select data-test="surface-whole-boundary-axis" value={boundaryAxis} disabled={disabled}
          onChange={e=>setBoundaryAxis(Number(e.target.value) as 0|1|2)}>
          <option value={0}>{tmarText("X")}</option><option value={1}>{tmarText("Y")}</option><option value={2}>{tmarText("Z")}</option>
        </select></label>
        <label>{tmarText("Spostamento · ")}{len.word()}<input data-test="surface-whole-boundary-distance" type="text" inputMode="decimal" value={boundaryDistanceText}
          disabled={disabled} onChange={e=>setBoundaryDistanceText(e.target.value)} /></label>
        <button type="button" data-test="surface-whole-boundary-move" disabled={disabled || !state.canMoveWholeBoundary ||
          boundaryPoles.some(id => state.locked.includes(id) || hiddenPoles.includes(id)) ||
          boundaryDistance===null || Math.abs(boundaryDistance)<=1e-7 || Math.abs(boundaryDistance)>1000}
          onClick={()=>{if(boundaryDistance!==null&&Math.abs(boundaryDistance)>1e-7&&Math.abs(boundaryDistance)<=1000)attempt(()=>{const delta:[number,number,number]=[0,0,0];delta[boundaryAxis]=boundaryDistance;controller.moveWholeBoundary(activeWholeBoundary,delta)})}}>{tmarText("Sposta intero bordo")}</button>
        <label className="inline"><input data-test="surface-whole-boundary-drag" type="checkbox" checked={!!state.wholeBoundaryDrag}
          disabled={disabled || (!state.wholeBoundaryDrag && !state.canMoveWholeBoundary)}
          onChange={e=>attempt(()=>{if(!e.target.checked)setWholeBoundary(activeWholeBoundary);controller.setWholeBoundaryDrag(e.target.checked?activeWholeBoundary:null)})} />{tmarText("Trascina un bordo naturale nella vista")}</label>
        {state.wholeBoundaryDrag && <p>{tmarText("Puoi afferrare uno qualsiasi dei quattro bordi naturali. Il bordo indicato nel pannello segue quello scelto nella vista. Il gesto usa direzione e intensità del reticolo, senza magnete. Fuori dai bordi puoi navigare; Escape annulla il gesto. Il comando numerico usa invece l’asse XYZ qui sopra.")}</p>}
        <p>{tmarText("Un polo bloccato impedisce il movimento di tutto il bordo. Il risultato richiede la verifica CAD e si annulla con un solo Undo. Non viene aggiunta una striscia.")}</p>
      </fieldset>}
      {state.canFreeBoundary && <fieldset data-test="surface-whole-face">
        <legend>{tmarText("Sposta intera faccia aperta")}</legend>
        <label className="inline"><input data-test="surface-whole-face-drag" type="checkbox"
          checked={state.wholeFaceDrag} disabled={disabled || (!state.wholeFaceDrag && !state.canMoveWholeFace)}
          onChange={e => attempt(() => controller.setWholeFaceDrag(e.target.checked))} />{tmarText("Trascina la faccia nella vista")}</label>
        <p>{tmarText("Attiva i bordi liberi su una singola faccia naturale e sblocca tutti i poli. Afferra la superficie per traslarla senza magnete. In modalità Locale, gli assi U, V e N si calcolano nel punto CAD cliccato. Con un piano di sezione attivo, usa Schermo o Assi XYZ. Il trascinamento richiede la verifica CAD e si annulla in un solo passaggio.")}</p>
      </fieldset>}
      </section>
      <section className="ws-tool-group" data-tool-group="select">
      <label>{tmarText("Selezione del reticolo")}<select data-test="surface-selection-mode" value={state.selectionMode} disabled={disabled}
          onChange={e => attempt(() => controller.setSelectionMode(e.target.value as NetSelectionMode))}>
          <option value="auto">{tmarText("Punti, segmenti e celle")}</option><option value="points">{tmarText("Solo punti")}</option>
          <option value="edges">{tmarText("Solo segmenti")}</option><option value="cells">{tmarText("Solo celle")}</option>
          <option value="mixed">{tmarText("Punti e segmenti")}</option>
        </select>
      </label>
      {state.selectionMode === 'auto' && <p>{tmarText("Per spostare una cella, selezionala con un clic e poi trascinala. Un trascinamento su una cella non selezionata resta disponibile per la navigazione.")}</p>}
      </section>
      <section className="ws-tool-group" data-tool-group="modify">
      <fieldset data-test="surface-refine-net"><legend>{tmarText("Raffina reticolo")}</legend>
        <p>{tmarText("Aggiungi punti di controllo nella direzione scelta per modificare il reticolo più finemente.")}</p>
        <div className="row">{(['U', 'V', 'both'] as const).map(axis => {
          const direction = axis === 'both' ? 'in entrambe le direzioni U e V' : `nella direzione ${axis}`
          return <button type="button" key={axis} data-test={`surface-refine-${axis}`}
            disabled={disabled || !state.canRefineNet}
            title={tmarText("Aggiunge punti di controllo {0}.\nScegli U, V oppure entrambe per il reticolo attuale.\nRichiede una faccia modificabile e nessuna operazione in corso.\nIl risultato resta nella bozza fino ad Applica.", [direction])}
            onClick={() => attempt(() => controller.refineNet(axis))}>
            {axis === 'both' ? tmarText("Raffina U e V") : tmarText("Raffina {0}", [axis])}
          </button>
        })}</div>
      </fieldset>
      </section>
      <section className="ws-tool-group" data-tool-group="move">
      <label>{tmarText("Trascinamento")}<select data-test="surface-drag-mode" value={state.dragMode} disabled={disabled}
          onChange={e => attempt(() => controller.setDragMode(e.target.value as DragMode))}>
          <option value="axis">{tmarText("Asse globale")}</option><option value="screen">{tmarText("Piano dello schermo")}</option>
          <option value="local">{tmarText("Locale · U / V / normale")}</option>
        </select>
      </label>
      <div className="row" aria-label={tmarText("Asse di movimento")}>{axisNames.map((name, index) =>
        <button type="button" key={name} data-test={`surface-axis-${index}`} disabled={disabled}
          aria-pressed={state.axis === index} onClick={() => attempt(() => controller.setAxis(index as 0 | 1 | 2))}>{name}</button>)}</div>
      {state.dragMode !== 'screen' && <p>{tmarText("Se la direzione punta verso la vista, trascina in verticale per muovere il punto in profondità.")}</p>}
      <label>{tmarText("Intensità trascinamento · ")}{Math.round(state.dragStrength * 100)}%
        <input data-test="surface-drag-strength" type="range" min="0.05" max="1" step="0.05" value={state.dragStrength}
          disabled={disabled} onChange={e => attempt(() => controller.setDragStrength(Number(e.target.value)))} />
      </label>
      <fieldset><legend>{tmarText("Magnete")}</legend>
        <label className="inline"><input data-test="surface-snap" type="checkbox" checked={state.snap} disabled={disabled}
          onChange={e => attempt(() => controller.setSnap(e.target.checked))} />{tmarText(" Aggancia a scansione e CAD vicini")}</label>
        {state.snap && <><label>{tmarText("Portata · ")}{len.word()}<input key={`${state.snapDistance}:${len.units}`} data-test="surface-snap-distance" type="number" min={len.toDisplay(.001)} max={len.toDisplay(1000)} step="any"
          defaultValue={lengthInputText(state.snapDistance,len.units)} disabled={disabled} onBlur={e => {
            const shown = lengthInputText(state.snapDistance,len.units)
            if (e.currentTarget.value === shown) return
            const value = len.fromDisplay(e.currentTarget.valueAsNumber)
            if (Number.isFinite(value) && value >= .001 && value <= 1000) attempt(() => controller.setSnapDistance(value))
            else { e.currentTarget.value = shown; setError(`Portata magnete: inserisci un valore tra ${len.fmt(.001,len.units==='in'?6:3)} e ${len.fmt(1000)}.`) }
          }} onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.currentTarget.value = lengthInputText(state.snapDistance,len.units); e.currentTarget.blur() }
          }} /></label>
          <p>{tmarText("Alt sospende il magnete durante il trascinamento. L’aggancio usa la geometria visualizzata.")}</p></>}
      </fieldset>
      </section>
      <section className="ws-tool-group" data-tool-group="select">
      <label className="inline"><input data-test="surface-control-net" type="checkbox" checked={state.showNet} disabled={disabled}
        onChange={e => attempt(() => controller.setShowNet(e.target.checked))} />{tmarText(" Mostra reticolo")}</label>
      </section>
      <section className="ws-tool-group" data-tool-group="modify">
      <fieldset><legend>{tmarText("Simmetria dei poli")}</legend>
        <label className="inline"><input data-test="surface-symmetry" type="checkbox" checked={state.symmetry} disabled={disabled}
          onChange={e => attempt(() => controller.setSymmetry(e.target.checked))} />{tmarText(" Modifica anche il polo speculare")}</label>
        {state.symmetry && <>
          <label>{tmarText("Piano")}<select data-test="surface-mirror-plane" value={state.mirrorAxis} disabled={disabled}
            onChange={e => attempt(() => controller.setMirrorAxis(Number(e.target.value)))}>
            <option value={0}>{tmarText("YZ")}</option><option value={1}>{tmarText("XZ")}</option><option value={2}>{tmarText("XY")}</option>
          </select></label>
          <label>{tmarText("Posizione del piano · ")}{len.word()}<input key={`${state.mirrorAxis}:${state.mirrorOffset}:${len.units}`} data-test="surface-mirror-offset"
            type="number" step="any" defaultValue={lengthInputText(state.mirrorOffset,len.units)} disabled={disabled} onBlur={e => {
              const shown = lengthInputText(state.mirrorOffset,len.units)
              if (e.currentTarget.value === shown) return
              const value = len.fromDisplay(e.currentTarget.valueAsNumber)
              if (Number.isFinite(value)) attempt(() => controller.setMirrorOffset(value))
              else e.currentTarget.value = shown
            }} /></label>
          <p role="status">{state.symmetryBlocked ? tmarText("La selezione contiene un polo speculare mancante, ambiguo o bloccato.") : tmarText("I poli speculari sono mostrati in viola; quelli sul piano restano sul piano.")}</p>
          <button type="button" data-test="surface-project-poles" disabled={disabled || !editable.length}
            onClick={() => attempt(() => controller.projectSelectedToMirrorPlane())}>{tmarText("Porta i poli selezionati sul piano")}</button>
        </>}
      </fieldset>
      </section>
      </>}
      <section className="ws-tool-group" data-tool-group="analysis">
      {hasSurfaceZebra && <fieldset><legend>{tmarText("Analisi Zebra")}</legend>
        <label className="inline"><input data-test="surface-zebra" type="checkbox" checked={!!state.stripes} disabled={disabled}
          onChange={e => attempt(() => controller.setStripes(e.target.checked ? { orientation: 'horizontal', width: 3, color: '#5388b1' } : null))} />{tmarText(" Mostra strisce sulla preview")}</label>
        {state.stripes && <>
          <label>{tmarText("Orientamento")}<select data-test="surface-zebra-direction" value={state.stripes.orientation} disabled={disabled}
            onChange={e => attempt(() => controller.setStripes({ ...state.stripes!, orientation: e.target.value as 'horizontal' | 'vertical' }))}>
            <option value="horizontal">{tmarText("Orizzontale")}</option><option value="vertical">{tmarText("Verticale")}</option>
          </select></label>
          <label>{tmarText("Larghezza · ")}{state.stripes.width}<input type="range" min="1" max="7" step="1" value={state.stripes.width} disabled={disabled}
            onChange={e => attempt(() => controller.setStripes({ ...state.stripes!, width: Number(e.target.value) }))} /></label>
          <label>{tmarText("Colore")}<input type="color" value={state.stripes.color} disabled={disabled}
            onChange={e => attempt(() => controller.setStripes({ ...state.stripes!, color: e.target.value }))} /></label>
        </>}
      </fieldset>}
      <label>{tmarText("Trasparenza superficie · ")}{Math.round(state.transparency * 100)}%<input data-test="surface-transparency"
        type="range" min="0" max="0.9" step="0.05" value={state.transparency} disabled={disabled}
        onChange={e => attempt(() => controller.setTransparency(Number(e.target.value)))} /></label>
      </section>
      {!strip && <>
      <section className="ws-tool-group" data-tool-group="select">
      <p data-test="surface-selection">{state.selected.length}{tmarText(" selezionati · ")}{editable.length}{tmarText(" modificabili")}</p>
      {selectedLocked.length > 0 && <div className="ws-lock-reasons" data-test="surface-locked-selection-reason" role="status">
        <p>{language === 'it' ? 'Punti selezionati ma protetti:' : 'Selected but protected control points:'}</p>
        {selectedLocked.slice(0,6).map(({index,reason}) => <p key={index}>
          {language === 'it' ? 'Polo ' : 'Pole '}{index+1}: {poleLockDescription(reason, language)}
        </p>)}
        {selectedLocked.length>6 && <p>{language === 'it' ? 'Altri poli protetti: ' : 'Other protected poles: '}{selectedLocked.length-6}</p>}
        {g0MayHelp && <p>{language === 'it' ? 'In Bordi/Vincoli puoi valutare G0: libera la prima fila interna, ma non il contorno condiviso.' :
          'Under Edges/Constraints, G0 may free the first interior ring; shared boundaries remain locked.'}</p>}
      </div>}
      <div className="row"><button type="button" data-test="surface-next-free" disabled={disabled || !hasFreeVisiblePoint}
        title={tmarText("Seleziona il prossimo punto visibile e non bloccato, utile nei reticoli fitti.")}
        onClick={() => attempt(() => {
          const view=controller.getViewState(), net=view.net
          if (!net) throw new Error('Seleziona prima una faccia.')
          const available=net.poles.map((_,index)=>index).filter(index=>!view.locked.includes(index) && !view.hiddenPoles.includes(index))
          if (!available.length) throw new Error('Nessun punto modificabile disponibile.')
          const current=available.indexOf(view.selected.length===1 ? view.selected[0] : -1)
          controller.selectPoints([available[(current+1)%available.length]],false)
        })}>{tmarText("Prossimo punto modificabile")}</button>
        <button type="button" disabled={disabled} onClick={() => attempt(() => controller.selectAllFree())}>{tmarText("Seleziona liberi")}</button>
        <button type="button" disabled={disabled} onClick={() => attempt(() => controller.clearSelection())}>{tmarText("Nessuno")}</button></div>
      <div className="row"><button type="button" disabled={disabled || !state.selected.length} onClick={() => attempt(() => controller.lockSelected(true))}>{tmarText("Blocca punti")}</button>
        <button type="button" disabled={disabled || !state.selected.length} onClick={() => attempt(() => controller.lockSelected(false))}>{tmarText("Sblocca punti")}</button></div>
      </section>
      <section className="ws-tool-group" data-tool-group="move">
      <label>{tmarText("Spostamento · ")}{len.word()}<input data-test="surface-distance" type="text" inputMode="decimal" value={distanceText}
        onChange={e => setDistanceText(e.target.value)}
        onBlur={() => { if(distanceText.trim()==='-')setDistanceText('') }} disabled={disabled} /></label>
      <button type="button" data-test="surface-move" disabled={disabled || state.symmetryBlocked || !editable.length || distanceValue===null}
        onClick={() => { if(distanceValue!==null)attempt(() => controller.moveSelected(distanceValue)) }}>{tmarText("Sposta lungo ")}{axisNames[state.axis]}</button>
      </section>
      <section className="ws-tool-group" data-tool-group="modify">
      <button type="button" disabled={disabled || state.symmetryBlocked || !editable.length} onClick={() => attempt(() => controller.flattenSelected())}>{tmarText("Spiana i poli sul piano originale")}</button>
      <button type="button" data-test="surface-point-tangent-plane" disabled={disabled || !!state.surfaceTarget || !state.canTargetPoint}
        onClick={() => attempt(() => controller.beginTangentPlane())}>{tmarText("Spiana i poli sul piano tangente nel punto")}</button>
      <button type="button" data-test="surface-point-tangent-span" disabled={disabled || !!state.surfaceTarget || !state.canTargetPoint || state.freeBoundary}
        onClick={() => attempt(() => controller.beginTangentPlane('span'))}>{tmarText("Spiana una zona UV sul piano tangente")}</button>
      {state.surfaceTarget === 'tangent-span' && <>
        <p>{tmarText("Il clic sceglie un intervallo tra nodi U e V. I poli di supporto fuori piano devono essere selezionati e liberi. Il movimento può interessare le zone adiacenti.")}</p>
        {state.tangentSpanReview && <p role="status" data-test="surface-tangent-span-review">{tmarText("U da ")}{state.tangentSpanReview.u[0].toPrecision(7)}{tmarText(" a ")}{state.tangentSpanReview.u[1].toPrecision(7)}{tmarText(", V da ")}{state.tangentSpanReview.v[0].toPrecision(7)}{tmarText(" a ")}{state.tangentSpanReview.v[1].toPrecision(7)}{tmarText(". Verranno mossi ")}{state.tangentSpanReview.movedCount}{tmarText(" dei ")}{state.tangentSpanReview.supportCount}{tmarText(" poli di supporto. Gli altri sono già sul piano entro la tolleranza.")}{' '}{tmarText("Il limite superiore stimato per lo spostamento della superficie è ")}{formatSurfaceDisplacementUpper(state.tangentSpanReview.maxSurfaceDisplacementMm,len.units)}{tmarText(", calcolato dai poli. Lo spostamento effettivo può essere inferiore e variare tra punti.")}</p>}
        <button type="button" data-test="surface-tangent-span-apply" disabled={disabled || !state.tangentSpanReview}
          onClick={() => attempt(() => controller.applyTangentSpan())}>{tmarText("Applica alla zona UV")}</button>
        <button type="button" data-test="surface-tangent-span-cancel" onClick={() => controller.cancelSurfaceTarget()}>{tmarText("Annulla scelta della zona")}</button>
      </>}
      {state.surfaceTarget === 'tangent-plane' && <>
        <p role="status">{tmarText("Clicca sulla faccia CAD selezionata per scegliere il piano. La proiezione riguarda i poli selezionati e liberi.")}</p>
        <button type="button" data-test="surface-tangent-plane-cancel" onClick={() => controller.cancelSurfaceTarget()}>{tmarText("Annulla scelta del piano")}</button>
      </>}
      <label>{tmarText("Levigatura · ")}{Math.round(smooth * 100)}%<input type="range" min="0.05" max="1" step="0.05" value={smooth}
        disabled={disabled} onChange={e => setSmooth(Number(e.target.value))} /></label>
      <button type="button" data-test="surface-smooth" disabled={disabled || state.symmetryBlocked || !editable.length}
        onClick={() => attempt(() => controller.smoothSelected(smooth))}>{tmarText("Leviga i punti selezionati")}</button>
      <label>{tmarText("Fattore di stiramento")}<input data-test="surface-stretch-factor" type="text" inputMode="decimal" value={factorText}
        disabled={disabled} onChange={e => setFactorText(e.target.value)}
        onBlur={() => { if(factorText.trim()==='-')setFactorText('') }} /></label>
      <p>{tmarText("Lo stiramento usa il centro del reticolo. In modalità locale segue la direzione del primo punto selezionato.")}</p>
      <button type="button" data-test="surface-stretch" disabled={disabled || state.symmetryBlocked || !editable.length || factorValue===null || !(factorValue>0&&factorValue<=3)}
        onClick={() => { if(factorValue!==null&&factorValue>0&&factorValue<=3)attempt(() => controller.stretchSelected(factorValue)) }}>{tmarText("Stira lungo ")}{axisNames[state.axis]}</button>
      </section>
      <section className="ws-tool-group" data-tool-group="history">
      <div className="row"><button type="button" data-test="surface-undo" disabled={disabled || !state.canUndo} onClick={() => attempt(() => controller.undo())}>{tmarText("Annulla modifica")}</button>
        <button type="button" data-test="surface-redo" disabled={disabled || !state.canRedo} onClick={() => attempt(() => controller.redo())}>{tmarText("Ripeti")}</button>
        <button type="button" disabled={disabled || tangencyActive} onClick={() => attempt(() => controller.restoreOriginal())}>{tmarText("Ripristina")}</button></div>
      </section>
      <section className="ws-tool-group" data-tool-group="analysis">
      <fieldset><legend>{tmarText("Note sulla superficie")}</legend>
        <button type="button" data-test="surface-note-add" disabled={disabled || state.calculating || (!state.placingNote && !state.canPlaceNote)} aria-pressed={state.placingNote}
          onClick={() => attempt(() => controller.setPlacingNote(!state.placingNote))}>{state.placingNote ? tmarText("Annulla scelta punto") : tmarText("Aggiungi nota")}</button>
        {state.placingNote && <p>{tmarText("Clicca sulla faccia modificata per posizionare la nota.")}</p>}
        {state.notes.map((note, index) => <div key={note.id}><label>{tmarText("Nota ")}{index + 1}<input data-test="surface-note-text" value={note.text} maxLength={2000} disabled={disabled}
          onChange={e => attempt(() => controller.setNoteText(note.id, e.target.value))} /></label>
          <button type="button" disabled={disabled} onClick={() => attempt(() => controller.removeNote(note.id))}>{tmarText("Rimuovi nota")}</button></div>)}
        {state.noteResolutionError && <div role="alert"><p>{tmarText("Non è stato possibile aggiornare la posizione delle note. Sono ancora nella bozza.")}</p>
          <button type="button" data-test="surface-note-retry" disabled={disabled} onClick={() => attempt(() => controller.retryNoteResolution())}>{tmarText("Riprova")}</button></div>}
        {!!state.notes.length && <p>{state.annotatedCopyAvailable ? tmarText("Con Applica le note complete vengono salvate nel progetto insieme alla copia CAD. Per esportare solo lo STEP, rimuovi prima le note dalla bozza.") : tmarText("Le note restano nella bozza e non vengono incluse nello STEP né salvate nel progetto. Rimuovile prima di esportare o applicare.")}</p>}
        {state.annotatedCopyAvailable && state.notes.some(note => !note.text.trim()) && <p>{tmarText("Scrivi il testo di tutte le note prima di applicare.")}</p>}
      </fieldset>
      </section>
      </>}
    </>}
    {error && <p role="alert">{tmarText(error)}</p>}
  </div>
}
