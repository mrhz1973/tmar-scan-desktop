// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { listCommands, runCommand } from '../../src/commands/registry'
import { useCommandActivity } from '../../src/commands/activity'
import { useStore } from '../../src/state/store'
import { saveFile } from '../../src/app/exports'
import { create } from 'zustand'
import { reEditorOpen, useReverse } from '../reverse/state/reStore'
import { stepFileKey } from '../reverse/core/features'
import { bodyStepResult } from '../tmar-body-export/bodyExport'
import { boundaryLocked, type Net, type Point } from './brep'
import type { StripMove } from './sheetExtension'
import type { DraftAnchor, FaceInfo, Preview } from './editorKernel'
import type { SurfaceWorkerPayload } from './workerClient'
import { SurfaceRuntime } from './surfaceRuntime'
import { changeSurfaceFace } from './faceSelection'
import { SurfaceViewport, hasSurfaceZebra, type StripeSettings } from './SurfaceViewport'
import { dragDirection, type DragMode } from './localFrame'
import { mirrorPartners, mirrorEdit } from './symmetry'
import { selectNetPoints, type NetSelectionMode } from './netSelection'
import { SurfaceDraft } from './surfaceDraft'
import { parseNumericInput } from './numericInput'
import { useLength } from '../../src/app/useUnits'
import { lengthInputText } from '../../src/core/units'
import { formatSurfaceResidual } from './surfaceDisplay'
import { useSurfaceLengthInput } from './useSurfaceLengthInput'
import './surface.css'
const NO_HIDDEN_POLES: number[] = []

interface StripState {step:string;addedArea:number;preview:Preview;paths:Point[][];moves:StripMove[]}
interface Pin { anchor: DraftAnchor; at: Point; normal: Point }
type SurfaceNote = Pin & {id:number; text:string; revision:number}
type LoadedSurface = { step: string; name: string; bodyId: number | null }

export function surfacePoleLockIds(net: Net, freeBoundary: boolean, continuity: 'G0' | 'G1',
  trimLocks: readonly number[], locks: readonly number[], hiddenPoles: readonly number[]): number[] {
  const trim = new Set(trimLocks), manual = new Set(locks), hidden = new Set(hiddenPoles)
  return net.poles.flatMap((_, i) => (!freeBoundary && boundaryLocked(net, i, continuity)) ||
    trim.has(i) || manual.has(i) || hidden.has(i) ? [i] : [])
}

function createSurfaceSession() {
  const re = useReverse.getState(), model = useStore.getState()
  const runtime = new SurfaceRuntime()
  try {
    return {
      runtime, draft: new SurfaceDraft(runtime),
      source: { version: re.buildVersion, features: re.features, rolledBack: re.rolledBack,
        stepFiles: re.stepFiles, parameters: re.parameters, file: model.fileName, alignment: model.appliedAlignment },
      loaded: null as LoadedSurface | null, sourcePreview: null as Preview | null,
      faces: [] as FaceInfo[], face: -1, loadId: 0, generation: 0,
      notes: [] as SurfaceNote[], nextNote: 1, editorSessionId: crypto.randomUUID(),
      zebra: false, stripes: { orientation:'horizontal', width:3, color:'#5388b1' } as StripeSettings,
    }
  } catch (error) { runtime.dispose(); throw error }
}
type SurfaceSession = ReturnType<typeof createSurfaceSession>
function disposeSurfaceSession(session: SurfaceSession) {
  session.draft.dispose()
  session.runtime.dispose()
}
export interface SurfaceNoteCommit {
  step: string; name: string; faceIndex: number
  final: {face:number; selectionRevision:number; previewRevision:number; faceBrep:string; editorSessionId:string}
  notes: { draftId:string; anchor:DraftAnchor; text: string; at: Point; normal: Point; u: number; v: number }[]
}
interface SurfaceOptions { applyWithNotes?: (edit: SurfaceNoteCommit) => Promise<void> }

// The host subscribes before its toolbar mounts. Notify it when the modal
// takes ownership of keyboard history and when project undo becomes available.
export const useSurfaceDialogs = create(() => ({ count: 0 }))

export function EditSurface({ applyWithNotes }: SurfaceOptions = {}) {
  const [session, setSession] = useState<SurfaceSession | null>(null)
  const sessionRef = useRef<SurfaceSession | null>(null)
  const [startupError, setStartupError] = useState('')
  const busy = useStore(s => s.busy), running = useCommandActivity(s => s.running !== null)
  const re = useReverse(useShallow(s => ({ bodies: s.bodies, building: s.building, editing: reEditorOpen(s), playback: s.playback !== null })))
  useEffect(() => () => { if (sessionRef.current) disposeSurfaceSession(sessionRef.current); sessionRef.current = null }, [])
  const open = () => {
    if (sessionRef.current) return
    try { const next = createSurfaceSession(); sessionRef.current = next; setStartupError(''); setSession(next) }
    catch (error) { setStartupError(error instanceof Error ? error.message : String(error)) }
  }
  const close = () => { const active = sessionRef.current; sessionRef.current = null; if (active) disposeSurfaceSession(active); setSession(null) }
  return <div className="group" data-test="edit-surface-entry"><button className="block" disabled={busy || running || re.building || re.editing || re.playback} onClick={open}>Edit Surface · punti CAD…</button>
    {startupError && <p role="alert">{startupError}</p>}
    {session && <SurfaceDialog session={session} applyWithNotes={applyWithNotes} close={close} />}</div>
}
function SurfaceDialog({ close, applyWithNotes, session }: SurfaceOptions & { close: () => void; session: SurfaceSession }) {
  const len = useLength()
  const { runtime, draft } = session
  const draftState = useSyncExternalStore(draft.subscribe, draft.getSnapshot, draft.getSnapshot)
  const { net, selected, locks, continuity, freeBoundary, validNet, calculating } = draftState
  const re = useReverse.getState()
  const source = useRef(session.source)
  const [bodyId, setBodyId] = useState(re.bodies[0]?.id ?? '')
  const [name, setName] = useState(session.loaded ? session.loaded.name.replace(/\.(step|stp)$/i, '') + '-edit.step' : 'superficie-modificata.step')
  const loaded = useRef<LoadedSurface | null>(session.loaded)
  const setLoaded = (value: LoadedSurface | null) => { session.loaded = value; loaded.current = value }
  const [referenceBody, setReferenceBody] = useState<number | null>(session.loaded?.bodyId ?? null)
  const [snap, setSnap] = useState(true), [snapDistance, setSnapDistance] = useState(1)
  const [referenceCount, setReferenceCount] = useState(0)
  const cancelGesture = useRef<() => boolean>(() => false)
  const [loadId, setLoadId] = useState(session.loadId)
  const [faces, setFacesState] = useState(session.faces), [face, setFaceState] = useState(session.face)
  const setFaces = (value: FaceInfo[]) => { session.faces = value; setFacesState(value) }
  const setFace = (value: number) => { session.face = value; setFaceState(value) }
  const [sourcePreview, setSourcePreviewState] = useState(session.sourcePreview)
  const setSourcePreview = (value: Preview | null) => { session.sourcePreview = value; setSourcePreviewState(value) }
  const preview = draftState.preview ?? sourcePreview
  const [axis, setAxis] = useState(2)
  const [distanceText, setDistanceText, distanceValue] = useSurfaceLengthInput(1)
  const [factorText, setFactorText] = useState('1.1')
  const factorValue = parseNumericInput(factorText)
  const [dragStrength, setDragStrength] = useState(1), [smoothStrength, setSmoothStrength] = useState(0.5)
  const [dragMode, setDragMode] = useState<DragMode>('local')
  const [selectionMode, setSelectionMode] = useState<NetSelectionMode>('auto')
  const [placingNote, setPlacingNote] = useState(false)
  const [notes, setNotesState] = useState<SurfaceNote[]>(session.notes)
  const setNotes = (value: SurfaceNote[] | ((previous: SurfaceNote[]) => SurfaceNote[])) => {
    setNotesState(previous => { const next = typeof value === 'function' ? value(previous) : value; session.notes = next; return next })
  }
  const editorSessionId = session.editorSessionId
  const [noteError,setNoteError] = useState('')
  const cancel = () => {
    if (!notes.length || window.confirm('Chiudere e scartare le note della bozza?')) close()
  }
  const [stripPaths,setStripPaths]=useState<Point[][]|null>(null)
  const stripPathsRef=useRef<Point[][]|null>(null); stripPathsRef.current=stripPaths
  const stripPending=useRef(false)
  const [directEdges,setDirectEdges]=useState<{revision:number;paths:Point[][]}|null>(null)
  const [stripEdge,setStripEdge]=useState(-1), [stripDelta,setStripDelta]=useState<Point>([0,0,0])
  const [stripResult,setStripResult]=useState<StripState|null>(null)
  const stripHistory=useRef<(StripState|null)[]>([])
  const stripAt=useRef(0)
  const stripUndo=(direction:number)=>{
    if(stripPending.current)return
    const next=stripAt.current+direction
    const item=stripHistory.current[next]
    if(item===undefined)return
    stripAt.current=next;setStripEdge(-1);setStripDelta([0,0,0]);setStripResult(item);setError('')
  }
  const [zebra, setZebraState] = useState(session.zebra)
  const setZebra = (value: boolean | ((previous: boolean) => boolean)) => {
    setZebraState(previous => { const next = typeof value === 'function' ? value(previous) : value; session.zebra = next; return next })
  }
  const [stripes, setStripesState] = useState<StripeSettings>(session.stripes)
  const setStripes = (value: StripeSettings) => { session.stripes = value; setStripesState(value) }
  const [symmetry, setSymmetry] = useState(false)
  const [mirrorAxis, setMirrorAxis] = useState(0), [mirrorOffset, setMirrorOffset] = useState(0)
  const [showNet, setShowNet] = useState(true), [transparency, setTransparency] = useState(0)
  const [busy, setBusy] = useState(false)
  const [actionError, setError] = useState('')
  const error = actionError || draftState.error
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    const onFailure = (failure: Error) => { if (mounted.current) setError(failure.message) }
    runtime.worker.onFailure = onFailure
    return () => { mounted.current = false; if (runtime.worker.onFailure === onFailure) runtime.worker.onFailure = null }
  }, [runtime])
  useEffect(() => { if (validNet && !calculating) setError('') }, [validNet, calculating])
  const ask = <T,>(payload: SurfaceWorkerPayload): Promise<T> => runtime.worker.ask<T>(payload)
  const ensureSession = () => { if (!mounted.current || !runtime.active) throw new Error('Editor chiuso.') }
  const commit = (n: Net) => {
    try { draft.commit(n); setError('') }
    catch (e) { setError((e as Error).message) }
  }
  const undo = (delta: number) => { if (delta === -1) draft.undo(); else if (delta === 1) draft.redo() }
  const modalKeys = useRef({ busy, undo, close, cancelGesture: () => cancelGesture.current() }); modalKeys.current = { busy, undo:stripPaths?stripUndo:undo, close:cancel, cancelGesture: () => cancelGesture.current() }
  useEffect(() => {
    useSurfaceDialogs.setState(s => ({ count: s.count + 1 }))
    const onKey = (e: KeyboardEvent) => {
      // The modal owns navigation/history even if focus remains on its opener.
      if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.dataset.test === 'surface-mirror-offset') {
        e.preventDefault(); e.target.blur()
      }
      e.stopImmediatePropagation()
      const s = modalKeys.current, key = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(key) && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault(); if (!s.busy && !e.repeat) s.undo(key === 'y' || e.shiftKey ? 1 : -1)
      }
      if (e.key === 'Escape' && !s.busy) { e.preventDefault(); if (!s.cancelGesture()) s.close() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true); useSurfaceDialogs.setState(s => ({ count: s.count - 1 })) }
  }, [])
  const load = async (step: string, fileName: string, expected?: { faces: number; surface: boolean; guard?: () => Promise<void> }, bodyRef: number | null = null) => {
    ensureSession()
    const generation = ++session.generation
    const ensureCurrent = () => { ensureSession(); if (generation !== session.generation) throw new Error('Operazione superata.') }
    draft.reset({ preserveContinuity: true })
    setLoaded(null); setReferenceBody(null); setFace(-1); setFaces([]); setSourcePreview(null)
    setNotes([]); setPlacingNote(false); setNoteError(''); setSymmetry(false); setBusy(true); setError('')
    try {
      const result = await ask<{ faces: FaceInfo[]; preview: Preview }>({ action: 'open', step })
      ensureCurrent()
      if (expected) {
        checkProject()
        await expected.guard?.()
        ensureCurrent()
        checkProject()
        if (result.faces.length !== expected.faces || !result.faces.every(f => f.openSheet === expected.surface))
          throw new Error('Il CAD ricevuto non corrisponde al corpo selezionato nel progetto.')
      }
      setLoaded({ step, name: fileName, bodyId: bodyRef }); setReferenceBody(bodyRef)
      session.loadId++; setLoadId(session.loadId)
      setFaces(result.faces); setSourcePreview(result.preview)
      setName(fileName.replace(/\.(step|stp)$/i, '') + '-edit.step')
    } catch (e) {
      if (!mounted.current || !runtime.active || generation !== session.generation) return
      // The worker's document may already have changed: never revive the old face.
      draft.reset(); setLoaded(null); setReferenceBody(null); setFaces([]); setSourcePreview(null); setFace(-1)
      setError((e as Error).message)
    } finally { if (mounted.current && runtime.active && generation === session.generation) setBusy(false) }
  }
  const loadBody = async () => {
    setBusy(true); setError('')
    try {
      checkProject()
      const state = useReverse.getState(), body = state.bodies.find(b=>b.id===bodyId)
      if (!body) throw new Error('Scegli un corpo CAD del progetto.')
      if (listCommands().some(command => command.name === 'reverse.body.edit_source')) {
        const result = await runCommand('reverse.body.edit_source', { body: body.id, expectedBuildVersion: source.current.version })
        const read = result as { version?: number; source?: { bodyId?: number; bodyKey?: string; buildVersion?: number; kind?: string; faces?: number; closed?: boolean; units?: string; coordinateFrame?: string } }
        const origin = read?.source
        if (read?.version !== 1 || origin?.bodyId !== body.id || !origin.bodyKey || origin.buildVersion !== source.current.version ||
            origin.kind !== (body.surface ? 'surface' : 'solid') || origin.faces !== body.faces || origin.closed !== body.closed ||
            origin.units !== 'mm' || origin.coordinateFrame !== 'part') {
          throw new Error('Il CAD ricevuto non identifica il corpo corrente del progetto.')
        }
        checkProject()
        const { file } = bodyStepResult(result)
        await load(new TextDecoder().decode(file.bytes), file.name, {
          faces: origin.faces,
          surface: origin.kind === 'surface',
          guard: async () => {
            // Opening the editor's worker is asynchronous too. The host key
            // must still identify the same built body after that operation.
            const checked = await runCommand('reverse.body.edit_source', {
              body: body.id, expectedKey: origin.bodyKey, expectedBuildVersion: origin.buildVersion,
            }) as { source?: { bodyId?: number; bodyKey?: string; buildVersion?: number } }
            if (checked.source?.bodyId !== body.id || checked.source.bodyKey !== origin.bodyKey || checked.source.buildVersion !== origin.buildVersion)
              throw new Error('Il corpo CAD è cambiato durante l’apertura.')
          },
        }, body.id)
        return
      }
      try {
        const result = bodyStepResult(await runCommand('reverse.export.step', { bodies: [body.id] }))
        await load(new TextDecoder().decode(result.file.bytes), result.file.name, { faces: body.faces, surface: !!body.surface }, body.id)
      } catch (err) {
        if (!body.surface || !(err instanceof Error) || !err.message.includes('there is no body to write')) throw err
        // The public STEP exporter intentionally omits ordinary sheets. Use the
        // archived import only when its sole body is still the selected shape.
        // A later operation may preserve an id while replacing the geometry.
        checkProject()
        const index = state.features.findIndex(f => {
          const made = state.results[f.id]
          return f.kind==='import' && !f.suppressed && made?.status==='ok' && made.bodies?.length===1 && made.bodies[0]===body.id
        })
        const sourceImport = state.features[index]
        if (sourceImport?.kind!=='import' || state.features.slice(index+1).some(f=>!f.suppressed && f.kind!=='import' && f.kind!=='sketch'))
          throw new Error('Il progetto non espone lo STEP corrente di questa superficie. Apri uno STEP aggiornato della superficie.')
        const step = state.stepFiles[sourceImport.file.key]
        if (!step) throw new Error('Il progetto non contiene il file STEP della superficie.')
        if (stepFileKey(step) !== sourceImport.file.key) throw new Error('Il file STEP conservato nel progetto non corrisponde al riferimento della superficie.')
        await load(step,sourceImport.file.name,{ faces: body.faces, surface: true },body.id)
      }
    }
    catch (e) { if (mounted.current && runtime.active) setError((e as Error).message) } finally { if (mounted.current && runtime.active) setBusy(false) }
  }
  const chooseFace = async (index: number) => {
    const selectedFace = faces[index]
    if (!selectedFace || busy || draft.getSnapshot().calculating || (net && face === index)) return
    if (selectedFace.reason) { setError(selectedFace.reason); return }
    const currentDraft = draft.getSnapshot()
    const geometryChanged = currentDraft.canUndo || !!(currentDraft.net && currentDraft.net !== currentDraft.committedNet) ||
      !!(currentDraft.net && currentDraft.originalNet && JSON.stringify(currentDraft.net.poles) !== JSON.stringify(currentDraft.originalNet.poles))
    if (face !== index && (notes.length || geometryChanged) &&
        !window.confirm('Cambiare faccia e scartare le modifiche e le note non applicate?')) return
    const generation = ++session.generation
    const chosenContinuity = draft.getSnapshot().continuity
    setBusy(true); setError('')
    try {
      await changeSurfaceFace({
        select: () => ask<Net>({ action: 'select', face: index }),
        current: () => mounted.current && runtime.active && generation === session.generation,
        install: n => {
          draft.install(n, { continuity: chosenContinuity, trimLocks: selectedFace.trimLocks })
          setFace(index); setNotes([]); setPlacingNote(false); setNoteError('')
        },
        invalidate: () => {
          // Keep note text for review, but never apply an uncertain CAD selection.
          draft.reset({ preserveContinuity: true }); setFace(-1); setPlacingNote(false)
          setNoteError('Selezione CAD non verificata. Le note sono conservate; scegli di nuovo la faccia o riapri Edit Surface.')
        },
      })
    } catch (e) {
      if (mounted.current && runtime.active && generation === session.generation) setError((e as Error).message)
    } finally { if (mounted.current && runtime.active && generation === session.generation) setBusy(false) }
  }
  const locked = useMemo(() => net ? surfacePoleLockIds(net, freeBoundary, continuity, draftState.trimLocks, locks, draftState.hiddenPoles) : [],
    [net, freeBoundary, continuity, draftState.trimLocks, locks, draftState.hiddenPoles])
  const editable = selected.filter(i => !locked.includes(i))
  const moveDirection = net && editable.length ? dragDirection(net, editable[0], dragMode, axis) : null
  const axisNames = dragMode === 'local' ? ['U', 'V', 'N'] : ['X', 'Y', 'Z']
  const committed = draftState.committedNet
  const partners = useMemo(() => symmetry && committed ? mirrorPartners(committed.poles, mirrorAxis, mirrorOffset) : null, [committed, symmetry, mirrorAxis, mirrorOffset])
  const changePoles = (poles: Point[], final: boolean) => {
    if (!committed) return
    try {
      const changed = { ...committed, poles: partners ? mirrorEdit(committed.poles, poles, partners, mirrorAxis, mirrorOffset, locked) : poles }
      if (final) draft.commit(changed); else draft.preview(changed)
      setError('')
    } catch (e) { draft.cancelDraft(); setError((e as Error).message) }
  }
  const transform = (fn: (p: Point, i: number, n: Net) => Point) => {
    if (!net) return
    const n = structuredClone(net); editable.forEach(i => { n.poles[i] = fn(net.poles[i], i, net) }); changePoles(n.poles, true)
  }
  const flatten = () => {
    if (!draftState.originalNet) return
    const n = draftState.originalNet, a = n.poles[0], u = n.poles[(n.nu - 1) * n.nv].map((x, i) => x - a[i]), v = n.poles[n.nv - 1].map((x, i) => x - a[i])
    const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], len = Math.hypot(...normal)
    if (len < 1e-10) { setError('I tre angoli non definiscono un piano.'); return }
    normal.forEach((x, i) => { normal[i] = x / len })
    transform(p => { const d = p.reduce((s, x, i) => s + (x - a[i]) * normal[i], 0); return p.map((x, i) => x - d * normal[i]) as Point })
  }
  const pickNote = async (point: Point | null) => {
    if (!point) { setNoteError('Clicca sulla faccia in modifica.'); return }
    const revision = preview?.previewRevision
    if (revision === undefined || !net || net !== validNet || calculating || busy) return
    setBusy(true)
    try {
      const generation = session.generation
      const pin = await ask<Pin>({action:'notePick',point,previewRevision:revision})
      ensureSession()
      if (generation !== session.generation) return
      const id = session.nextNote++
      setNotes(prev=>[...prev,{...pin,id,text:'',revision}])
      setNoteError(''); setPlacingNote(false)
    } catch(e) { if (mounted.current && runtime.active) setNoteError((e as Error).message) }
    finally { if (mounted.current && runtime.active) setBusy(false) }
  }
  const notesRef = useRef(notes); notesRef.current = notes
  useEffect(() => {
    const revision=preview?.previewRevision
    if (!revision || net !== validNet) return
    let active=true
    const generation = session.generation
    const pending=notesRef.current.filter(n=>n.revision!==revision)
    if (pending.length) void Promise.all(pending.map(async n=>({
      id:n.id,...await ask<{at:Point;normal:Point}>({action:'noteResolve',anchor:n.anchor,previewRevision:revision})
    }))).then(pins=>{
      if (active && generation === session.generation) setNotes(prev=>prev.map(n=>{
        const pin=pins.find(p=>p.id===n.id)
        return pin ? {...n,...pin,revision} : n
      }))
    }).catch(e=>{if(active && generation === session.generation)setNoteError(e.message)})
    return ()=>{active=false}
  },[preview,validNet,net])
  useEffect(() => {
    setDirectEdges(null)
    const revision=preview?.previewRevision
    if (!revision || !faces[face]?.openSheet || faces.length!==1 || !net || net!==validNet || busy || calculating || stripPaths || notes.length) return
    let active=true
    void ask<Point[][]>({action:'sheetEdges',previewRevision:revision})
      .then(paths=>{if(active)setDirectEdges({revision,paths})})
      .catch(()=>{if(active)setDirectEdges(null)})
    return ()=>{active=false}
  },[preview?.previewRevision,faces,face,net,validNet,busy,calculating,stripPaths,notes.length])
  const startStripMode=(paths:Point[][])=>{
    setPlacingNote(false);stripHistory.current=[null];stripAt.current=0
    stripPathsRef.current=paths
    setStripEdge(-1);setStripDelta([0,0,0]);setStripResult(null);setStripPaths(paths);setError('')
  }
  const beginStrip=async()=>{
    if(!preview?.previewRevision || notes.length || busy || calculating || stripPending.current)return
    stripPending.current=true;setBusy(true)
    try {
      const paths=await ask<Point[][]>({action:'sheetEdges',previewRevision:preview.previewRevision})
      ensureSession(); startStripMode(paths)
    } catch(e){if(mounted.current && runtime.active)setError((e as Error).message)} finally{stripPending.current=false;if(mounted.current && runtime.active)setBusy(false)}
  }
  const changeStrip=async(edge:number,delta:Point,final:boolean)=>{
    if(stripPending.current)return
    setStripEdge(edge);setStripDelta(delta);setError('')
    if(edge<0 || (final && Math.hypot(...delta)<1e-7)){stripUndo(0);return}
    if(!final || !preview?.previewRevision)return
    stripPending.current=true;setBusy(true)
    try {
      const result=await ask<StripState>({action:'duplicateSheetEdge',edge,delta,path:(stripResult?.paths??stripPathsRef.current)?.[edge],previous:stripResult?.moves,previewRevision:preview.previewRevision})
      ensureSession()
      const states=stripHistory.current.slice(0,stripAt.current+1)
      states.push(result)
      if(states.length>12)states.splice(1,1)
      stripHistory.current=states;stripAt.current=states.length-1
      setStripEdge(-1);setStripDelta([0,0,0]);setStripResult(result)
    } catch(e){stripPending.current=false;if(mounted.current && runtime.active){stripUndo(0);setError((e as Error).message)}} finally{stripPending.current=false;if(mounted.current && runtime.active)setBusy(false)}
  }
  const beginDirectStrip=()=>{
    if(!directEdges || directEdges.revision!==preview?.previewRevision || net!==validNet || busy || calculating || placingNote || notes.length || stripPathsRef.current || stripPending.current)return false
    startStripMode(directEdges.paths);return true
  }
  const abortDirectStrip=()=>{
    if(stripPending.current)return
    stripPathsRef.current=null;stripHistory.current=[];stripAt.current=0
    setStripPaths(null);setStripResult(null);setStripEdge(-1);setStripDelta([0,0,0]);setError('')
  }
  const checkProject = () => {
        ensureSession()
        const r = useReverse.getState(), m = useStore.getState(), s = source.current
        if (r.buildVersion !== s.version || r.features !== s.features || r.rolledBack !== s.rolledBack || r.stepFiles !== s.stepFiles || r.parameters !== s.parameters || m.fileName !== s.file || m.appliedAlignment !== s.alignment || reEditorOpen(r) || r.building) throw new Error('Il progetto è cambiato. Esporta il risultato STEP e riaprilo nel progetto aggiornato.')
  }
  const stripName=name.replace(/\.step$/i,'-striscia.step')
  const applyStrip = async () => {
    if (!stripPaths || !stripResult || stripEdge>=0 || busy || notes.length || stripPending.current) return
    setBusy(true); setError('')
    try {
      checkProject()
      await runCommand('reverse.import.step',{bytes:new TextEncoder().encode(stripResult.step),name:stripName})
      close()
    } catch(e){if(mounted.current && runtime.active)setError((e as Error).message)}
    finally{if(mounted.current && runtime.active)setBusy(false)}
  }
  const finish = async (importBody: boolean) => {
    if (!net || busy || calculating || validNet !== net) return
    setBusy(true); setError('')
    try {
      const result = await draft.evaluateForExport()
      ensureSession()
      if (importBody) {
        checkProject()
        if (notes.length) {
          if (!applyWithNotes || notes.some(n=>!n.text.trim())) throw new Error('Completa le note prima di applicare.')
          const finalNotes=await Promise.all(notes.map(async n=>({
            draftId:String(n.id),anchor:n.anchor,text:n.text.trim(),u:n.anchor.u,v:n.anchor.v,
            ...await ask<{at:Point;normal:Point}>({action:'noteResolve',anchor:n.anchor,previewRevision:result.previewRevision})
          })))
          const witness=await ask<Omit<SurfaceNoteCommit['final'],'editorSessionId'>>({action:'finalFaceWitness',previewRevision:result.previewRevision})
          checkProject() // The source may change while the note anchors are resolved.
          await applyWithNotes({step:result.step,name,faceIndex:face,final:{...witness,editorSessionId},notes:finalNotes})
        } else await runCommand('reverse.import.step', { bytes: new TextEncoder().encode(result.step), name })
        close()
      } else { saveFile(name, new Blob([result.step], { type: 'model/step' })) }
    } catch (e) { if (mounted.current && runtime.active) setError((e as Error).message) } finally { if (mounted.current && runtime.active) setBusy(false) }
  }
  return <div className="modalback es-back"><div role="dialog" aria-modal="true" aria-label="Edit Surface" className="es-dialog" data-test="edit-surface-dialog" onKeyDown={e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); e.stopPropagation(); if (!busy) undo(e.shiftKey ? 1 : -1) }
    if (e.key === 'Escape') { e.stopPropagation(); if (!busy) cancel() }
  }}>
    <header><strong>Edit Surface · prototipo CAD</strong><button disabled={busy} onClick={cancel} aria-label="Chiudi Edit Surface">×</button></header>
    <div className="es-content"><aside>
      {!net && <><label>Corpo CAD<select data-test="surface-body" value={bodyId} disabled={busy} onChange={e => setBodyId(Number(e.target.value))}>{re.bodies.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        <button data-test="surface-load-body" disabled={busy || !re.bodies.some(b => b.id === bodyId)} onClick={() => void loadBody()}>Carica corpo</button>
        <label>Oppure apri STEP<input type="file" accept=".step,.stp" disabled={busy} data-test="surface-step-file" onChange={e => { const f = e.target.files?.[0]; if (f) void f.text().then(text => { if (mounted.current && runtime.active) return load(text, f.name) }).catch(err => { if (mounted.current && runtime.active) setError((err as Error).message) }) }} /></label>
        <p>Seleziona una faccia nel modello o nell’elenco.</p>
        <select aria-label="Faccia CAD" data-test="surface-face" value={face} disabled={busy || calculating || !faces.length} onChange={e => void chooseFace(Number(e.target.value))}><option value={-1}>Scegli faccia…</option>{faces.map(f => <option key={f.index} value={f.index} disabled={!!f.reason}>Faccia {f.index + 1} · {f.kind}{f.reason ? ' · non supportata' : ''}</option>)}</select>
        {faces.some(f => f.reason) && <details><summary>Facce non supportate</summary>{faces.filter(f => f.reason).map(f => <p key={f.index}>#{f.index + 1}: {f.reason}</p>)}</details>}
      </>}
      {!net && notes.length > 0 && <fieldset><legend>Note conservate</legend>
        <p role="alert">{noteError}</p>
        {notes.map(n => <label key={n.id}>Nota {n.id}<textarea readOnly value={n.text} /></label>)}
      </fieldset>}
      {stripPaths && <><h3>Duplica bordo libero</h3><p>Scegli la direzione e trascina un bordo evidenziato. Dopo la cucitura puoi trascinare un altro bordo libero.</p>
        <div className="es-row">{['X','Y','Z'].map((label,i)=><button key={label} disabled={busy} data-test={'strip-axis-'+i} aria-pressed={axis===i} onClick={()=>setAxis(i)}>{label}</button>)}</div>
        <p data-test="strip-result">{stripEdge>=0?'Anteprima striscia':stripResult?'Striscia valida · '+len.area(stripResult.addedArea,3): 'Trascina il bordo esterno'}</p>
        <div className="es-row"><button data-test="strip-undo" disabled={busy || stripAt.current===0} onClick={()=>stripUndo(-1)}>Annulla striscia</button>
          <button data-test="strip-redo" disabled={busy || stripAt.current+1>=stripHistory.current.length} onClick={()=>stripUndo(1)}>Ripeti striscia</button></div>
        <button data-test="strip-export" disabled={busy || stripEdge>=0 || !stripResult} onClick={()=>{if(stripResult)saveFile(stripName,new Blob([stripResult.step],{type:'model/step'}))}}>Esporta superficie con striscia</button>
        <button disabled={busy} onClick={()=>{setStripPaths(null);setStripResult(null);setError('')}}>Torna alla faccia iniziale</button></>}
      {net && !stripPaths && <>
        <p><strong>Faccia {face + 1} · {net.nu} × {net.nv} punti</strong><br/>{faces[face]?.converted ? 'Piano convertito esattamente in NURBS, senza fitting.' : 'Modifica diretta dei poli NURBS esistenti.'}</p>
        {!!faces[face]?.trimLocks.length && <p className="es-hint">I punti che influenzano i contorni ritagliati sono protetti. {faces[face]?.hiddenPoles.length ? 'I punti protetti esterni alla faccia sono nascosti. ' : ''}Trascina un punto libero per deformare la faccia.</p>}
        {faces[face]?.enriched && <p className="es-hint">Reticolo arricchito da 4×4 a 5×5 senza modificare la forma. Il punto centrale resta libero anche con protezione G1.</p>}
        <button disabled={busy || calculating} onClick={() => { if (loaded.current && window.confirm('Scartare questa bozza e scegliere un’altra faccia?')) void load(loaded.current.step, loaded.current.name, undefined, loaded.current.bodyId) }}>Cambia faccia / corpo</button>
        {faces[face]?.openSheet && <button data-test="strip-open" disabled={busy || calculating || validNet!==net || !!notes.length} onClick={()=>void beginStrip()}>Duplica bordo libero…</button>}
        {directEdges && <p className="es-hint">{freeBoundary ? 'Per duplicare un bordo usa il pulsante dedicato. La maniglia D è nascosta mentre modifichi i bordi.' : "Per duplicare un bordo libero, cliccalo e trascina la maniglia D lungo l'asse scelto."}</p>}
        {faces[face]?.freeBoundary && <label><input data-test="surface-free-boundary" type="checkbox" checked={freeBoundary} disabled={busy || calculating} onChange={e => {
          try { draft.setFreeBoundary(e.target.checked); setError('') }
          catch { setError('Annulla prima gli spostamenti dei bordi per proteggerli di nuovo.') }
        }}/> Consenti lo spostamento dei bordi liberi</label>}
        <label>Protezione bordi<select data-test="surface-continuity" value={continuity} disabled={busy || freeBoundary} onChange={e => { const c = e.target.value as 'G0' | 'G1'; try { draft.setContinuity(c); setError('') } catch { setError('Ripristina prima i punti vicini ai bordi per attivare G1.') } }}><option value="G0">G0 · mantieni posizione dei bordi</option><option value="G1">G1 · mantieni anche tangenti esistenti</option></select></label>
        <p className="es-hint">{freeBoundary ? 'Puoi spostare i punti del bordo della superficie aperta. I punti bloccati manualmente restano fermi.' : 'I bordi restano bloccati. G1 conserva le tangenti originali; non corregge discontinuità preesistenti.'}</p>
        <div className="es-row">{axisNames.map((a, i) => <button key={a} data-test={`surface-axis-${i}`} aria-pressed={axis === i} onClick={() => setAxis(i)}>{a}</button>)}</div>
        <label>Trascinamento punti<select data-test="surface-drag-mode" value={dragMode} onChange={e => setDragMode(e.target.value as DragMode)}><option value="axis">Mondo · asse X/Y/Z</option><option value="screen">Piano dello schermo</option><option value="local">Locale · U/V/normale</option></select></label>
        <fieldset><legend>Magnete · Snap mode</legend>
          <label className="es-inline-check"><input data-test="surface-snap" type="checkbox" checked={snap} onChange={e=>setSnap(e.target.checked)}/> Aggancia i punti ai riferimenti vicini</label>
          {snap && <><label>Portata · {len.word()}<input data-test="surface-snap-distance" type="number" min={len.toDisplay(.001)} max={len.toDisplay(1000)} step={len.step(.1)} value={Number.isFinite(snapDistance) ? len.toDisplay(snapDistance) : ''} onChange={e=>setSnapDistance(len.fromDisplay(e.target.valueAsNumber))} /></label>
            {(!Number.isFinite(snapDistance) || snapDistance<=0 || snapDistance>1000) && <p role="alert">Inserisci una portata tra {len.fmt(.001,len.units==='in'?6:3)} e {len.fmt(1000)} per attivare l'aggancio.</p>}
            <p className="es-hint" data-test="surface-snap-info">{referenceBody === null ? 'STEP aperto fuori dal progetto: per usare scansione e altri corpi, importa il CAD nel progetto e caricalo da qui. ' : `${referenceCount} riferimenti visibili tra scansione e altri corpi CAD. `}I riferimenti nascosti nel progetto sono esclusi. Sono utilizzabili anche le altre facce dello stesso corpo. Tieni premuto Alt per sospendere il magnete. L'aggancio usa la rappresentazione visualizzata; i poli non sono necessariamente punti della superficie.</p></>}
        </fieldset>
        <details><summary>Filtri di selezione del reticolo</summary><label>Selezione<select data-test="surface-selection-mode" value={selectionMode} onChange={e => setSelectionMode(e.target.value as NetSelectionMode)}><option value="auto">Diretta · punti, segmenti e celle</option><option value="points">Solo punti</option><option value="edges">Solo segmenti</option><option value="cells">Solo celle</option><option value="mixed">Punti e segmenti</option></select></label></details>
        <p className="es-hint">Passa sul reticolo: l'elemento evidenziato si seleziona con un clic. Punti, segmenti e celle selezionano rispettivamente uno, due o quattro poli. Ctrl+clic aggiunge o toglie dalla selezione. I poli bloccati restano fermi. Se il reticolo è nascosto, solo i punti sono selezionabili.</p>
        <p>{dragMode === 'screen' ? 'Trascina liberamente sul piano dello schermo, mantenendo la profondità. La quota numerica usa X/Y/Z.' : dragMode === 'local' ? 'U segue la tangente della superficie; V è la tangente ortogonale, N la normale parametrica. Trascina il punto o la freccia gialla, oppure imposta una quota.' : 'Trascina il punto o la freccia gialla lungo l’asse scelto.'} {dragMode !== 'screen' && 'Se la direzione punta verso la vista, trascina in verticale per muovere il punto in profondità.'} Pulsante centrale: ruota; destro: sposta la vista; rotella: zoom. Lo stiramento usa sempre X/Y/Z.</p>
        {dragMode === 'local' && editable.length > 0 && !moveDirection && <p role="alert">Riferimento locale non definito in questo punto. Scegli un altro punto o il riferimento mondo.</p>}
        <label>Intensità trascinamento · {Math.round(dragStrength * 100)}%<input data-test="surface-drag-strength" type="range" min="0.05" max="1" step="0.05" value={dragStrength} onChange={e => setDragStrength(Number(e.target.value))} /></label>
        <p className="es-hint">Riduce lo spostamento durante il trascinamento per modifiche fini. Le quote numeriche restano esatte.</p>
        <fieldset><legend>Simmetria dei poli</legend>
          <label><input data-test="surface-symmetry" type="checkbox" checked={symmetry} onChange={e=>setSymmetry(e.target.checked)}/> Modifica anche il polo speculare</label>
          {symmetry && <><label>Piano<select data-test="surface-mirror-plane" value={mirrorAxis} onChange={e=>setMirrorAxis(Number(e.target.value))}><option value={0}>YZ</option><option value={1}>XZ</option><option value={2}>XY</option></select></label>
            <label>Posizione lungo {['X','Y','Z'][mirrorAxis]} ({len.word()})<input key={`${mirrorAxis}:${mirrorOffset}:${len.units}`} data-test="surface-mirror-offset" type="number" step="any" defaultValue={lengthInputText(mirrorOffset,len.units)} onBlur={e=>{
              const shown=lengthInputText(mirrorOffset,len.units)
              if(e.currentTarget.value===shown)return
              const value=len.fromDisplay(e.currentTarget.valueAsNumber)
              if(Number.isFinite(value))setMirrorOffset(value)
              else e.currentTarget.value=shown
            }}/></label>
            <p data-test="surface-mirror-feedback" role="status">Viola: piano e poli speculari. Giallo: selezione.
              {editable.length > 0 && partners && (editable.some(i => partners[i] < 0 || locked.includes(partners[i]))
                ? ' La selezione contiene un polo senza corrispondente libero.'
                : ' Tutti i poli selezionati liberi hanno un corrispondente.')}</p>
            <p>I poli sul piano scorrono lungo il piano. La coppia deve appartenere alla faccia attiva ed essere libera.</p>
            <button data-test="surface-project-poles" disabled={busy || !editable.length} onClick={()=>{
              const placed=structuredClone(net)
              editable.forEach(i=>{placed.poles[i][mirrorAxis]=mirrorOffset})
              commit(placed)
            }}>Porta i poli selezionati sul piano</button></>}
        </fieldset>
        <button data-test="surface-control-net" aria-pressed={showNet} onClick={() => setShowNet(v => !v)}>{showNet ? 'Nascondi reticolo' : 'Mostra reticolo'}</button>
        {hasSurfaceZebra && <>
          <button data-test="surface-zebra" aria-pressed={zebra} onClick={() => setZebra(v=>!v)}>Zebra</button>
          {zebra && <details><summary>Opzioni Zebra</summary>
            <label>Larghezza strisce · {stripes.width}<input type="range" min="1" max="7" step="1" value={stripes.width} onChange={e=>setStripes({...stripes,width:Number(e.target.value)})}/></label>
            <label>Orientamento<select data-test="surface-zebra-direction" value={stripes.orientation} onChange={e=>setStripes({...stripes,orientation:e.target.value as StripeSettings['orientation']})}><option value="horizontal">Orizzontale</option><option value="vertical">Verticale</option></select></label>
            <label>Colore strisce<input type="color" value={stripes.color} onChange={e=>setStripes({...stripes,color:e.target.value})}/></label>
          </details>}
        </>}
        {(zebra || notes.length>0 || placingNote) && <fieldset><legend>Note sulla superficie</legend>
          <button data-test="surface-note-add" disabled={busy || calculating || validNet!==net} aria-pressed={placingNote}
            onClick={()=>{setNoteError('');setPlacingNote(!placingNote)}}>{placingNote?'Annulla scelta punto':'Aggiungi nota sulla faccia'}</button>
          {placingNote && <p>Clicca sulla faccia in modifica per posizionare la nota.</p>}
          {notes.map(n=><div key={n.id}><label>Nota {n.id}<input data-test="surface-note-text" disabled={busy} value={n.text} maxLength={2000}
            onChange={e=>setNotes(prev=>prev.map(item=>item.id===n.id?{...item,text:e.target.value}:item))}/></label>
            <small data-test="surface-note-position">{n.revision===preview?.previewRevision ? n.at.map((v,i)=>['X','Y','Z'][i]+' '+len.fmt(v,3)).join(' · ') : 'Aggiornamento posizione…'}</small>
            <button disabled={busy} onClick={()=>setNotes(prev=>prev.filter(item=>item.id!==n.id))}>Rimuovi nota {n.id}</button></div>)}
          {notes.length>0 && !applyWithNotes && <p>Note in bozza. Questa versione non salva ancora le note nel progetto. Rimuovile per applicare il corpo senza note.</p>}
          {noteError && <p role="alert">{noteError}</p>}
        </fieldset>}
        <label>Trasparenza superficie · {Math.round(transparency * 100)}%<input data-test="surface-transparency" type="range" min="0" max="0.9" step="0.05" value={transparency} onChange={e => setTransparency(Number(e.target.value))} /></label>
        <div className="es-row"><button onClick={() => draft.setSelection(net.poles.flatMap((_, i) => locked.includes(i) ? [] : [i]))}>Seleziona liberi</button><button onClick={() => draft.setSelection([])}>Nessuno</button></div>
        <p data-test="surface-selection">{selected.length} selezionati · {editable.length} modificabili</p>
        <div className="es-row"><button disabled={busy || !selected.length} onClick={() => draft.setLocks([...locks, ...selected])}>Blocca punti</button><button disabled={busy || !selected.length} onClick={() => draft.setLocks(locks.filter(i => !selected.includes(i)))}>Sblocca punti</button></div>
        <label>Spostamento · {len.word()}<input type="text" inputMode="decimal" value={distanceText} data-test="surface-distance" onChange={e => {
          setDistanceText(e.target.value)
        }} onBlur={() => { if (distanceText.trim() === '-') setDistanceText('') }} /></label>
        <button data-test="surface-move" disabled={busy || !moveDirection || distanceValue === null} onClick={() => { if (moveDirection && distanceValue !== null) transform(p => p.map((x, i) => x + moveDirection[i] * distanceValue) as Point) }}>Sposta lungo {axisNames[axis]}</button>
        <button disabled={busy || !editable.length} onClick={flatten}>Spiana sul piano dei tre angoli iniziali</button>
        <label>Intensità levigatura · {Math.round(smoothStrength * 100)}%<input data-test="surface-smooth-strength" type="range" min="0.05" max="1" step="0.05" value={smoothStrength} onChange={e => setSmoothStrength(Number(e.target.value))} /></label>
        <button data-test="surface-smooth" disabled={busy || !editable.length} onClick={() => transform((p, i, n) => { const row = Math.floor(i / n.nv), col = i % n.nv, neighbors = [row > 0 ? i - n.nv : -1, row + 1 < n.nu ? i + n.nv : -1, col > 0 ? i - 1 : -1, col + 1 < n.nv ? i + 1 : -1].filter(j => j >= 0); return p.map((x, d) => x * (1 - smoothStrength) + neighbors.reduce((s, j) => s + n.poles[j][d], 0) / neighbors.length * smoothStrength) as Point })}>Levigatura locale · {Math.round(smoothStrength * 100)}%</button>
        <label>Fattore stiramento<input type="text" inputMode="decimal" value={factorText} onChange={e => {
          setFactorText(e.target.value)
        }} onBlur={() => { if (factorText.trim() === '-') setFactorText('') }} /></label>
        <button disabled={busy || !editable.length || factorValue === null || factorValue <= 0 || factorValue > 3} onClick={() => { if (factorValue === null || factorValue <= 0 || factorValue > 3) return; const center = net.poles.reduce((s, p) => s + p[axis], 0) / net.poles.length; transform(p => p.map((x, i) => i === axis ? center + (x - center) * factorValue : x) as Point) }}>Stira lungo {['X', 'Y', 'Z'][axis]}</button>
        <div className="es-row"><button data-test="surface-undo" disabled={busy || !draftState.canUndo} onClick={() => undo(-1)}>Annulla</button><button data-test="surface-redo" disabled={busy || !draftState.canRedo} onClick={() => undo(1)}>Ripeti</button><button disabled={busy} onClick={() => draft.restoreOriginal()}>Ripristina</button></div>
      </>}
    </aside><main><SurfaceViewport mirrorAxis={mirrorAxis} mirrorOffset={mirrorOffset} mirrorPartners={partners} strip={stripPaths?{paths:stripResult?.paths??stripPaths,axis,edge:stripEdge,delta:stripDelta,change:changeStrip}:null} stripBlocked={()=>stripPending.current} directStrip={directEdges && directEdges.revision===preview?.previewRevision && net===validNet && !busy && !calculating && !freeBoundary && !placingNote && !notes.length && !stripPaths ? {paths:directEdges.paths,axis,revision:directEdges.revision,begin:beginDirectStrip,abort:abortDirectStrip,unavailable:()=>setError('Direzione allineata alla vista: ruota il modello o scegli un altro asse.'),change:changeStrip}:null} notePins={notes.filter(n=>n.revision===preview?.previewRevision).map(n=>n.at)} placingNote={placingNote} onNote={p=>void pickNote(p)} stripes={zebra ? stripes : null} key={loadId} preview={stripPaths && stripResult ? stripResult.preview : preview} net={stripPaths?null:net} selected={selected} locked={locked} hiddenPoles={faces[face]?.hiddenPoles ?? NO_HIDDEN_POLES} face={face} axis={axis} busy={busy} dragStrength={dragStrength} dragMode={dragMode} selectionMode={selectionMode} showNet={showNet} transparency={transparency} snap={snap} snapDistance={snapDistance} referenceBody={referenceBody} onReferenceCount={setReferenceCount} registerCancel={fn=>{cancelGesture.current=fn}} onFace={i => {if(!stripPaths)void chooseFace(i)}} onPoints={(ids, multi) => draft.setSelection(selectNetPoints([...draft.getSnapshot().selected], ids, multi))} onDrag={changePoles} />
      <div className="es-status" role="status" data-test="surface-status" data-preview-revision={preview?.previewRevision} data-preview-volume={preview?.volume}>{stripPaths ? (busy?'Verifica cucitura…':error || (stripResult?('Superficie CAD valida · '+stripResult.preview.faceMeshes.length+' facce cucite'):'Trascina un bordo per creare la striscia.')) : busy ? 'Elaborazione CAD…' : calculating ? 'Aggiornamento e verifica CAD…' : error ? `${error}${preview ? ' Vista: ultimo risultato valido.' : ''}` : validNet && preview ? `CAD valido · ${faces[face]?.openSheet ? 'superficie aperta' : `volume ${len.vol(preview.volume,3)}`} · ${freeBoundary ? 'spostamento bordo' : 'scarto bordo'} ${formatSurfaceResidual(preview.maxBoundaryError,len.units)}` : 'Apri un corpo STEP e scegli una faccia.'}</div>
    </main></div>
    <footer><span>{stripPaths?'Applica aggiunge la superficie cucita al progetto come nuovo corpo.':'Applica crea una copia CAD modificata. Originale conservato. La copia entra nella cronologia del progetto.'}</span><button disabled={!!stripPaths || busy || calculating || !net || validNet !== net} onClick={() => void finish(false)}>Esporta STEP…</button><button data-test="surface-apply" disabled={(!!stripPaths && (!stripResult || stripEdge>=0)) || (notes.length>0 && (!applyWithNotes || notes.some(n=>!n.text.trim()))) || busy || calculating || !net || validNet !== net} onClick={() => stripPaths ? void applyStrip() : void finish(true)}>{stripPaths ? 'Applica superficie cucita' : 'Applica come nuovo corpo'}</button><button disabled={busy} onClick={cancel}>Annulla</button></footer>
  </div></div>
}
