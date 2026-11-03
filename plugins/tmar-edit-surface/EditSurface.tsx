// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { listCommands, runCommand } from '../../src/commands/registry'
import { useCommandActivity } from '../../src/commands/activity'
import { useStore } from '../../src/state/store'
import { saveFile } from '../../src/app/exports'
import { create } from 'zustand'
import { reEditorOpen, useReverse } from '../reverse/state/reStore'
import { stepFileKey } from '../reverse/core/features'
import { bodyStepResult } from '../tmar-body-export/bodyExport'
import { assertNet, boundaryLocked, type Net, type Point } from './brep'
import type { StripMove } from './sheetExtension'
import type { DraftAnchor, FaceInfo, Preview } from './editorKernel'
import type { Request } from './editor.worker'
import { SurfaceViewport, hasSurfaceZebra, type StripeSettings } from './SurfaceViewport'
import { dragDirection, type DragMode } from './localFrame'
import { mirrorPartners, mirrorEdit } from './symmetry'
import { selectNetPoints, type NetSelectionMode } from './netSelection'
import './surface.css'
type Payload = Request extends infer R ? R extends Request ? Omit<R, 'id'> : never : never
type PreviewJob = { net: Net; continuity: 'G0' | 'G1'; freeBoundary: boolean; epoch: number }
type EditFrame = { net: Net; locks: number[]; continuity: 'G0' | 'G1'; freeBoundary: boolean }
const NO_HIDDEN_POLES: number[] = []

interface StripState {step:string;addedArea:number;preview:Preview;paths:Point[][];moves:StripMove[]}
interface Pin { anchor: DraftAnchor; at: Point; normal: Point }
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
  const [open, setOpen] = useState(false)
  const busy = useStore(s => s.busy), running = useCommandActivity(s => s.running !== null)
  const re = useReverse(useShallow(s => ({ bodies: s.bodies, building: s.building, editing: reEditorOpen(s), playback: s.playback !== null })))
  return <div className="group" data-test="edit-surface-entry"><button className="block" disabled={busy || running || re.building || re.editing || re.playback} onClick={() => setOpen(true)}>Edit Surface · punti CAD…</button>
    {open && <SurfaceDialog applyWithNotes={applyWithNotes} close={() => setOpen(false)} />}</div>
}
function SurfaceDialog({ close, applyWithNotes }: SurfaceOptions & { close: () => void }) {
  const re = useReverse.getState(), model = useStore.getState()
  const source = useRef({ version: re.buildVersion, features: re.features, rolledBack: re.rolledBack, stepFiles: re.stepFiles, parameters: re.parameters, file: model.fileName, alignment: model.appliedAlignment })
  const [bodyId, setBodyId] = useState(re.bodies[0]?.id ?? '')
  const [name, setName] = useState('superficie-modificata.step')
  const loaded = useRef<{ step: string; name: string } | null>(null)
  const [loadId, setLoadId] = useState(0)
  const [faces, setFaces] = useState<FaceInfo[]>([]), [face, setFace] = useState(-1)
  const [preview, setPreview] = useState<Preview | null>(null), [net, setNetState] = useState<Net | null>(null)
  const netRef = useRef<Net | null>(null), base = useRef<Net | null>(null)
  const history = useRef<EditFrame[]>([]), at = useRef(-1), [, historyTick] = useState(0)
  const [selected, setSelected] = useState<number[]>([]), [locks, setLocks] = useState<number[]>([])
  const locksRef = useRef(locks); locksRef.current = locks
  const [continuity, setContinuity] = useState<'G0' | 'G1'>('G1'), [axis, setAxis] = useState(2)
  const continuityRef = useRef(continuity); continuityRef.current = continuity
  const [freeBoundary, setFreeBoundary] = useState(false)
  const freeBoundaryRef = useRef(freeBoundary); freeBoundaryRef.current = freeBoundary
  const [distance, setDistance] = useState(1), [factor, setFactor] = useState(1.1)
  const [dragStrength, setDragStrength] = useState(1), [smoothStrength, setSmoothStrength] = useState(0.5)
  const [dragMode, setDragMode] = useState<DragMode>('axis')
  const [selectionMode, setSelectionMode] = useState<NetSelectionMode>('points')
  const [placingNote, setPlacingNote] = useState(false)
  const [notes, setNotes] = useState<(Pin & {id:number; text:string; revision:number})[]>([])
  const [editorSessionId]=useState(()=>crypto.randomUUID())
  const nextNote = useRef(1)
  const [noteError,setNoteError] = useState('')
  const cancel = () => {
    if (!notes.length || window.confirm('Chiudere e scartare le note della bozza?')) close()
  }
  const [stripPaths,setStripPaths]=useState<Point[][]|null>(null)
  const [stripEdge,setStripEdge]=useState(-1), [stripDelta,setStripDelta]=useState<Point>([0,0,0])
  const [stripResult,setStripResult]=useState<StripState|null>(null)
  const stripHistory=useRef<(StripState|null)[]>([])
  const stripAt=useRef(0)
  const stripUndo=(direction:number)=>{
    const next=stripAt.current+direction
    const item=stripHistory.current[next]
    if(item===undefined)return
    stripAt.current=next;setStripEdge(-1);setStripDelta([0,0,0]);setStripResult(item);setError('')
  }
  const [zebra, setZebra] = useState(false)
  const [stripes, setStripes] = useState<StripeSettings>({ orientation:'horizontal', width:3, color:'#5388b1' })
  const [symmetry, setSymmetry] = useState(false)
  const [mirrorAxis, setMirrorAxis] = useState(0), [mirrorOffset, setMirrorOffset] = useState(0)
  const [showNet, setShowNet] = useState(true), [transparency, setTransparency] = useState(0)
  const [busy, setBusy] = useState(false), [calculating, setCalculating] = useState(false)
  const [error, setError] = useState(''), [validNet, setValidNet] = useState<Net | null>(null)
  const worker = useRef<Worker | null>(null), serial = useRef(0), mounted = useRef(true)
  const requests = useRef(new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>())
  const evaluateRunning = useRef(false), evaluateTimer = useRef<ReturnType<typeof setTimeout> | null>(null), previewEpoch = useRef(0)
  const latest = useRef<PreviewJob | null>(null)
  useEffect(() => {
    mounted.current = true
    const w = new Worker(new URL('./editor.worker.ts', import.meta.url), { type: 'module' }); worker.current = w
    w.onmessage = ({ data }) => { const p = requests.current.get(data.id); requests.current.delete(data.id); if (p) { if (data.error) p.reject(new Error(data.error)); else p.resolve(data.result) } }
    w.onerror = () => { for (const p of requests.current.values()) p.reject(new Error('Motore CAD interrotto. Chiudi e riapri Edit Surface.')); requests.current.clear() }
    return () => { mounted.current = false; previewEpoch.current++; latest.current = null; if (evaluateTimer.current !== null) clearTimeout(evaluateTimer.current); evaluateTimer.current = null; w.terminate(); for (const p of requests.current.values()) p.reject(new Error('Editor chiuso.')); requests.current.clear() }
  }, [])
  const ask = <T,>(payload: Payload): Promise<T> => new Promise((resolve, reject) => {
    if (!worker.current) { reject(new Error('Motore non pronto.')); return }
    const id = ++serial.current; requests.current.set(id, { resolve: value => resolve(value as T), reject }); worker.current.postMessage({ ...payload, id })
  })
  const invalidatePreview = () => {
    previewEpoch.current++; latest.current = null
    if (evaluateTimer.current !== null) clearTimeout(evaluateTimer.current)
    evaluateTimer.current = null; setCalculating(false); setValidNet(null)
  }
  const setNet = (n: Net | null) => { netRef.current = n; setNetState(n) }
  const applyFrame = (frame: EditFrame) => {
    const geometryChanged = netRef.current !== frame.net || continuityRef.current !== frame.continuity || freeBoundaryRef.current !== frame.freeBoundary
    if (geometryChanged) { setValidNet(null); setCalculating(true); setError('') }
    if (netRef.current !== frame.net) setNet(frame.net)
    if (JSON.stringify(locksRef.current) !== JSON.stringify(frame.locks)) { locksRef.current = frame.locks; setLocks(frame.locks) }
    if (continuityRef.current !== frame.continuity) { continuityRef.current = frame.continuity; setContinuity(frame.continuity) }
    if (freeBoundaryRef.current !== frame.freeBoundary) { freeBoundaryRef.current = frame.freeBoundary; setFreeBoundary(frame.freeBoundary) }
  }
  const commit = (n: Net, change: Partial<Omit<EditFrame, 'net'>> = {}) => {
    const previous = history.current[at.current]
    // Reuse the immutable net for protection-only actions: locking a point
    // must not invalidate an already validated surface or recalculate CAD.
    const nextNet = previous && JSON.stringify(previous.net) === JSON.stringify(n) ? previous.net : structuredClone(n)
    const next: EditFrame = { net: nextNet, locks: [...new Set(change.locks ?? locksRef.current)].sort((a, b) => a - b), continuity: change.continuity ?? continuityRef.current, freeBoundary: change.freeBoundary ?? freeBoundaryRef.current }
    if (!previous || previous.net !== next.net || JSON.stringify(previous.locks) !== JSON.stringify(next.locks) || previous.continuity !== next.continuity || previous.freeBoundary !== next.freeBoundary) {
      history.current = history.current.slice(0, at.current + 1); history.current.push(next)
      if (history.current.length > 60) history.current.shift()
      at.current = history.current.length - 1
    }
    applyFrame(next); historyTick(v => v + 1)
  }
  const undo = (delta: number) => { const next = at.current + delta; if (next >= 0 && next < history.current.length) { at.current = next; applyFrame(history.current[next]); historyTick(v => v + 1) } }
  const modalKeys = useRef({ busy, undo, close }); modalKeys.current = { busy, undo:stripPaths?stripUndo:undo, close:cancel }
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
      if (e.key === 'Escape' && !s.busy) { e.preventDefault(); s.close() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true); useSurfaceDialogs.setState(s => ({ count: s.count - 1 })) }
  }, [])
  useEffect(() => {
    if (!net) { latest.current = null; return }
    latest.current = { net, continuity, freeBoundary, epoch: previewEpoch.current }; setCalculating(true); setValidNet(null)
    // Keep the first scheduled evaluation while the pointer moves. Replacing
    // this timer on every movement starves the visible CAD preview.
    if (evaluateRunning.current || evaluateTimer.current !== null) return
    evaluateTimer.current = setTimeout(() => {
      evaluateTimer.current = null
      const drain = async () => {
        if (evaluateRunning.current || !latest.current) return
        evaluateRunning.current = true
        let last: PreviewJob | null = null
        while (latest.current && mounted.current) {
          const job = latest.current; latest.current = null; last = job
          try {
            const p = await ask<Preview>({ action: 'evaluate', net: job.net, continuity: job.continuity, freeBoundary: job.freeBoundary })
            const sameContext = job.epoch === previewEpoch.current && job.continuity === continuityRef.current && job.freeBoundary === freeBoundaryRef.current
            if (mounted.current && sameContext) {
              // A valid intermediate CAD result is useful during a drag, but
              // only the exact current net may enable Apply or note picking.
              setPreview(p)
              if (job.net === netRef.current) { setError(''); setValidNet(job.net) }
            }
          } catch (e) { if (mounted.current && job.epoch === previewEpoch.current && job.net === netRef.current && job.continuity === continuityRef.current && job.freeBoundary === freeBoundaryRef.current) { setError(String((e as Error).message)); setValidNet(null) } }
        }
        evaluateRunning.current = false
        if (mounted.current && !latest.current && last?.epoch === previewEpoch.current && last.net === netRef.current && last.continuity === continuityRef.current && last.freeBoundary === freeBoundaryRef.current) setCalculating(false)
      }
      void drain()
    }, 90)
  }, [net, continuity, freeBoundary])
  const load = async (step: string, fileName: string, expected?: { faces: number; surface: boolean; guard?: () => Promise<void> }) => {
    invalidatePreview(); setBusy(true); setError('')
    try {
      const result = await ask<{ faces: FaceInfo[]; preview: Preview }>({ action: 'open', step })
      if (expected) {
        checkProject()
        await expected.guard?.()
        checkProject()
        if (result.faces.length !== expected.faces || !result.faces.every(f => f.openSheet === expected.surface))
          throw new Error('Il CAD ricevuto non corrisponde al corpo selezionato nel progetto.')
      }
      setNotes([]); setPlacingNote(false); setNoteError(''); loaded.current = { step, name: fileName }; setLoadId(i => i + 1); setValidNet(null)
      setSymmetry(false); freeBoundaryRef.current = false; setFreeBoundary(false); setNet(null); base.current = null; history.current = []; at.current = -1; setSelected([]); locksRef.current = []; setLocks([]); setFace(-1)
      setFaces(result.faces); setPreview(result.preview); setName(fileName.replace(/\.(step|stp)$/i, '') + '-edit.step')
    } catch (e) {
      // Opening a STEP replaces the worker's document even if its validation
      // fails. Do not restore a frame from the previous worker document.
      loaded.current = null; setFaces([]); setPreview(null); setNet(null)
      base.current = null; history.current = []; at.current = -1; setSelected([])
      locksRef.current = []; setLocks([]); freeBoundaryRef.current = false; setFreeBoundary(false)
      continuityRef.current = 'G1'; setContinuity('G1'); historyTick(v => v + 1)
      setFace(-1); setValidNet(null); setError((e as Error).message)
    } finally { setBusy(false) }
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
        })
        return
      }
      try {
        const result = bodyStepResult(await runCommand('reverse.export.step', { bodies: [body.id] }))
        await load(new TextDecoder().decode(result.file.bytes), result.file.name, { faces: body.faces, surface: !!body.surface })
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
        await load(step,sourceImport.file.name,{ faces: body.faces, surface: true })
      }
    }
    catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const chooseFace = async (index: number) => {
    if (faces[index]?.reason) { setError(faces[index].reason!); return }
    invalidatePreview(); setBusy(true); setError('')
    try { const n = await ask<Net>({ action: 'select', face: index }); base.current = structuredClone(n); setFace(index); history.current = []; at.current = -1; setSelected([]); commit(n, { locks: [], freeBoundary: false }) }
    catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const locked = net ? net.poles.flatMap((_, i) => (!freeBoundary && boundaryLocked(net, i, continuity)) || faces[face]?.trimLocks.includes(i) || locks.includes(i) ? [i] : []) : []
  const editable = selected.filter(i => !locked.includes(i))
  const moveDirection = net && editable.length ? dragDirection(net, editable[0], dragMode, axis) : null
  const axisNames = dragMode === 'local' ? ['U', 'V', 'N'] : ['X', 'Y', 'Z']
  const committed = history.current[at.current]?.net
  const partners = useMemo(() => symmetry && committed ? mirrorPartners(committed.poles, mirrorAxis, mirrorOffset) : null, [committed, symmetry, mirrorAxis, mirrorOffset])
  const changePoles = (poles: Point[], final: boolean) => {
    if (!committed) return
    try {
      const changed = { ...committed, poles: partners ? mirrorEdit(committed.poles, poles, partners, mirrorAxis, mirrorOffset, locked) : poles }
      if (final) commit(changed); else setNet(changed)
    } catch (e) { setNet(committed); setError((e as Error).message) }
  }
  const transform = (fn: (p: Point, i: number, n: Net) => Point) => {
    if (!net) return
    const n = structuredClone(net); editable.forEach(i => { n.poles[i] = fn(net.poles[i], i, net) }); changePoles(n.poles, true)
  }
  const flatten = () => {
    if (!base.current) return
    const n = base.current, a = n.poles[0], u = n.poles[(n.nu - 1) * n.nv].map((x, i) => x - a[i]), v = n.poles[n.nv - 1].map((x, i) => x - a[i])
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
      const pin = await ask<Pin>({action:'notePick',point,previewRevision:revision})
      const id = nextNote.current++
      setNotes(prev=>[...prev,{...pin,id,text:'',revision}])
      setNoteError(''); setPlacingNote(false)
    } catch(e) { setNoteError((e as Error).message) }
    finally { if (mounted.current) setBusy(false) }
  }
  const notesRef = useRef(notes); notesRef.current = notes
  useEffect(() => {
    const revision=preview?.previewRevision
    if (!revision || net !== validNet) return
    let active=true
    const pending=notesRef.current.filter(n=>n.revision!==revision)
    if (pending.length) void Promise.all(pending.map(async n=>({
      id:n.id,...await ask<{at:Point;normal:Point}>({action:'noteResolve',anchor:n.anchor,previewRevision:revision})
    }))).then(pins=>{
      if (active) setNotes(prev=>prev.map(n=>{
        const pin=pins.find(p=>p.id===n.id)
        return pin ? {...n,...pin,revision} : n
      }))
    }).catch(e=>{if(active)setNoteError(e.message)})
    return ()=>{active=false}
  },[preview,validNet,net])
  const beginStrip=async()=>{
    if(!preview?.previewRevision || notes.length || busy || calculating)return
    setBusy(true)
    try {
      const paths=await ask<Point[][]>({action:'sheetEdges',previewRevision:preview.previewRevision})
      setPlacingNote(false);stripHistory.current=[null];stripAt.current=0
      setStripEdge(-1);setStripDelta([0,0,0]);setStripResult(null);setStripPaths(paths);setError('')
    } catch(e){setError((e as Error).message)} finally{setBusy(false)}
  }
  const changeStrip=async(edge:number,delta:Point,final:boolean)=>{
    setStripEdge(edge);setStripDelta(delta);setError('')
    if(edge<0 || (final && Math.hypot(...delta)<1e-7)){stripUndo(0);return}
    if(!final || !preview?.previewRevision)return
    setBusy(true)
    try {
      const result=await ask<StripState>({action:'duplicateSheetEdge',edge,delta,path:(stripResult?.paths??stripPaths)?.[edge],previous:stripResult?.moves,previewRevision:preview.previewRevision})
      const states=stripHistory.current.slice(0,stripAt.current+1)
      states.push(result)
      if(states.length>12)states.splice(1,1)
      stripHistory.current=states;stripAt.current=states.length-1
      setStripEdge(-1);setStripDelta([0,0,0]);setStripResult(result)
    } catch(e){stripUndo(0);setError((e as Error).message)} finally{setBusy(false)}
  }
  const checkProject = () => {
        const r = useReverse.getState(), m = useStore.getState(), s = source.current
        if (r.buildVersion !== s.version || r.features !== s.features || r.rolledBack !== s.rolledBack || r.stepFiles !== s.stepFiles || r.parameters !== s.parameters || m.fileName !== s.file || m.appliedAlignment !== s.alignment || reEditorOpen(r) || r.building) throw new Error('Il progetto è cambiato. Esporta il risultato STEP e riaprilo nel progetto aggiornato.')
  }
  const stripName=name.replace(/\.step$/i,'-striscia.step')
  const applyStrip = async () => {
    if (!stripPaths || !stripResult || stripEdge>=0 || busy || notes.length) return
    setBusy(true); setError('')
    try {
      checkProject()
      await runCommand('reverse.import.step',{bytes:new TextEncoder().encode(stripResult.step),name:stripName})
      close()
    } catch(e){setError((e as Error).message)}
    finally{if(mounted.current)setBusy(false)}
  }
  const finish = async (importBody: boolean) => {
    if (!net || busy || calculating || validNet !== net) return
    setBusy(true); setError('')
    try {
      const result = await ask<Preview & { step: string; previewRevision:number }>({ action: 'evaluate', net, continuity, freeBoundary, exportStep: true })
      if (importBody) {
        checkProject()
        setPreview(result)
        if (notes.length) {
          if (!applyWithNotes || notes.some(n=>!n.text.trim())) throw new Error('Completa le note prima di applicare.')
          const finalNotes=await Promise.all(notes.map(async n=>({
            draftId:String(n.id),anchor:n.anchor,text:n.text.trim(),u:n.anchor.u,v:n.anchor.v,
            ...await ask<{at:Point;normal:Point}>({action:'noteResolve',anchor:n.anchor,previewRevision:result.previewRevision})
          })))
          const witness=await ask<Omit<SurfaceNoteCommit['final'],'editorSessionId'>>({action:'finalFaceWitness',previewRevision:result.previewRevision})
          await applyWithNotes({step:result.step,name,faceIndex:face,final:{...witness,editorSessionId},notes:finalNotes})
        } else await runCommand('reverse.import.step', { bytes: new TextEncoder().encode(result.step), name })
        close()
      } else { setPreview(result); saveFile(name, new Blob([result.step], { type: 'model/step' })) }
    } catch (e) { setError((e as Error).message) } finally { if (mounted.current) setBusy(false) }
  }
  return <div className="modalback es-back"><div role="dialog" aria-modal="true" aria-label="Edit Surface" className="es-dialog" data-test="edit-surface-dialog" onKeyDown={e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); e.stopPropagation(); if (!busy) undo(e.shiftKey ? 1 : -1) }
    if (e.key === 'Escape') { e.stopPropagation(); if (!busy) cancel() }
  }}>
    <header><strong>Edit Surface · prototipo CAD</strong><button disabled={busy} onClick={cancel} aria-label="Chiudi Edit Surface">×</button></header>
    <div className="es-content"><aside>
      {!net && <><label>Corpo CAD<select data-test="surface-body" value={bodyId} disabled={busy} onChange={e => setBodyId(Number(e.target.value))}>{re.bodies.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        <button data-test="surface-load-body" disabled={busy || !re.bodies.some(b => b.id === bodyId)} onClick={() => void loadBody()}>Carica corpo</button>
        <label>Oppure apri STEP<input type="file" accept=".step,.stp" disabled={busy} data-test="surface-step-file" onChange={e => { const f = e.target.files?.[0]; if (f) void f.text().then(text => load(text, f.name)) }} /></label>
        <p>Seleziona una faccia nel modello o nell’elenco.</p>
        <select aria-label="Faccia CAD" data-test="surface-face" value={face} disabled={busy || !faces.length} onChange={e => void chooseFace(Number(e.target.value))}><option value={-1}>Scegli faccia…</option>{faces.map(f => <option key={f.index} value={f.index} disabled={!!f.reason}>Faccia {f.index + 1} · {f.kind}{f.reason ? ' · non supportata' : ''}</option>)}</select>
        {faces.some(f => f.reason) && <details><summary>Facce non supportate</summary>{faces.filter(f => f.reason).map(f => <p key={f.index}>#{f.index + 1}: {f.reason}</p>)}</details>}
      </>}
      {stripPaths && <><h3>Duplica bordo libero</h3><p>Scegli la direzione e trascina un bordo evidenziato. Dopo la cucitura puoi trascinare un altro bordo libero.</p>
        <div className="es-row">{['X','Y','Z'].map((label,i)=><button key={label} disabled={busy} data-test={'strip-axis-'+i} aria-pressed={axis===i} onClick={()=>setAxis(i)}>{label}</button>)}</div>
        <p data-test="strip-result">{stripEdge>=0?'Anteprima striscia':stripResult?'Striscia valida · '+stripResult.addedArea.toFixed(3)+' mm²': 'Trascina il bordo esterno'}</p>
        <div className="es-row"><button data-test="strip-undo" disabled={busy || stripAt.current===0} onClick={()=>stripUndo(-1)}>Annulla striscia</button>
          <button data-test="strip-redo" disabled={busy || stripAt.current+1>=stripHistory.current.length} onClick={()=>stripUndo(1)}>Ripeti striscia</button></div>
        <button data-test="strip-export" disabled={busy || stripEdge>=0 || !stripResult} onClick={()=>{if(stripResult)saveFile(stripName,new Blob([stripResult.step],{type:'model/step'}))}}>Esporta superficie con striscia</button>
        <button disabled={busy} onClick={()=>{setStripPaths(null);setStripResult(null);setError('')}}>Torna alla faccia iniziale</button></>}
      {net && !stripPaths && <>
        <p><strong>Faccia {face + 1} · {net.nu} × {net.nv} punti</strong><br/>{faces[face]?.converted ? 'Piano convertito esattamente in NURBS, senza fitting.' : 'Modifica diretta dei poli NURBS esistenti.'}</p>
        {!!faces[face]?.trimLocks.length && <p className="es-hint">I punti che influenzano i contorni ritagliati sono protetti. {faces[face]?.hiddenPoles.length ? 'I punti protetti esterni alla faccia sono nascosti. ' : ''}Trascina un punto libero per deformare la faccia.</p>}
        {faces[face]?.enriched && <p className="es-hint">Reticolo arricchito da 4×4 a 5×5 senza modificare la forma. Il punto centrale resta libero anche con protezione G1.</p>}
        <button disabled={busy || calculating} onClick={() => { if (loaded.current && window.confirm('Scartare questa bozza e scegliere un’altra faccia?')) void load(loaded.current.step, loaded.current.name) }}>Cambia faccia / corpo</button>
        {faces[face]?.openSheet && <button data-test="strip-open" disabled={busy || calculating || validNet!==net || !!notes.length} onClick={()=>void beginStrip()}>Duplica bordo libero…</button>}
        {faces[face]?.freeBoundary && <label><input data-test="surface-free-boundary" type="checkbox" checked={freeBoundary} disabled={busy || calculating} onChange={e => {
          if (!e.target.checked) {
            try { assertNet(base.current!, net, continuity) }
            catch { setError('Annulla prima gli spostamenti dei bordi per proteggerli di nuovo.'); return }
          }
          commit(net, { freeBoundary: e.target.checked })
        }}/> Consenti lo spostamento dei bordi liberi</label>}
        <label>Protezione bordi<select data-test="surface-continuity" value={continuity} disabled={busy || freeBoundary} onChange={e => { const c = e.target.value as 'G0' | 'G1'; try { assertNet(base.current!, net, c); commit(net, { continuity: c }) } catch { setError('Ripristina prima i punti vicini ai bordi per attivare G1.') } }}><option value="G0">G0 · mantieni posizione dei bordi</option><option value="G1">G1 · mantieni anche tangenti esistenti</option></select></label>
        <p className="es-hint">{freeBoundary ? 'Puoi spostare i punti del bordo della superficie aperta. I punti bloccati manualmente restano fermi.' : 'I bordi restano bloccati. G1 conserva le tangenti originali; non corregge discontinuità preesistenti.'}</p>
        <div className="es-row">{axisNames.map((a, i) => <button key={a} data-test={`surface-axis-${i}`} aria-pressed={axis === i} onClick={() => setAxis(i)}>{a}</button>)}</div>
        <label>Trascinamento punti<select data-test="surface-drag-mode" value={dragMode} onChange={e => setDragMode(e.target.value as DragMode)}><option value="axis">Mondo · asse X/Y/Z</option><option value="screen">Piano dello schermo</option><option value="local">Locale · U/V/normale</option></select></label>
        <label>Selezione reticolo<select data-test="surface-selection-mode" value={selectionMode} onChange={e => setSelectionMode(e.target.value as NetSelectionMode)}><option value="points">Punti</option><option value="edges">Segmenti del reticolo</option><option value="cells">Celle del reticolo</option><option value="mixed">Punti e segmenti</option></select></label>
        <p className="es-hint">Un segmento seleziona due poli; un clic dentro una cella ne seleziona quattro. Si modifica il reticolo della faccia CAD. Ctrl+clic aggiunge o toglie dalla selezione. I poli bloccati restano fermi. Nascondendo il reticolo, segmenti e celle non sono selezionabili.</p>
        <p>{dragMode === 'screen' ? 'Trascina liberamente sul piano dello schermo, mantenendo la profondità. La quota numerica usa X/Y/Z.' : dragMode === 'local' ? 'U segue la tangente della superficie; V è la tangente ortogonale, N la normale parametrica. Trascina la freccia gialla o imposta una quota.' : 'Trascina la freccia gialla lungo l’asse scelto.'} Trascina lo sfondo per ruotare. Lo stiramento usa sempre X/Y/Z.</p>
        {dragMode === 'local' && editable.length > 0 && !moveDirection && <p role="alert">Riferimento locale non definito in questo punto. Scegli un altro punto o il riferimento mondo.</p>}
        <label>Intensità trascinamento · {Math.round(dragStrength * 100)}%<input data-test="surface-drag-strength" type="range" min="0.05" max="1" step="0.05" value={dragStrength} onChange={e => setDragStrength(Number(e.target.value))} /></label>
        <p className="es-hint">Riduce lo spostamento durante il trascinamento per modifiche fini. Le quote numeriche restano esatte.</p>
        <fieldset><legend>Simmetria dei poli</legend>
          <label><input data-test="surface-symmetry" type="checkbox" checked={symmetry} onChange={e=>setSymmetry(e.target.checked)}/> Modifica anche il polo speculare</label>
          {symmetry && <><label>Piano<select data-test="surface-mirror-plane" value={mirrorAxis} onChange={e=>setMirrorAxis(Number(e.target.value))}><option value={0}>YZ</option><option value={1}>XZ</option><option value={2}>XY</option></select></label>
            <label>Posizione lungo {['X','Y','Z'][mirrorAxis]} (mm)<input data-test="surface-mirror-offset" type="number" step="any" defaultValue={mirrorOffset} onBlur={e=>{
              if(Number.isFinite(e.target.valueAsNumber))setMirrorOffset(e.target.valueAsNumber)
              else e.target.value=String(mirrorOffset)
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
            <small data-test="surface-note-position">{n.revision===preview?.previewRevision ? n.at.map((v,i)=>['X','Y','Z'][i]+' '+v.toFixed(3)).join(' · ')+' mm' : 'Aggiornamento posizione…'}</small>
            <button disabled={busy} onClick={()=>setNotes(prev=>prev.filter(item=>item.id!==n.id))}>Rimuovi nota {n.id}</button></div>)}
          {notes.length>0 && !applyWithNotes && <p>Note in bozza. Questa versione non salva ancora le note nel progetto. Rimuovile per applicare il corpo senza note.</p>}
          {noteError && <p role="alert">{noteError}</p>}
        </fieldset>}
        <label>Trasparenza superficie · {Math.round(transparency * 100)}%<input data-test="surface-transparency" type="range" min="0" max="0.9" step="0.05" value={transparency} onChange={e => setTransparency(Number(e.target.value))} /></label>
        <div className="es-row"><button onClick={() => setSelected(net.poles.flatMap((_, i) => locked.includes(i) ? [] : [i]))}>Seleziona liberi</button><button onClick={() => setSelected([])}>Nessuno</button></div>
        <p data-test="surface-selection">{selected.length} selezionati · {editable.length} modificabili</p>
        <div className="es-row"><button disabled={busy || !selected.length} onClick={() => commit(net, { locks: [...locks, ...selected] })}>Blocca punti</button><button disabled={busy || !selected.length} onClick={() => commit(net, { locks: locks.filter(i => !selected.includes(i)) })}>Sblocca punti</button></div>
        <label>Spostamento · mm<input type="number" step="0.1" value={distance} data-test="surface-distance" onChange={e => setDistance(Number(e.target.value))} /></label>
        <button data-test="surface-move" disabled={busy || !moveDirection || !Number.isFinite(distance)} onClick={() => { if (moveDirection) transform(p => p.map((x, i) => x + moveDirection[i] * distance) as Point) }}>Sposta lungo {axisNames[axis]}</button>
        <button disabled={busy || !editable.length} onClick={flatten}>Spiana sul piano dei tre angoli iniziali</button>
        <label>Intensità levigatura · {Math.round(smoothStrength * 100)}%<input data-test="surface-smooth-strength" type="range" min="0.05" max="1" step="0.05" value={smoothStrength} onChange={e => setSmoothStrength(Number(e.target.value))} /></label>
        <button data-test="surface-smooth" disabled={busy || !editable.length} onClick={() => transform((p, i, n) => { const row = Math.floor(i / n.nv), col = i % n.nv, neighbors = [row > 0 ? i - n.nv : -1, row + 1 < n.nu ? i + n.nv : -1, col > 0 ? i - 1 : -1, col + 1 < n.nv ? i + 1 : -1].filter(j => j >= 0); return p.map((x, d) => x * (1 - smoothStrength) + neighbors.reduce((s, j) => s + n.poles[j][d], 0) / neighbors.length * smoothStrength) as Point })}>Levigatura locale · {Math.round(smoothStrength * 100)}%</button>
        <label>Fattore stiramento<input type="number" step="0.1" min="0.1" max="3" value={factor} onChange={e => setFactor(Number(e.target.value))} /></label>
        <button disabled={busy || !editable.length || !Number.isFinite(factor) || factor <= 0 || factor > 3} onClick={() => { const center = net.poles.reduce((s, p) => s + p[axis], 0) / net.poles.length; transform(p => p.map((x, i) => i === axis ? center + (x - center) * factor : x) as Point) }}>Stira lungo {['X', 'Y', 'Z'][axis]}</button>
        <div className="es-row"><button data-test="surface-undo" disabled={busy || at.current <= 0} onClick={() => undo(-1)}>Annulla</button><button data-test="surface-redo" disabled={busy || at.current >= history.current.length - 1} onClick={() => undo(1)}>Ripeti</button><button disabled={busy} onClick={() => commit(structuredClone(base.current!))}>Ripristina</button></div>
      </>}
    </aside><main><SurfaceViewport mirrorAxis={mirrorAxis} mirrorOffset={mirrorOffset} mirrorPartners={partners} strip={stripPaths?{paths:stripResult?.paths??stripPaths,axis,edge:stripEdge,delta:stripDelta,change:changeStrip}:null} notePins={notes.filter(n=>n.revision===preview?.previewRevision).map(n=>n.at)} placingNote={placingNote} onNote={p=>void pickNote(p)} stripes={zebra ? stripes : null} key={loadId} preview={stripPaths && stripResult ? stripResult.preview : preview} net={stripPaths?null:net} selected={selected} locked={locked} hiddenPoles={faces[face]?.hiddenPoles ?? NO_HIDDEN_POLES} face={face} axis={axis} busy={busy} dragStrength={dragStrength} dragMode={dragMode} selectionMode={selectionMode} showNet={showNet} transparency={transparency} onFace={i => {if(!stripPaths)void chooseFace(i)}} onPoints={(ids, multi) => setSelected(s => selectNetPoints(s, ids, multi))} onDrag={changePoles} />
      <div className="es-status" role="status" data-test="surface-status" data-preview-revision={preview?.previewRevision} data-preview-volume={preview?.volume}>{stripPaths ? (busy?'Verifica cucitura…':error || (stripResult?('Superficie CAD valida · '+stripResult.preview.faceMeshes.length+' facce cucite'):'Trascina un bordo per creare la striscia.')) : busy ? 'Elaborazione CAD…' : calculating ? 'Aggiornamento e verifica CAD…' : error ? `${error}${preview ? ' Vista: ultimo risultato valido.' : ''}` : validNet && preview ? `CAD valido · ${faces[face]?.openSheet ? 'superficie aperta' : `volume ${preview.volume.toFixed(3)} mm³`} · ${freeBoundary ? 'spostamento bordo' : 'scarto bordo'} ${preview.maxBoundaryError.toExponential(1)} mm` : 'Apri un corpo STEP e scegli una faccia.'}</div>
    </main></div>
    <footer><span>{stripPaths?'Applica aggiunge la superficie cucita al progetto come nuovo corpo.':'Applica crea una copia CAD modificata. Originale conservato. La copia entra nella cronologia del progetto.'}</span><button disabled={!!stripPaths || busy || calculating || !net || validNet !== net} onClick={() => void finish(false)}>Esporta STEP…</button><button data-test="surface-apply" disabled={(!!stripPaths && (!stripResult || stripEdge>=0)) || (notes.length>0 && (!applyWithNotes || notes.some(n=>!n.text.trim()))) || busy || calculating || !net || validNet !== net} onClick={() => stripPaths ? void applyStrip() : void finish(true)}>{stripPaths ? 'Applica superficie cucita' : 'Applica come nuovo corpo'}</button><button disabled={busy} onClick={cancel}>Annulla</button></footer>
  </div></div>
}
