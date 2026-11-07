// SPDX-License-Identifier: AGPL-3.0-only
import { OcctKernel, type Mesh, type BoundingBox, type ShapeHandle } from 'occt-wasm'
import { assertNet, boundaryLocked, enrichBicubic, perforatedPlaneNet, planeNet, replaceSurface, signature, surfaceTable, type Net, type Point, type RecordSpan } from './brep'
import { readRecipe, readCurvedRecipe, sha256, encodeRecipePoint, decodeRecipePoint, type SurfaceEditRecipe, type SurfaceEditRecipeV5, type SurfaceEditRecipeV6, type SerializedPoleEdit } from './recipe'
import type { SurfacePlaneTangency, SurfaceCurvedTangency, SurfacePreparation } from './surfaceHistory'
import { refineClampedNet, type KnotInsertion } from './refineClampedNet'
import { readAdaptiveTrimRecipe, type AdaptiveTrimRecipe } from './adaptiveTrimRecipe'
import { adaptiveTrimPlan } from './adaptiveTrimPlan'
import { visiblePoleWitness } from './visiblePoleWitness'
import { readAdaptiveLockedRecipe, type AdaptiveLockedRecipe } from './adaptiveLockedRecipe'
import { validateAdaptiveLocks, type AdaptiveLocks } from './adaptiveLockSnapshot'

import { extendSheet, sheetEdgePaths, type StripMove } from './sheetExtension'
import { queryVisibleSheetEdge, type SheetEdgeVisibilityCandidate } from './sheetEdgeVisibilityCad'
import { rebuildFreeBoundary } from './freeBoundary'
import {queryBoundaryVisibilityCad,type BoundaryCadCandidate} from './boundaryVisibilityCad'
import { queryWholeFaceRayPickCad, type WholeFaceRayPickInput } from './wholeFaceRayPickCad'
import { prepareCylinder } from './cylinderPreparation'
import { assertSimpleCylinderSource } from './cylinderSource'
import { listG1SupportCandidates, resolveG1SupportCandidate as resolveSupport, type G1SourceStamp, type G1SupportCandidate } from './g1SupportTopology'
import { proposePlaneTangency, validatePlaneTangencyResult, validatePlaneTangencyConstraint, type NaturalEdge, type PlaneTangencyRequest, type PlaneTangencyValidation } from './planeTangency'
import { listCompatibleCurvedSupportCandidates, resolveCompatibleCurvedSupportCandidate, type CompatibleCurvedSupportCandidate, type ResolvedCompatibleCurvedSupport } from './compatibleCurvedSupportTopology'
import { proposeCompatibleCurvedTangency, validateCompatibleCurvedTangencyResult, type CompatibleCurvedTangencyRequest, type CompatibleCurvedTangencyValidation } from './compatibleCurvedTangency'

export interface FaceInfo { index: number; kind: string; reason: string | null; converted: boolean; enriched: boolean; openSheet: boolean; freeBoundary: boolean; canDuplicateCadFace?: boolean; trimLocks: number[]; hiddenPoles: number[]; experimentalCylinder?: boolean }
export interface G1SupportCandidates { stamp: G1SourceStamp; candidates: G1SupportCandidate[] }
export interface G1CurvedSupportCandidates { stamp: G1SourceStamp; candidates: CompatibleCurvedSupportCandidate[] }
export interface G1CurvedSupportGeometry {
  choice: CompatibleCurvedSupportCandidate
  previewRevision: number
  supportMesh: Mesh
  seam: [Point, Point]
}
export interface G1CurvedProposalRequest {
  net: Net
  choice: CompatibleCurvedSupportCandidate
  lockedPoles?: readonly number[]
  scale?: number
  distanceTolerance?: number
  derivativeTolerance?: number
  exportStep?: boolean
}
export interface G1CurvedValidationRequest extends G1CurvedProposalRequest { baseNet: Net }
export interface G1CurvedResult {
  net: Net
  changedIndices: number[]
  choice: CompatibleCurvedSupportCandidate
  stamp: G1SourceStamp
  revisions: { edit: number; preview: number; anchorSelection: number }
  validation: CompatibleCurvedTangencyValidation
  /** Isolated result: deliberately has no interactive previewRevision. */
  preview: Preview
  step?: string
}
export interface G1PublishedCurvedResult extends Omit<G1CurvedResult, 'preview'> {
  constraintId: number
  constraintKind: 'compatible-bspline'
  preview: Preview & { previewRevision: number }
}
export interface G1CurvedEvaluationRequest {
  constraintId: number
  net: Net
  lockedPoles?: readonly number[]
  exportStep?: boolean
}
interface RegisteredCurvedTangency {
  kind: 'compatible-bspline'
  request: G1CurvedValidationRequest
  referenceNet: Net
  supportNet: Net
}
export interface DraftAnchor { face: number; selectionRevision: number; u: number; v: number }
export interface Preview { previewRevision?: number; mesh: Mesh; faceMeshes: Mesh[]; valid: boolean; volume: number; maxBoundaryError: number; minimumNormalDot: number }
export interface G1PlaneProposalRequest {
  net: Net
  choice: G1SupportCandidate
  lockedPoles?: readonly number[]
  distanceTolerance?: number
  exportStep?: boolean
}
export interface G1PlaneValidationRequest extends G1PlaneProposalRequest { baseNet: Net }
export interface G1PlaneResult {
  net: Net
  changedIndices: number[]
  choice: G1SupportCandidate
  stamp: G1SourceStamp
  /** These identify the untouched interactive state, not a published preview. */
  revisions: { edit: number; preview: number; anchorSelection: number }
  validation: PlaneTangencyValidation
  preview: Preview
  step?: string
}
export interface G1PublishedPlaneResult extends Omit<G1PlaneResult, 'preview'> {
  constraintId: number
  preview: Preview & { previewRevision: number }
}
export interface G1PlaneEvaluationRequest {
  constraintId: number
  net: Net
  lockedPoles?: readonly number[]
  exportStep?: boolean
}
interface RegisteredPlaneTangency {
  request: G1PlaneValidationRequest
  referenceNet: Net
}
export interface RecipeRestoreResult {
  faces: FaceInfo[]
  net: Net
  preview: Preview & { previewRevision: number; step?: string }
  continuity: 'G0' | 'G1'
  freeBoundary: boolean
  lockedPoles: number[]
  lockSnapshots?: AdaptiveLocks
  preparation: SurfacePreparation
  planeTangency?: SurfacePlaneTangency
  curvedTangency?: SurfaceCurvedTangency
}
export interface CurvedRecipeRestoreResult extends RecipeRestoreResult { curvedTangency: SurfaceCurvedTangency; planeTangency?: never }
const tuple = (p: { x: number; y: number; z: number }): Point => [p.x, p.y, p.z]
const dist = (a: Point, b: Point) => Math.hypot(...a.map((x, i) => x - b[i]))
/** Return a finite unit normal with the topological face orientation applied. */
export function orientedSurfaceNormal(kernel: OcctKernel, face: ShapeHandle, u: number, v: number): Point {
  const raw = tuple(kernel.surfaceNormal(face, u, v))
  if (!raw.every(Number.isFinite)) throw new Error('Normale della faccia non valida.')
  const orientation = kernel.shapeOrientation(face)
  if (orientation !== 'forward' && orientation !== 'reversed')
    throw new Error('Orientamento della faccia non supportato.')
  const length = Math.hypot(...raw)
  if (!Number.isFinite(length) || length <= 1e-12)
    throw new Error('Normale della faccia non determinata.')
  // OCCT surfaceNormal(handle, ...) evaluates the face's oriented normal;
  // multiplying by shapeOrientation here would reverse it a second time.
  const normal: Point = [raw[0] / length, raw[1] / length, raw[2] / length]
  if (!normal.every(Number.isFinite)) throw new Error('Normale della faccia non valida.')
  return normal
}
// On each nonempty knot span a positive-weight NURBS lies inside the
// convex hull of the active poles. A disjoint world-space box rules out
// contact with a trim even where the surface folds in parameter space.
function lockCurvedTrim(net: Net, box: BoundingBox, locked: Set<number>) {
  const expanded = (knots: number[], counts: number[]) =>
    knots.flatMap((value, i) => Array<number>(counts[i]).fill(value))
  const us = expanded(net.ku, net.mu), vs = expanded(net.kv, net.mv)
  let touchesTrim = false
  const padding = 1e-6
  for (let u = net.du; u < net.nu; u++) {
    if (us[u] === us[u+1]) continue
    for (let v = net.dv; v < net.nv; v++) {
      if (vs[v] === vs[v+1]) continue
      const active: number[] = []
      const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity]
      for (let i = u-net.du; i <= u; i++) for (let j = v-net.dv; j <= v; j++) {
        const id = i*net.nv+j, pole = net.poles[id]
        active.push(id)
        for (let d=0; d<3; d++) {
          min[d] = Math.min(min[d],pole[d])
          max[d] = Math.max(max[d],pole[d])
        }
      }
      if (min[0] > box.xmax+padding || max[0] < box.xmin-padding ||
          min[1] > box.ymax+padding || max[1] < box.ymin-padding ||
          min[2] > box.zmax+padding || max[2] < box.zmin-padding) continue
      touchesTrim = true
      for (const id of active) locked.add(id)
    }
  }
  if (!touchesTrim) throw new Error('Il contorno non ricade nel reticolo: modifica non disponibile.')
}
// On a circular arc shorter than pi, sagitta bounds the displacement from
// its chord. These enclosing boxes protect the rim without locking the disk.
function outerEdgeBoxes(k: OcctKernel, edge: ShapeHandle, fine = false): BoundingBox[] {
  if (k.curveType(edge) !== 'circle') return [k.getBoundingBox(edge,{useTriangulation:false})]
  const {first,last} = k.curveParameters(edge)
  const count = Math.max(1,Math.ceil(Math.abs(last-first)/(fine ? Math.PI/48 : Math.PI/12)))
  return Array.from({length:count}, (_,i) => {
    const t0 = first+(last-first)*i/count, t1 = first+(last-first)*(i+1)/count
    const a = k.curvePointAtParam(edge,t0), b = k.curvePointAtParam(edge,t1)
    const mid = k.curvePointAtParam(edge,(t0+t1)/2)
    const margin = Math.hypot(mid.x-(a.x+b.x)/2, mid.y-(a.y+b.y)/2, mid.z-(a.z+b.z)/2)+1e-7
    return { xmin:Math.min(a.x,b.x)-margin, xmax:Math.max(a.x,b.x)+margin,
      ymin:Math.min(a.y,b.y)-margin, ymax:Math.max(a.y,b.y)+margin,
      zmin:Math.min(a.z,b.z)-margin, zmax:Math.max(a.z,b.z)+margin }
  })
}
export class SurfaceEditorKernel {
  private source: ShapeHandle | null = null
  private g1SourceRevision = 0
  private g1SelectionRevision = 0
  private g1Selected = -1
  private g1Fingerprint: Promise<string> | null = null
  private g1SourceReady = false
  private g1ConstraintSerial = 0
  private readonly g1Constraints = new Map<number, RegisteredPlaneTangency>()
  private readonly g1CurvedConstraints = new Map<number, RegisteredCurvedTangency>()
  private faces: ShapeHandle[] = []
  private brep = ''
  private records: RecordSpan[] = []
  private recordsByFace: number[] = []
  private chosen = -1
  private originalNet: Net | null = null
  private refinements: KnotInsertion[] = []
  private adaptiveSelection = false
  private editBrep = ''
  private editRecord: RecordSpan | null = null
  private solids = 0
  private revision = 0
  // Anchor identity follows the logical source/face selection, not net preparation.
  private anchorSelectionRevision = 0
  private previewRevision = 0
  private validatedFace: ShapeHandle | null = null
  private validatedSheetBrep: string | null = null
  infos: FaceInfo[] = []
  /** Injected kernels are borrowed; load() creates an editor-owned runtime. */
  constructor(readonly kernel: OcctKernel, private readonly ownsKernel = false) {}
  static async load(wasm?: string) { return new SurfaceEditorKernel(await OcctKernel.init(wasm ? { wasm } : undefined), true) }
  private count(s: ShapeHandle, type: 'solid' | 'shell' | 'face') { const a = this.kernel.getSubShapes(s, type); const n = a.length; a.forEach(h => this.kernel.release(h)); return n }
  /** Experimental cylinder path. Only the worker retains the returned BREP. */
  prepareCylinderForPreview(face:number) {
    if(!this.source) throw new Error('Apri prima un corpo CAD.')
    const prepared=prepareCylinder(this.kernel,this.source,face)
    this.invalidateG1Selection()
    return prepared
  }
  open(step: string) {
    this.clear()
    const k = this.kernel
    this.source = k.importStep(step)
    if (!k.isValid(this.source)) throw new Error('Il CAD di origine non è valido; modifica non avviata.')
    this.solids = this.count(this.source, 'solid')
    if (this.solids > 1) throw new Error('Scegli un solo corpo CAD.')
    this.brep = k.toBREP(this.source) // capture BEFORE tessellation: no stale triangulations
    this.records = surfaceTable(this.brep)
    this.faces = k.getSubShapes(this.source, 'face')
    this.recordsByFace = this.faces.map(face => {
      const text = k.toBREP(face), own = surfaceTable(text)
      // A single face BREP also lists surfaces referenced by its edge pcurves.
      // Read the actual Fa header rather than assuming one surface per file.
      const headers = [...text.matchAll(/^Fa\s*\n\s*([01])\s+([\deE+.-]+)\s+(\d+)\s+(\d+)\s*$/gm)]
      if (headers.length !== 1 || Number(headers[0][4]) !== 0) return -1
      const record = own[Number(headers[0][3]) - 1]
      if (!record) return -1
      const ids = this.records.flatMap((r, i) => signature(r) === signature(record) ? [i] : [])
      return ids.length === 1 ? ids[0] : -1
    })
    const sourceKind=k.getShapeType(this.source)
    const openSheet=this.solids===0 && (sourceKind==='face' || sourceKind==='shell')
    this.infos = this.faces.map((face, index) => {
      let reason: string | null = null
      let trimLocks: number[] = [], hiddenPoles: number[] = []
      let natural = false
      try { const info = this.netFor(index); trimLocks = info.trimLocks; hiddenPoles = info.hiddenPoles; natural = info.natural } catch (e) { reason = e instanceof Error ? e.message : String(e) }
      const record = this.records[this.recordsByFace[index]]
      let experimentalCylinder=false
      if(reason && k.surfaceType(face)==='cylinder') {
        try {assertSimpleCylinderSource(k,this.source!,face);experimentalCylinder=true} catch { /* Full preparation remains the final gate. */ }
      }
      return { index, trimLocks, hiddenPoles, openSheet, canDuplicateCadFace: this.solids === 1 && natural,
        freeBoundary: openSheet && this.faces.length === 1 && natural, kind: k.surfaceType(face), reason, converted: record?.kind === 1,
        enriched: !!record?.net && enrichBicubic(record.net) !== record.net, experimentalCylinder }
    })
    const preview = this.render(this.source)
    this.g1SourceReady = true
    return { faces: this.infos, preview }
  }
  private netFor(index: number, refinements: readonly KnotInsertion[] = [], fineTrim = false) {
    const face = this.faces[index], id = this.recordsByFace[index], r = this.records[id], k = this.kernel
    if (!face || !r) throw new Error('Superficie ambigua o condivisa: non modificabile.')
    if (this.recordsByFace.filter(n => n === id).length !== 1) throw new Error('Superficie condivisa da più facce.')
    if (r.kind !== 1 && !r.net) throw new Error('Prototipo: solo piani e B-spline non periodiche.')
    const wires = k.getSubShapes(face, 'wire'), outer = k.outerWire(face), edges = k.getSubShapes(outer, 'edge')
    try {
      const inner = wires.filter(w => !k.isSame(w, outer))
      if (!edges.length) throw new Error('Contorno esterno privo di bordi.')
      if (fineTrim && (r.kind !== 1 || inner.length !== 1 || edges.some(edge => k.curveType(edge) !== 'circle')))
        throw new Error('Politica adattiva disponibile solo per piani con un foro e contorno esterno circolare.')
      const b = k.uvBounds(face), bounds: [number, number, number, number] = [b.uMin, b.uMax, b.vMin, b.vMax]
      if (bounds.some(x => !Number.isFinite(x)) || b.uMax <= b.uMin || b.vMax <= b.vMin) throw new Error('Dominio della faccia non valido.')
      const epsU = 1e-7 * Math.max(1, b.uMax - b.uMin), epsV = 1e-7 * Math.max(1, b.vMax - b.vMin)
      const support = r.net
      if (support && (b.uMin < support.ku[0]-epsU || b.uMax > support.ku.at(-1)!+epsU ||
          b.vMin < support.kv[0]-epsV || b.vMax > support.kv.at(-1)!+epsV))
        throw new Error('Il trim supera il dominio NURBS.')
      // A STEP face may occupy only a subset of its clamped support surface.
      // Its visible rim is then an interior curve of that support, so protect
      // every pole whose span can influence it instead of locking only the
      // outermost rows of the full control net.
      const partial = !!support && (Math.abs(support.ku[0]-b.uMin)>epsU || Math.abs(support.ku.at(-1)!-b.uMax)>epsU ||
        Math.abs(support.kv[0]-b.vMin)>epsV || Math.abs(support.kv.at(-1)!-b.vMax)>epsV)
      // Recognize the natural rectangular domain to retain its original net and recipe.
      const sides = edges.map(edge => {
        const { first, last } = k.curveParameters(edge)
        let candidates = [true, true, true, true]
        for (let n = 0; n <= 16; n++) {
          const uv = k.uvFromPoint(face, k.curvePointAtParam(edge, first + (last - first) * n / 16))
          const ds = [Math.abs(uv.u - b.uMin) / epsU, Math.abs(uv.u - b.uMax) / epsU, Math.abs(uv.v - b.vMin) / epsV, Math.abs(uv.v - b.vMax) / epsV]
          candidates = candidates.map((yes, i) => yes && ds[i] <= 1)
        }
        return candidates.findIndex(Boolean)
      })
      const rectangular = sides.length === 4 && !sides.includes(-1) && new Set(sides).size === 4
      const trimBoxes = inner.map(w => k.getBoundingBox(w,{useTriangulation:false}))
      if (!rectangular || partial) for (const edge of edges) trimBoxes.push(...outerEdgeBoxes(k,edge,fineTrim))

      const initialNet = r.kind === 1
        ? (trimBoxes.length ? perforatedPlaneNet(r, bounds) : planeNet(r, bounds))
        : enrichBicubic(structuredClone(r.net!))
      const net = refinements.length ? refineClampedNet(initialNet, refinements) : initialNet
      if (net.mu[0] !== net.du + 1 || net.mu.at(-1) !== net.du + 1 || net.mv[0] !== net.dv + 1 || net.mv.at(-1) !== net.dv + 1) throw new Error('Servono nodi estremi clamped.')
      if (net.nu * net.nv > 1600) throw new Error('Reticolo oltre 1600 punti: non interattivo in questo prototipo.')
      const trimLocks = new Set<number>()
      if (trimBoxes.length) {
        const expanded = (k: number[], m: number[]) => k.flatMap((x, i) => Array(m[i]).fill(x) as number[])
        const us = expanded(net.ku, net.mu), vs = expanded(net.kv, net.mv)
        for (const box of trimBoxes) {
          if (!Object.values(box).every(Number.isFinite)) throw new Error('Limite del contorno non determinato.')
          if (r.kind !== 1) {
            lockCurvedTrim(net, box, trimLocks)
            continue
          }
          // A linear plane projection reaches its extrema at box corners.
          const uv = [box.xmin,box.xmax].flatMap(x => [box.ymin,box.ymax].flatMap(y =>
            [box.zmin,box.zmax].map(z => k.uvFromPoint(face,{x,y,z}))))
          if (uv.some(q => !Number.isFinite(q.u) || !Number.isFinite(q.v))) throw new Error('Limite del contorno non determinato.')
          const loU = Math.min(...uv.map(q=>q.u))-epsU, hiU = Math.max(...uv.map(q=>q.u))+epsU
          const loV = Math.min(...uv.map(q=>q.v))-epsV, hiV = Math.max(...uv.map(q=>q.v))+epsV
          for (let u=0; u<net.nu; u++) for (let v=0; v<net.nv; v++)
            if (us[u]<=hiU && us[u+net.du+1]>=loU && vs[v]<=hiV && vs[v+net.dv+1]>=loV) trimLocks.add(u*net.nv+v)
        }
      }
      if (trimBoxes.length && trimLocks.size === net.poles.length) throw new Error('Tutti i poli influenzano un contorno ritagliato.')
      const hiddenPoles: number[] = []
      if (partial) {
        const expand = (knots:number[], mult:number[]) => knots.flatMap((x,i)=>Array<number>(mult[i]).fill(x))
        const us=expand(net.ku,net.mu), vs=expand(net.kv,net.mv)
        const greville=(knots:number[],degree:number,i:number)=>knots.slice(i+1,i+degree+1).reduce((sum,x)=>sum+x,0)/degree
        for(let u=0;u<net.nu;u++) for(let v=0;v<net.nv;v++) {
          const id=u*net.nv+v, gu=greville(us,net.du,u), gv=greville(vs,net.dv,v)
          // Greville outside the trim is not proof of zero influence: hide
          // only poles already protected even under the less restrictive G0.
          if ((gu<b.uMin-epsU || gu>b.uMax+epsU || gv<b.vMin-epsV || gv>b.vMax+epsV) &&
              (trimLocks.has(id) || boundaryLocked(net,id,'G0'))) hiddenPoles.push(id)
        }
      }
      return {net, trimLocks: [...trimLocks], hiddenPoles, natural: rectangular && inner.length === 0 && !partial}
    } finally { [outer, ...wires, ...edges].forEach(h => k.release(h)) }
  }
  private checkPlanarTrims(before: ShapeHandle, after: ShapeHandle, operation = 'Conversione piana') {
    const k = this.kernel
    const traces = (face: ShapeHandle) => {
      const outer = k.outerWire(face), wires = k.getSubShapes(face, 'wire')
      try {
        return wires.map(wire => {
          const edges = k.getSubShapes(wire, 'edge')
          try {
            return { outer: k.isSame(wire,outer), edges: edges.map(edge => {
              const {first,last} = k.curveParameters(edge)
              return Array.from({length:33}, (_,i) => tuple(k.curvePointAtParam(edge,first+(last-first)*i/32)))
            }) }
          } finally { edges.forEach(h => k.release(h)) }
        })
      } finally { wires.forEach(h => k.release(h)); k.release(outer) }
    }
    const originals = traces(before), pending = traces(after)
    for (const wire of originals) {
      const match = pending.findIndex(candidate => {
        if (wire.outer !== candidate.outer || wire.edges.length !== candidate.edges.length) return false
        const edges = [...candidate.edges]
        for (const line of wire.edges) {
          const idx = edges.findIndex(trace =>
            line.every((p,i) => dist(p,trace[i])<=1e-7) ||
            line.every((p,i) => dist(p,trace[trace.length-1-i])<=1e-7))
          if (idx < 0) return false
          edges.splice(idx,1)
        }
        return true
      })
      if (match < 0) throw new Error(operation + ': contorno alterato.')
      pending.splice(match,1)
    }
    if (pending.length) throw new Error(operation + ': contorno aggiunto.')
  }
  private checkPreparedArea(original: ShapeHandle, prepared: ShapeHandle, trimmed: boolean) {
    const k = this.kernel, area = k.getSurfaceArea(original)
    const delta = Math.abs(k.getSurfaceArea(prepared) - area)
    if (!Number.isFinite(delta)) throw new Error('Conversione piana: area non determinata.')
    if (trimmed) this.checkPlanarTrims(original,prepared)
    if (delta <= (trimmed ? Math.max(1e-6,area*1e-6) : 1e-6)) return
    // The integration rule on a trimmed spline can differ from the analytic
    // plane. For small discrepancies, measure its 3D wire on the source plane.
    if (!trimmed || delta > area*1e-5) throw new Error('Conversione piana: area alterata.')
    const wires = k.getSubShapes(prepared,'wire')
    try {
      if (wires.length !== 1) throw new Error('Conversione piana: area alterata.')
      const planarFace = k.makeFaceOnSurface(original,wires[0])
      try {
        const rimArea = k.getSurfaceArea(planarFace)
        if (k.surfaceType(planarFace) !== 'plane' || !k.isValid(planarFace) ||
            !Number.isFinite(rimArea) || Math.abs(rimArea-area)>1e-6)
          throw new Error('Conversione piana: area delimitata dal bordo alterata.')
      } finally { k.release(planarFace) }
    } finally { wires.forEach(w=>k.release(w)) }
    const b = k.uvBounds(original)
    for (let i=0;i<12;i++) for (let j=0;j<12;j++) {
      const u=b.uMin+(b.uMax-b.uMin)*(i+.5)/12, v=b.vMin+(b.vMax-b.vMin)*(j+.5)/12
      if (k.classifyPointOnFace(prepared,u,v)!==k.classifyPointOnFace(original,u,v))
        throw new Error('Conversione piana: dominio interno alterato.')
    }
  }
  select(index: number, refinements: readonly KnotInsertion[] = []) {
    return this.prepareSelection(index, refinements, false)
  }
  /** Prepare a protected trimmed plane without moving its boundary. The
   * fallback is deliberately limited to the all-trim-locked plane case. */
  selectDenseTrimmedPlane(index: number) {
    const face=this.faces[index], info=this.infos[index]
    if (!face || info?.kind !== 'plane' || info.reason !== 'Tutti i poli influenzano un contorno ritagliato.')
      throw new Error('Raffinamento automatico non disponibile per questa faccia.')
    const b=this.kernel.uvBounds(face), plan:KnotInsertion[]=[]
    for (const axis of ['U','V'] as const) {
      const min=axis==='U'?b.uMin:b.vMin, max=axis==='U'?b.uMax:b.vMax
      if (!Number.isFinite(min)||!Number.isFinite(max)||!(max>min)) throw new Error('Dominio della faccia non valido.')
      for(let i=1;i<32;i++) if(i%4!==0) plan.push({axis,value:min+(max-min)*i/32,count:1})
    }
    // Refuse before changing the active selection if no editable point is
    // available under the stricter G1 boundary and trim protections.
    const candidate=this.netFor(index,plan), locks=new Set([...candidate.trimLocks,...candidate.hiddenPoles])
    if(!candidate.net.poles.some((_,i)=>!locks.has(i)&&!boundaryLocked(candidate.net,i,'G1')))
      throw new Error('Nessun punto libero dopo il raffinamento: i contorni restano protetti.')
    const net=this.select(index,plan), selected=this.infos[index]
    return {net,refinements:plan,trimLocks:selected.trimLocks,hiddenPoles:selected.hiddenPoles}
  }
  /** Research-only candidate. No worker/UI exposes this until qualification. */
  selectAdaptiveExperimental(index: number) {
    const k=this.kernel, face=this.faces[index], info=this.infos[index]
    if (!face || info?.kind !== 'plane') throw new Error('La preparazione adattiva richiede un piano CAD.')
    const wires=k.getSubShapes(face,'wire')
    let outer:ShapeHandle|undefined
    let plan:KnotInsertion[]
    try {
      const outerWire=k.outerWire(face); outer=outerWire
      const inner=wires.filter(w=>!k.isSame(w,outerWire))
      if(inner.length!==1) throw new Error('La preparazione adattiva richiede un solo contorno interno.')
      const box=k.getBoundingBox(inner[0],{useTriangulation:false}), b=k.uvBounds(face)
      const uv=[box.xmin,box.xmax].flatMap(x=>[box.ymin,box.ymax].flatMap(y=>[box.zmin,box.zmax].map(z=>k.uvFromPoint(face,{x,y,z}))))
      plan=adaptiveTrimPlan([b.uMin,b.uMax,b.vMin,b.vMax],
        [Math.min(...uv.map(q=>q.u)),Math.max(...uv.map(q=>q.u)),Math.min(...uv.map(q=>q.v)),Math.max(...uv.map(q=>q.v))])
    } finally {wires.forEach(w=>k.release(w));if(outer!==undefined)k.release(outer)}
    const candidate=this.netFor(index,plan,true), locks=new Set([...candidate.trimLocks,...candidate.hiddenPoles])
    const witness=candidate.net.poles.findIndex((_,i)=>!locks.has(i)&&!boundaryLocked(candidate.net,i,'G1') &&
      visiblePoleWitness(candidate.net,i,(u,v)=>k.classifyPointOnFace(face,u,v),0.01)!==null)
    if(witness<0) throw new Error('Nessun punto libero con influenza interna verificata: preparazione non applicata.')
    const net=this.prepareSelection(index,plan,false,true),selected=this.infos[index]
    return {net,refinements:plan,trimLocks:selected.trimLocks,hiddenPoles:selected.hiddenPoles,witnessPole:witness}
  }
  /** Experimental exact insertion for an adaptive face without manual locks.
   * Validate the refined, deformed net before committing a new selection. */
  refineAdaptiveExperimental(net: Net, additions: readonly KnotInsertion[], continuity: 'G0' | 'G1', manualLocks: readonly number[]) {
    if (!this.adaptiveSelection || !this.originalNet || this.chosen < 0) throw new Error('Seleziona prima una faccia adattiva.')
    if (manualLocks.length) throw new Error('Sblocca i punti manuali prima del raffinamento adattivo.')
    if (!additions.length) throw new Error('Inserisci almeno un nodo.')
    assertNet(this.originalNet,net,continuity,false)
    const oldInfo=this.infos[this.chosen]
    for (const i of [...oldInfo.trimLocks,...oldInfo.hiddenPoles])
      if (net.poles[i].some((x,d)=>x!==this.originalNet!.poles[i][d])) throw new Error('Un punto protetto è stato modificato.')
    const plan=[...this.refinements,...structuredClone(additions)]
    const base=refineClampedNet(this.originalNet,additions), refined=refineClampedNet(net,additions)
    const candidate=this.netFor(this.chosen,plan,true)
    if (JSON.stringify(candidate.net)!==JSON.stringify(base)) throw new Error('Base adattiva raffinata non corrispondente.')
    assertNet(base,refined,continuity,false)
    for (const i of [...candidate.trimLocks,...candidate.hiddenPoles])
      if (refined.poles[i].some((x,d)=>x!==base.poles[i][d])) throw new Error('Il raffinamento sposterebbe un punto protetto.')
    const locks=new Set([...candidate.trimLocks,...candidate.hiddenPoles]),face=this.faces[this.chosen]
    const witness=refined.poles.findIndex((_,i)=>!locks.has(i)&&!boundaryLocked(refined,i,'G1') &&
      visiblePoleWitness(refined,i,(u,v)=>this.kernel.classifyPointOnFace(face,u,v),0.01)!==null)
    if (witness<0) throw new Error('Nessun punto libero con influenza interna verificata.')
    if (!this.source) throw new Error('Sorgente CAD non disponibile.')
    const isolated=new SurfaceEditorKernel(this.kernel)
    try {
      isolated.open(this.kernel.exportStep(this.source))
      const verifiedBase=isolated.prepareSelection(this.chosen,plan,false,true)
      if (JSON.stringify(verifiedBase)!==JSON.stringify(base) || !isolated.evaluate(refined,continuity,false,false).valid)
        throw new Error('La geometria raffinata non supera la verifica CAD.')
    } finally {isolated.dispose()}
    this.prepareSelection(this.chosen,plan,true,true)
    return {net:refined,originalNet:base,refinements:plan,trimLocks:candidate.trimLocks,hiddenPoles:candidate.hiddenPoles,witnessPole:witness}
  }
  /** Reactivate a historical adaptive basis only if its source-derived net and
   * protection map still match. Does not adopt or evaluate the edited net. */
  reactivateAdaptiveExperimental(refinements: readonly KnotInsertion[], expectedNet: Net,
    expectedTrimLocks: readonly number[], expectedHiddenPoles: readonly number[]) {
    if (!this.adaptiveSelection || this.chosen < 0) throw new Error('Seleziona prima una faccia adattiva.')
    const candidate=this.netFor(this.chosen,refinements,true)
    if (JSON.stringify(candidate.net)!==JSON.stringify(expectedNet) ||
        JSON.stringify(candidate.trimLocks)!==JSON.stringify(expectedTrimLocks) ||
        JSON.stringify(candidate.hiddenPoles)!==JSON.stringify(expectedHiddenPoles))
      throw new Error('La base adattiva storica non corrisponde alla sorgente.')
    const locks=new Set([...candidate.trimLocks,...candidate.hiddenPoles]),face=this.faces[this.chosen]
    const witness=candidate.net.poles.findIndex((_,i)=>!locks.has(i)&&!boundaryLocked(candidate.net,i,'G1') &&
      visiblePoleWitness(candidate.net,i,(u,v)=>this.kernel.classifyPointOnFace(face,u,v),.01)!==null)
    if(witness<0) throw new Error('Nessun punto libero con influenza interna verificata.')
    const net=this.prepareSelection(this.chosen,refinements,true,true)
    return {net,refinements:structuredClone([...refinements]),trimLocks:candidate.trimLocks,hiddenPoles:candidate.hiddenPoles,witnessPole:witness}
  }
  /** Reprepare the active face without invalidating its UV anchors. Switching
   * face still starts a new logical selection; failed preparation commits neither. */
  selectRefined(index: number, refinements: readonly KnotInsertion[] = []) {
    return this.prepareSelection(index, refinements, true)
  }
  private prepareSelection(index: number, refinements: readonly KnotInsertion[], preserveAnchors: boolean, fineTrim = false) {
    const info = this.netFor(index, refinements, fineTrim), net = info.net, record = this.records[this.recordsByFace[index]], k = this.kernel
    let text = this.brep, editRecord = record
    if (record.kind === 1) {
      // STEP readers may omit planar pcurves (derived implicitly on a plane).
      // Materialize them on the EXACT, still planar NURBS before any edit.
      // Never heal a deformed result. Reject any geometric/topological change.
      const converted = k.fromBREP(replaceSurface(this.brep, record, net))
      let prepared: ShapeHandle | undefined, fs: ShapeHandle[] = []
      try {
        prepared = k.fixShape(converted); fs = k.getSubShapes(prepared, 'face')
        if (!k.isValid(prepared) || fs.length !== this.faces.length || this.count(prepared, 'solid') !== this.solids) throw new Error('Conversione piana esatta non qualificabile per questa faccia.')
        for (let f = 0; f < fs.length; f++) {
          const b = k.uvBounds(this.faces[f])
          this.checkPreparedArea(this.faces[f],fs[f],f === index && info.trimLocks.length > 0)
          for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
            const u = b.uMin + (b.uMax - b.uMin) * i / 4, v = b.vMin + (b.vMax - b.vMin) * j / 4
            if (dist(tuple(k.pointOnSurface(fs[f], u, v)), tuple(k.pointOnSurface(this.faces[f], u, v))) > 1e-7) throw new Error('Conversione piana: geometria o ordine delle facce alterato.')
          }
        }
        text = k.toBREP(prepared)
        const faceText = k.toBREP(fs[index])
        const header = /^Fa\s*\n\s*[01]\s+[\deE+.-]+\s+(\d+)\s+0\s*$/m.exec(faceText)
        const target = header ? surfaceTable(faceText)[Number(header[1]) - 1] : undefined
        const found = target?.net ? surfaceTable(text).filter(r => signature(r) === signature(target)) : []
        if (found.length !== 1) throw new Error('Impossibile identificare il reticolo convertito.')
        editRecord = found[0]
      } finally { fs.forEach(f => k.release(f)); if (prepared) k.release(prepared); k.release(converted) }
    }
    // Keep the existing selection and its G1 witnesses if preparation fails.
    // The worker serializes requests, so invalidate only at successful commit.
    this.invalidateG1Selection()
    this.releasePreviewFace()
    this.revision++
    if (!preserveAnchors || this.chosen !== index) this.anchorSelectionRevision++
    this.chosen = index; this.originalNet = structuredClone(net); this.editBrep = text; this.editRecord = editRecord
    this.g1Selected = index
    this.refinements = structuredClone(refinements) as KnotInsertion[]
    this.adaptiveSelection = fineTrim
    this.infos[index] = { ...this.infos[index], trimLocks: info.trimLocks, hiddenPoles: info.hiddenPoles }
    return net
  }
  private invalidateG1Selection() { this.g1Selected = -1; this.g1SelectionRevision++; this.g1Constraints.clear(); this.g1CurvedConstraints.clear() }
  /** Read-only original-source topology. Identity and revisions never come from a client.
   * Fingerprint is captured before tessellation; an async digest cannot cross a
   * source/selection boundary. No OCCT handle escapes into the worker response. */
  async g1SupportCandidates(): Promise<G1SupportCandidates> {
    if (!this.g1SourceReady || this.source === null || this.g1Selected < 0)
      throw new Error('Seleziona prima una faccia per i supporti G1.')
    const sourceRevision = this.g1SourceRevision, selectionRevision = this.g1SelectionRevision, faceIndex = this.g1Selected
    const sourceId = 'brep-sha256:' + await (this.g1Fingerprint ??= sha256(this.brep))
    if (!this.g1SourceReady || this.source === null || sourceRevision !== this.g1SourceRevision ||
        selectionRevision !== this.g1SelectionRevision || faceIndex !== this.g1Selected)
      throw new Error('Elenco dei supporti G1 scaduto: seleziona di nuovo la faccia.')
    const stamp = { sourceId, sourceRevision, selectionRevision, faceIndex }
    return { stamp, candidates: listG1SupportCandidates(this.kernel, this.source, stamp) }
  }
  /** Read-only revalidation: only current, kernel-stamped choices are accepted. */
  async resolveG1SupportCandidate(choice: G1SupportCandidate): Promise<G1SupportCandidate> {
    const { stamp } = await this.g1SupportCandidates()
    if (this.source === null || stamp.sourceRevision !== this.g1SourceRevision ||
        stamp.selectionRevision !== this.g1SelectionRevision || stamp.faceIndex !== this.g1Selected)
      throw new Error('Scelta del supporto scaduta.')
    return resolveSupport(this.kernel, this.source, stamp, choice)
  }
  /** Curved candidates are a separate contract; no planar choice is widened. */
  async g1CurvedSupportCandidates(): Promise<G1CurvedSupportCandidates> {
    if (!this.g1SourceReady || this.source === null || this.g1Selected < 0 || !this.originalNet)
      throw new Error('Seleziona prima una faccia per i supporti curvi G1.')
    const sourceRevision = this.g1SourceRevision, selectionRevision = this.g1SelectionRevision, faceIndex = this.g1Selected, brep = this.brep
    const sourceId = 'brep-sha256:' + await (this.g1Fingerprint ??= sha256(brep))
    const stamp: G1SourceStamp = { sourceId, sourceRevision, selectionRevision, faceIndex }
    const current = () => this.g1SourceReady && this.source !== null && this.brep === brep &&
      this.g1SourceRevision === sourceRevision && this.g1SelectionRevision === selectionRevision && this.g1Selected === faceIndex
    if (!current()) throw new Error('Elenco dei supporti curvi G1 scaduto.')
    const candidates = await listCompatibleCurvedSupportCandidates(this.kernel, brep, stamp)
    if (!current()) throw new Error('Elenco dei supporti curvi G1 scaduto.')
    return { stamp, candidates }
  }
  async resolveG1CurvedSupportCandidate(choice: CompatibleCurvedSupportCandidate): Promise<ResolvedCompatibleCurvedSupport> {
    // Own client fields before the first digest await, just as the planar path.
    const requested = structuredClone(choice), brep = this.brep
    const { stamp } = await this.g1CurvedSupportCandidates()
    const result = await resolveCompatibleCurvedSupportCandidate(this.kernel, brep, stamp, requested)
    if (!this.g1SourceReady || this.source === null || this.brep !== brep || this.g1Selected !== stamp.faceIndex ||
        this.g1SourceRevision !== stamp.sourceRevision || this.g1SelectionRevision !== stamp.selectionRevision)
      throw new Error('Scelta del supporto curvo G1 scaduta.')
    return result
  }
  async g1CurvedSupportGeometry(choice: CompatibleCurvedSupportCandidate, previewRevision: number): Promise<G1CurvedSupportGeometry> {
    const brep = this.brep, source = this.source, validatedFace = this.noteFace(previewRevision)
    const selection = this.g1SelectionRevision, sourceRevision = this.g1SourceRevision
    if (this.adaptiveSelection) throw new Error('Preparazione non qualificata per la geometria del supporto G1.')
    const resolved = await this.resolveG1CurvedSupportCandidate(choice)
    if (source === null || this.source !== source || this.brep !== brep ||
        selection !== this.g1SelectionRevision || sourceRevision !== this.g1SourceRevision ||
        this.noteFace(previewRevision) !== validatedFace)
      throw new Error('Geometria del supporto curvo G1 scaduta.')

    // Never tessellate the live model for a display-only query. The resolver
    // certified exact, distinct own-support records in these same BREP bytes.
    const k = this.kernel, owned: ShapeHandle[] = []
    const collect = (handles: ShapeHandle[]) => { owned.push(...handles); return handles }
    const copy = k.fromBREP(brep)
    owned.push(copy)
    try {
      const faces = collect(k.getSubShapes(copy, 'face'))
      if (!k.isValid(copy) || faces.length !== this.faces.length ||
          faces.some((face, index) => faces.slice(0,index).some(other => k.isSame(face, other))))
        throw new Error('Occorrenze G1 non univoche nel BREP sorgente.')
      const records = faces.map(face => this.ownFaceSupport(face))
      const signatures = records.map(record => record && signature(record))
      if (signatures.includes(undefined) || new Set(signatures).size !== faces.length)
        throw new Error('Supporti G1 propri condivisi o non identificabili.')
      const bind = (witness: ResolvedCompatibleCurvedSupport['selectedWitness']) => {
        const index = signatures.indexOf(witness.surfaceSignature), face = faces[index]
        if (!face || index !== witness.faceIndex || k.shapeOrientation(face) !== witness.orientation)
          throw new Error('Identità della faccia G1 non univoca nel BREP sorgente.')
        const { uMin, uMax, vMin, vMax } = k.uvBounds(face)
        if ([uMin,uMax,vMin,vMax].some((x, i) => !Number.isFinite(x) || Math.abs(x-witness.domain[i]) > witness.parameterBudget) ||
            collect(k.getSubShapes(face, 'wire')).length !== 1)
          throw new Error('Dominio naturale della faccia G1 non corrispondente.')
        return face
      }
      const selected = bind(resolved.selectedWitness), support = bind(resolved.supportWitness)
      const shared = collect(k.sharedEdges(selected, support))
      const selectedEdges = collect(k.getSubShapes(selected, 'edge')), supportEdges = collect(k.getSubShapes(support, 'edge'))
      const supportSide = resolved.supportWitness.sides.find(side => side.side === resolved.candidate.supportSide)
      const selectedEdge = selectedEdges[resolved.candidate.edgeIndex], supportEdge = supportSide && supportEdges[supportSide.edgeIndex]
      if (shared.length !== 1 || selectedEdges.length !== 4 || supportEdges.length !== 4 ||
          !selectedEdge || !supportEdge || k.isSame(selected, support) ||
          !k.isSame(shared[0], selectedEdge) || !k.isSame(shared[0], supportEdge) || k.curveType(shared[0]) !== 'line')
        throw new Error('Bordo condiviso del supporto curvo G1 non univoco.')
      const edge = shared[0], { first, last } = k.curveParameters(edge)
      if (![first, last].every(Number.isFinite) || !(first < last))
        throw new Error('Intervallo del bordo curvo G1 non rappresentabile.')
      const seam: [Point, Point] = [tuple(k.curvePointAtParam(edge, first)), tuple(k.curvePointAtParam(edge, last))]
      if (seam.some(p => !p.every(Number.isFinite)) || Math.abs(dist(...seam) - resolved.candidate.lengthMm) > 1e-8)
        throw new Error('Bordo condiviso del supporto curvo G1 non rappresentabile.')
      const supportMesh = k.tessellate(support, { linearDeflection: .08, angularDeflection: .15 })
      if (supportMesh.vertexCount < 3 || supportMesh.triangleCount < 1 ||
          supportMesh.positions.length !== 3 * supportMesh.vertexCount || supportMesh.normals.length !== supportMesh.positions.length ||
          supportMesh.indices.length !== 3 * supportMesh.triangleCount ||
          !supportMesh.positions.every(Number.isFinite) || !supportMesh.normals.every(Number.isFinite) ||
          supportMesh.indices.some(index => index >= supportMesh.vertexCount))
        throw new Error('Triangolazione del supporto curvo G1 non disponibile.')
      return { choice:resolved.candidate, previewRevision, supportMesh, seam }
    } finally { owned.reverse().forEach(shape => k.release(shape)) }
  }

  async proposeG1CurvedTangency(request: G1CurvedProposalRequest): Promise<G1CurvedResult> {
    return this.curvedTangency(request, true)
  }
  async validateG1CurvedTangency(request: G1CurvedValidationRequest): Promise<G1CurvedResult> {
    return this.curvedTangency(request, false)
  }
  /** Publish only a fully verified curved pair; keep logical UV/anchor identity. */
  async publishG1CurvedTangency(request: G1CurvedValidationRequest): Promise<G1PublishedCurvedResult> {
    return this.curvedTangency(request, false, true) as Promise<G1PublishedCurvedResult>
  }
  /** Evaluate the actual net against an immutable, kernel-owned accepted ring.
   * No projection or latest-preview baseline is used for subsequent edits. */
  async evaluateG1CurvedTangency(input: G1CurvedEvaluationRequest): Promise<G1PublishedCurvedResult> {
    const request = structuredClone(input), registered = this.g1CurvedConstraints.get(request.constraintId)
    if (!Number.isSafeInteger(request.constraintId) || !registered || registered.kind !== 'compatible-bspline')
      throw new Error('Vincolo G1 curvo scaduto: verifica di nuovo la tangenza.')
    const locks = request.lockedPoles ?? [], initial = registered.request.lockedPoles ?? []
    if (!Array.isArray(locks) || Array.from(locks).some(i => !Number.isSafeInteger(i) || i < 0 || i >= registered.referenceNet.poles.length))
      throw new Error('Blocco di un polo inesistente.')
    if (locks.some(i => !initial.includes(i) && !boundaryLocked(registered.referenceNet, i, 'G1')))
      throw new Error('Nuovi blocchi interni richiedono una nuova verifica del vincolo G1 curvo.')
    return this.curvedTangency({ ...registered.request, net: request.net, exportStep: request.exportStep }, false, true,
      { id: request.constraintId, registered }) as Promise<G1PublishedCurvedResult>
  }
  private checkCurvedProtectedNet(net: Net, registered: RegisteredCurvedTangency): number[] {
    const reference = registered.referenceNet
    assertNet(reference, net, 'G1')
    // assertNet's legacy metadata comparison uses JSON. Retain signed-zero and
    // exact numeric metadata protection for this new constraint family too.
    if (!this.sameCurvedNet({ ...reference, poles: net.poles }, net)) throw new Error('Struttura del reticolo G1 curvo modificata.')
    const locks = registered.request.lockedPoles ?? []
    const protectedIds = reference.poles.flatMap((_, i) => boundaryLocked(reference, i, 'G1') || locks.includes(i) ? [i] : [])
    for (const i of protectedIds) if (net.poles[i].some((x, d) => !Object.is(x, reference.poles[i][d])))
      throw new Error('Un punto protetto dal vincolo G1 curvo è stato modificato.')
    return protectedIds
  }
  private sameCurvedNet(a: Net, b: Net, readback = false): boolean {
    const same = (x: readonly number[], y: readonly number[]) => x.length === y.length && x.every((v, i) => Object.is(v, y[i]))
    return a.nu === b.nu && a.nv === b.nv && a.du === b.du && a.dv === b.dv && a.poles.length === b.poles.length &&
      same(a.ku, b.ku) && same(a.kv, b.kv) && same(a.mu, b.mu) && same(a.mv, b.mv) && same(a.weights, b.weights) &&
      same(a.rational, b.rational) && same(a.periodic ?? [0, 0], b.periodic ?? [0, 0]) &&
      a.poles.every((p, i) => p.length === b.poles[i].length && p.every((x, d) => readback
        ? Number.isFinite(x) && Number.isFinite(b.poles[i][d]) && Math.abs(x - b.poles[i][d]) <= 1e-8 : Object.is(x, b.poles[i][d])))
  }
  /** Recheck the actual serialized pair. This does not reuse client normals or
   * a plane proxy for a support whose normal varies along the common edge. */
  private async checkCurvedTangencyReadback(shape: ShapeHandle, expected: Net, resolved: ResolvedCompatibleCurvedSupport,
    request: CompatibleCurvedTangencyRequest): Promise<void> {
    const k = this.kernel, choice = resolved.candidate
    this.checkUnselectedTangencyFaces(shape)
    const text = k.toBREP(shape), stamp = { ...choice.stamp, sourceId: 'brep-sha256:' + await sha256(text) }
    const candidates = (await listCompatibleCurvedSupportCandidates(k, text, stamp)).filter(c =>
      c.supportFaceIndex === choice.supportFaceIndex && c.edgeIndex === choice.edgeIndex && c.side === choice.side &&
      c.supportSide === choice.supportSide && c.reverseSupport === choice.reverseSupport)
    if (candidates.length !== 1) throw new Error('Adiacenza naturale del CAD G1 curvo finale diversa o ambigua.')
    const actual = await resolveCompatibleCurvedSupportCandidate(k, text, stamp, candidates[0])
    if (!this.sameCurvedNet(expected, actual.selectedNet, true) || !this.sameCurvedNet(resolved.supportNet, actual.supportNet, true))
      throw new Error('Reticolo CAD finale o supporto curvo diverso dai coefficienti verificati.')
    // Protected coefficients were already checked exactly BEFORE serialization.
    // Reassess the read-back pair itself, with its own coefficients as baseline.
    validateCompatibleCurvedTangencyResult({ ...request, net: actual.selectedNet, supportNet: actual.supportNet,
      lockIndices: [], preserveTangentEdges: [] }, actual.selectedNet)
    const faces = k.getSubShapes(shape, 'face')
    try {
      const a = faces[choice.stamp.faceIndex], b = faces[choice.supportFaceIndex]
      if (a === undefined || b === undefined) throw new Error('Coppia di facce G1 curve non disponibile.')
      const at = (n: Net, side: CompatibleCurvedSupportCandidate['side'], t: number): [number, number] => {
        const u0 = n.ku[0], u1 = n.ku.at(-1)!, v0 = n.kv[0], v1 = n.kv.at(-1)!
        return [side === 'uMin' ? u0 : side === 'uMax' ? u1 : u0 + (u1 - u0) * t,
          side === 'vMin' ? v0 : side === 'vMax' ? v1 : v0 + (v1 - v0) * t]
      }
      for (let i = 0; i <= 32; i++) {
        const t = i / 32, [u, v] = at(actual.selectedNet, choice.side, t), [s, w] = at(actual.supportNet, choice.supportSide, choice.reverseSupport ? 1 - t : t)
        if (!['in', 'on'].includes(k.classifyPointOnFace(a, u, v)) || !['in', 'on'].includes(k.classifyPointOnFace(b, s, w)))
          throw new Error('Bordo G1 curvo finale fuori dal trim CAD.')
        const p = tuple(k.pointOnSurface(a, u, v)), q = tuple(k.pointOnSurface(b, s, w))
        if (!p.every(Number.isFinite) || !q.every(Number.isFinite)) throw new Error('Coordinate CAD del bordo G1 curvo non finite.')
        const na = orientedSurfaceNormal(k, a, u, v), nb = orientedSurfaceNormal(k, b, s, w)
        const sin = Math.hypot(na[1] * nb[2] - na[2] * nb[1], na[2] * nb[0] - na[0] * nb[2], na[0] * nb[1] - na[1] * nb[0])
        const gap = dist(p, q), dot = na.reduce((sum, x, d) => sum + x * nb[d], 0)
        if (!Number.isFinite(gap) || !Number.isFinite(sin) || !Number.isFinite(dot) ||
            gap > (request.distanceTolerance ?? 1e-8) || sin > 1e-7 || dot <= 0)
          throw new Error('Posizione, tangenza o orientazione del bordo CAD curvo finale non verificata.')
      }
    } finally { faces.forEach(f => k.release(f)) }
  }
  private async curvedTangency(input: G1CurvedProposalRequest | G1CurvedValidationRequest, propose: boolean, publish = false,
    persistent?: { id: number; registered: RegisteredCurvedTangency }): Promise<G1CurvedResult | G1PublishedCurvedResult> {
    const request = structuredClone(input), edit = this.revision, preview = this.previewRevision, anchor = this.anchorSelectionRevision
    const source = this.g1SourceRevision, selection = this.g1SelectionRevision, brep = this.brep
    const fence = () => {
      if (!this.g1SourceReady || this.source === null || this.revision !== edit || this.previewRevision !== preview ||
          this.anchorSelectionRevision !== anchor || this.g1SourceRevision !== source || this.g1SelectionRevision !== selection || this.brep !== brep)
        throw new Error('Scelta del supporto curvo G1 scaduta durante la verifica.')
      if (persistent && this.g1CurvedConstraints.get(persistent.id) !== persistent.registered)
        throw new Error('Vincolo G1 curvo scaduto durante la verifica.')
    }
    const resolved = await this.resolveG1CurvedSupportCandidate(request.choice)
    fence()
    if (!this.originalNet || !this.editRecord || this.chosen !== resolved.candidate.stamp.faceIndex ||
        !this.sameCurvedNet(this.originalNet, resolved.selectedNet))
      throw new Error('La preparazione selezionata non coincide con il reticolo nativo certificato; nessun raffinamento implicito.')
    if (request.exportStep !== undefined && typeof request.exportStep !== 'boolean') throw new Error('Opzione STEP non valida.')
    const protectedIds = persistent ? this.checkCurvedProtectedNet(request.net, persistent.registered) : null
    if (persistent && !this.sameCurvedNet(resolved.supportNet, persistent.registered.supportNet))
      throw new Error('Supporto sorgente diverso dal vincolo G1 curvo accettato.')
    // The coefficient helper's transaction validator normally protects EVERY
    // pole outside the proposed first row. For persistent edits, protections are
    // enforced above against the accepted reference; assess the current net as
    // its own mathematical baseline so genuinely free deep poles may move.
    const base = persistent ? request.net : propose ? request.net : (request as G1CurvedValidationRequest).baseNet
    const info = this.netFor(this.chosen, this.refinements)
    if (!info.natural) throw new Error('La tangenza curva richiede una faccia naturale senza ritagli.')
    const locked = request.lockedPoles ?? []
    if (!Array.isArray(locked) || Array.from(locked).some(i => !Number.isSafeInteger(i) || i < 0 || i >= base.poles.length))
      throw new Error('Blocco di un polo inesistente.')
    const edge = ({ uMin: 'U0', uMax: 'U1', vMin: 'V0', vMax: 'V1' } as const)[resolved.candidate.side]
    const supportEdge = ({ uMin: 'U0', uMax: 'U1', vMin: 'V0', vMax: 'V1' } as const)[resolved.candidate.supportSide]
    const pure: CompatibleCurvedTangencyRequest = { net: base, supportNet: resolved.supportNet, edge, supportEdge,
      reverseSupport: resolved.candidate.reverseSupport, scale: request.scale,
      lockIndices: [...new Set([...locked, ...info.trimLocks, ...info.hiddenPoles])],
      preserveTangentEdges: (['U0', 'U1', 'V0', 'V1'] as NaturalEdge[]).filter(e => e !== edge),
      distanceTolerance: request.distanceTolerance, derivativeTolerance: request.derivativeTolerance }
    const isolated = new SurfaceEditorKernel(this.kernel), k = this.kernel
    try {
      isolated.source = k.fromBREP(brep); isolated.faces = k.getSubShapes(isolated.source, 'face')
      isolated.solids = this.solids; isolated.infos = structuredClone(this.infos); isolated.chosen = this.chosen
      isolated.originalNet = structuredClone(this.originalNet); isolated.editBrep = this.editBrep; isolated.editRecord = structuredClone(this.editRecord)
      if (!persistent) isolated.evaluate(base, 'G0')
      const net = propose ? proposeCompatibleCurvedTangency(pure).net : request.net
      const assessed = validateCompatibleCurvedTangencyResult(pure, net)
      const validation = protectedIds ? { ...assessed, protectedPoleCount: protectedIds.length } : assessed
      // The curved prototype always qualifies the STEP roundtrip, even when
      // the caller only asks for an isolated preview and no STEP payload.
      const evaluated = isolated.evaluate(net, 'G0', true)
      if (isolated.validatedFace === null) throw new Error('Faccia CAD G1 curva finale non determinata.')
      const faceText = k.toBREP(isolated.validatedFace), faceHeaders = [...faceText.matchAll(/^Fa\s*\n\s*[01]\s+[\deE+.-]+\s+(\d+)\s+0\s*$/gm)]
      const retained = faceHeaders.length === 1 ? surfaceTable(faceText)[Number(faceHeaders[0][1]) - 1]?.net : undefined
      if (!retained || !this.sameCurvedNet(net, retained, true)) throw new Error('Faccia CAD G1 curva trattenuta diversa dai coefficienti verificati.')
      validateCompatibleCurvedTangencyResult({ ...pure, net: retained, lockIndices: [], preserveTangentEdges: [] }, retained)
      const rebuilt = k.fromBREP(replaceSurface(this.editBrep, this.editRecord, net))
      try { await this.checkCurvedTangencyReadback(rebuilt, net, resolved, pure) } finally { k.release(rebuilt) }
      fence()
      if (typeof evaluated.step !== 'string' || !evaluated.step.trim()) throw new Error('STEP della proposta G1 curva non disponibile.')
      const imported = k.importStep(evaluated.step)
      try { await this.checkCurvedTangencyReadback(imported, net, resolved, pure) } finally { k.release(imported) }
      fence()
      const { step, previewRevision: _isolatedRevision, ...resultPreview } = evaluated
      const changeBase = persistent?.registered.referenceNet ?? base
      const result: G1CurvedResult = { net: structuredClone(net), changedIndices: net.poles.flatMap((p, i) => p.some((x, d) => !Object.is(x, changeBase.poles[i][d])) ? [i] : []),
        choice: structuredClone(resolved.candidate), stamp: { ...resolved.candidate.stamp }, revisions: { edit, preview, anchorSelection: anchor },
        validation, preview: resultPreview, step: request.exportStep ? step : undefined }
      if (!publish) return result
      const id = persistent?.id ?? this.g1ConstraintSerial + 1, nextPreview = preview + 1
      if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(nextPreview) || nextPreview <= preview)
        throw new Error('Limite degli identificativi o delle revisioni G1 curvi raggiunto.')
      // Allocate all immutable registration/response data before replacing any
      // live handle. No asynchronous work follows this final publication fence.
      const registered: RegisteredCurvedTangency = persistent?.registered ?? {
        kind: 'compatible-bspline', request: structuredClone({ ...request, choice: resolved.candidate,
          baseNet: base, net, lockedPoles: [...(pure.lockIndices ?? [])] } as G1CurvedValidationRequest),
        referenceNet: structuredClone(net), supportNet: structuredClone(resolved.supportNet) }
      const published: G1PublishedCurvedResult = { ...result, constraintId: id, constraintKind: 'compatible-bspline',
        preview: { ...resultPreview, previewRevision: nextPreview } }
      fence()
      this.releasePreviewFace()
      this.validatedFace = isolated.validatedFace; isolated.validatedFace = null
      this.validatedSheetBrep = isolated.validatedSheetBrep; isolated.validatedSheetBrep = null
      this.previewRevision = nextPreview
      this.g1ConstraintSerial = Math.max(this.g1ConstraintSerial, id)
      this.g1CurvedConstraints.set(id, registered)
      return published
    } finally { isolated.clear() }
  }
  /** Internal CAD prototype: never changes the interactive draft, preview, anchors
   * or recipes. All three other tangent rings are preserved relative to net.
   * A selected-edge regularity proof is NOT a global G1 certificate. */
  async proposeG1PlaneTangency(request: G1PlaneProposalRequest): Promise<G1PlaneResult> {
    return this.planeTangency(request, true)
  }
  /** Validate a supplied final net; does not project it or regenerate a proposal. */
  async validateG1PlaneTangency(request: G1PlaneValidationRequest): Promise<G1PlaneResult> {
    return this.planeTangency(request, false)
  }
  /** Register only a strictly verified proposal; source and logical UV selection stay unchanged. */
  async publishG1PlaneTangency(request: G1PlaneValidationRequest): Promise<G1PublishedPlaneResult> {
    return this.planeTangency(request, false, true) as Promise<G1PublishedPlaneResult>
  }
  /** Reassess the actual current net against a kernel-owned accepted baseline. Never projects or repairs. */
  async evaluateG1PlaneTangency(input: G1PlaneEvaluationRequest): Promise<G1PublishedPlaneResult> {
    const request = structuredClone(input), registered = this.g1Constraints.get(request.constraintId)
    if (!Number.isSafeInteger(request.constraintId) || !registered) throw new Error('Vincolo G1 scaduto: verifica di nuovo la tangenza.')
    const locks = request.lockedPoles ?? []
    if (!Array.isArray(locks) || locks.some(i=>!Number.isInteger(i)||i<0||i>=registered.referenceNet.poles.length))
      throw new Error('Blocco di un polo inesistente.')
    // Later lock positions need a kernel-owned history token. Until that exists,
    // refuse new interior locks rather than compare them to a moving last-preview baseline.
    if (locks.some(i=>!registered.request.lockedPoles!.includes(i)&&!boundaryLocked(registered.referenceNet,i,'G1')))
      throw new Error('Nuovi blocchi interni richiedono una nuova verifica del vincolo G1.')
    return this.planeTangency({...registered.request, net:request.net, exportStep:request.exportStep}, false, true,
      {id:request.constraintId, registered}) as Promise<G1PublishedPlaneResult>
  }
  private async planeTangency(input: G1PlaneProposalRequest | G1PlaneValidationRequest, propose: boolean, publish = false,
    persistent?: {id:number; registered:RegisteredPlaneTangency}): Promise<G1PlaneResult | G1PublishedPlaneResult> {
    // Snapshot before the asynchronous identity read: client mutation and a
    // re-selection while hashing must never retarget this operation.
    const request = structuredClone(input), editRevision = this.revision
    const previewRevision = this.previewRevision, anchorSelection = this.anchorSelectionRevision
    const choice = await this.resolveG1SupportCandidate(request.choice)
    if (this.revision !== editRevision || this.previewRevision !== previewRevision ||
        this.anchorSelectionRevision !== anchorSelection || !this.originalNet || !this.editRecord ||
        this.chosen !== choice.stamp.faceIndex || this.g1Selected !== this.chosen)
      throw new Error('Scelta del supporto scaduta durante la verifica.')
    if (request.exportStep !== undefined && typeof request.exportStep !== 'boolean') throw new Error('Opzione STEP non valida.')
    const base = propose ? request.net : (request as G1PlaneValidationRequest).baseNet
    // Natural-domain eligibility belongs to the kernel, never to the choice.
    const prepared = this.netFor(this.chosen, this.refinements)
    if (!prepared.natural) throw new Error('La tangenza richiede una faccia naturale senza ritagli.')
    const locked = request.lockedPoles ?? []
    if (!Array.isArray(locked) || locked.some(i => !Number.isInteger(i) || i < 0 || i >= base.poles.length))
      throw new Error('Blocco di un polo inesistente.')
    const edge = ({uMin:'U0',uMax:'U1',vMin:'V0',vMax:'V1'} as const)[choice.side]
    if (!edge) throw new Error('Bordo naturale non supportato.')
    const pure: PlaneTangencyRequest = { net: base, edge,
      plane: {point:choice.plane.origin,normal:choice.plane.normal},
      lockIndices: [...new Set([...locked,...prepared.trimLocks,...prepared.hiddenPoles])],
      preserveTangentEdges: (['U0','U1','V0','V1'] as NaturalEdge[]).filter(e => e !== edge),
      distanceTolerance: request.distanceTolerance ?? 1e-8 }
    const isolated = new SurfaceEditorKernel(this.kernel), k = this.kernel
    try {
      // Independent handles, same frozen source and exact prepared record.
      // Reuse evaluate unchanged, including its intersection/normal/trim gates.
      isolated.source = k.fromBREP(this.brep)
      isolated.faces = k.getSubShapes(isolated.source,'face')
      isolated.solids = this.solids; isolated.infos = structuredClone(this.infos)
      isolated.chosen = this.chosen; isolated.originalNet = structuredClone(this.originalNet)
      isolated.editBrep = this.editBrep; isolated.editRecord = structuredClone(this.editRecord)
      isolated.evaluate(base,'G0')
      const net = propose ? proposePlaneTangency(pure).net : request.net
      // Strict validation of the actual final coefficient net, before any BREP
      // serialization. Protected coefficients never get a roundoff exemption.
      let validation: PlaneTangencyValidation
      if (persistent) {
        const reference = persistent.registered.referenceNet
        assertNet(reference,net,'G1')
        const protectedIds = [...new Set([...pure.lockIndices,...net.poles.flatMap((_,i)=>boundaryLocked(net,i,'G1')?[i]:[])])]
        for (const i of protectedIds) if (net.poles[i].some((x,d)=>!Object.is(x,reference.poles[i][d])))
          throw new Error('Un punto protetto dal vincolo G1 è stato modificato.')
        validation = {...validatePlaneTangencyConstraint(pure,net),protectedPoleCount:protectedIds.length}
      } else validation = validatePlaneTangencyResult(pure,net)
      const evaluated = isolated.evaluate(net,'G0',request.exportStep ?? false)
      const finalFace = isolated.validatedFace
      if (finalFace === null) throw new Error('Faccia CAD finale non determinata.')
      this.checkPlaneTangencyReadback(finalFace,net,edge,choice,pure.distanceTolerance)
      // Independently inspect the rebuilt shape as well as the retained face.
      const rebuilt = k.fromBREP(replaceSurface(this.editBrep,this.editRecord,net))
      try {this.checkUnselectedTangencyFaces(rebuilt)} finally {k.release(rebuilt)}
      if (evaluated.step !== undefined) {
        const imported = k.importStep(evaluated.step)
        let fs: ShapeHandle[] = []
        try {
          fs = k.getSubShapes(imported,'face')
          if (!k.isValid(imported) || fs.length !== this.faces.length || this.count(imported,'solid') !== this.solids)
            throw new Error('STEP della tangenza non valido o topologia alterata.')
          // Refuse reordered/reparameterized deliveries instead of guessing an identity.
          this.checkPlaneTangencyReadback(fs[this.chosen],net,edge,choice,pure.distanceTolerance)
          this.checkUnselectedTangencyFaces(imported)
        } finally {fs.forEach(f=>k.release(f));k.release(imported)}
      }
      if (this.revision !== editRevision || this.previewRevision !== previewRevision || this.anchorSelectionRevision !== anchorSelection ||
          choice.stamp.sourceRevision !== this.g1SourceRevision || choice.stamp.selectionRevision !== this.g1SelectionRevision)
        throw new Error('Scelta del supporto scaduta durante la verifica CAD.')
      const {step,previewRevision: _isolatedRevision,...preview} = evaluated
      const result: G1PlaneResult = { net:structuredClone(net), changedIndices:net.poles.flatMap((p,i)=>p.some((x,d)=>!Object.is(x,base.poles[i][d]))?[i]:[]),
        choice,stamp:{...choice.stamp},revisions:{edit:editRevision,preview:previewRevision,anchorSelection},validation,preview,step }
      if (!publish) return result // Isolated proposals never acquire an interactive witness.
      if (persistent && this.g1Constraints.get(persistent.id)!==persistent.registered)
        throw new Error('Vincolo G1 scaduto durante la verifica CAD.')
      // Allocate snapshots and response before transferring any host-owned state.
      const id = persistent?.id ?? this.g1ConstraintSerial + 1
      const registered: RegisteredPlaneTangency = persistent ? persistent.registered : {
        request:structuredClone({...request,choice,lockedPoles:[...pure.lockIndices]} as G1PlaneValidationRequest),
        referenceNet:structuredClone(net)}
      const published: G1PublishedPlaneResult = {...result,constraintId:id,preview:{...preview,previewRevision:previewRevision+1}}
      // No asynchronous work follows the final fence. Only this verified face is transferred.
      this.releasePreviewFace()
      this.validatedFace = isolated.validatedFace; isolated.validatedFace = null
      this.validatedSheetBrep = isolated.validatedSheetBrep; isolated.validatedSheetBrep = null
      this.previewRevision++
      this.g1ConstraintSerial = Math.max(this.g1ConstraintSerial,id)
      this.g1Constraints.set(id,registered)
      return published
    } finally {isolated.clear()}
  }
  private ownFaceSupport(face: ShapeHandle): RecordSpan | undefined {
    const text = this.kernel.toBREP(face)
    const headers = [...text.matchAll(/^Fa\s*\n\s*[01]\s+[\deE+.-]+\s+(\d+)\s+0\s*$/gm)]
    return headers.length === 1 ? surfaceTable(text)[Number(headers[0][1])-1] : undefined
  }

  private checkUnselectedTangencyFaces(shape: ShapeHandle) {
    const k=this.kernel, fs=k.getSubShapes(shape,'face')
    const close=(a:number,b:number)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-12*Math.max(1,Math.abs(a),Math.abs(b))
    try {
      if (fs.length!==this.faces.length || this.count(shape,'solid')!==this.solids || !k.isValid(shape))
        throw new Error('Topologia della tangenza alterata.')
      for(let i=0;i<fs.length;i++) if(i!==this.chosen) {
        const before=this.ownFaceSupport(this.faces[i]),after=this.ownFaceSupport(fs[i])
        if(!before || !after || before.kind!==after.kind || before.values.length!==after.values.length ||
            before.values.some((x,d)=>!close(x,after.values[d])) ||
            k.shapeOrientation(this.faces[i])!==k.shapeOrientation(fs[i]))
          throw new Error('Una faccia di supporto è stata modificata.')
        const a=k.uvBounds(this.faces[i]),b=k.uvBounds(fs[i])
        if(![a.uMin,a.uMax,a.vMin,a.vMax].every((x,d)=>close(x,[b.uMin,b.uMax,b.vMin,b.vMax][d])))
          throw new Error('Dominio di una faccia non selezionata alterato.')
        const oldEdges=k.getSubShapes(this.faces[i],'edge'),edges:ShapeHandle[]=[]
        try {
          edges.push(...k.getSubShapes(fs[i],'edge'))
          if(edges.length!==oldEdges.length)throw new Error('Bordi di una faccia non selezionata alterati.')
          for(let e=0;e<edges.length;e++) {
            const old=k.curveParameters(oldEdges[e]),next=k.curveParameters(edges[e])
            if(k.curveType(oldEdges[e])!==k.curveType(edges[e]) || !close(old.first,next.first) || !close(old.last,next.last))
              throw new Error('Bordo di una faccia non selezionata alterato.')
            for(let j=0;j<=32;j++) if(dist(tuple(k.curvePointAtParam(oldEdges[e],old.first+(old.last-old.first)*j/32)),
              tuple(k.curvePointAtParam(edges[e],next.first+(next.last-next.first)*j/32)))>1e-7)
              throw new Error('Contorno di una faccia non selezionata alterato.')
          }
        } finally {[...oldEdges,...edges].forEach(e=>k.release(e))}
      }
    } finally {fs.forEach(f=>k.release(f))}
  }
  /** Read the actual OCCT face support. BREP/STEP formatting is checked with a
   * separate numeric budget; it does not weaken in-memory protected-pole checks. */
  private checkPlaneTangencyReadback(face: ShapeHandle, net: Net, edge: NaturalEdge, choice: G1SupportCandidate, tolerance: number) {
    const k = this.kernel, text = k.toBREP(face)
    const header = /^Fa\s*\n\s*[01]\s+[\deE+.-]+\s+(\d+)\s+0\s*$/m.exec(text)
    const actual = header ? surfaceTable(text)[Number(header[1])-1]?.net : undefined
    const close = (a: number,b: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a-b) <= 1e-12*Math.max(1,Math.abs(a),Math.abs(b))
    const same = (a: readonly number[],b: readonly number[]) => a.length === b.length && a.every((x,i)=>close(x,b[i]))
    if (!actual || actual.nu!==net.nu || actual.nv!==net.nv || actual.du!==net.du || actual.dv!==net.dv ||
        !same(actual.ku,net.ku) || !same(actual.kv,net.kv) || !same(actual.mu,net.mu) || !same(actual.mv,net.mv) ||
        !same(actual.weights,net.weights) || !same(actual.rational,net.rational) ||
        !same(actual.periodic??[0,0],net.periodic??[0,0]) || actual.poles.some((p,i)=>!same(p,net.poles[i])))
      throw new Error('Reticolo CAD finale diverso dalla tangenza verificata.')
    const b = k.uvBounds(face)
    if (!same([b.uMin,b.uMax,b.vMin,b.vMax],[net.ku[0],net.ku.at(-1)!,net.kv[0],net.kv.at(-1)!]))
      throw new Error('Dominio CAD finale diverso dal bordo naturale.')
    // Repeat residual/continuous selected-edge regularity on serialized CAD
    // coefficients themselves. Preservation was already checked strictly on
    // the pre-serialization final net; this is an independent geometry check.
    validatePlaneTangencyResult({net:actual,edge,plane:{point:choice.plane.origin,normal:choice.plane.normal},
      lockIndices:[],distanceTolerance:tolerance},actual)
    for (let i=0;i<=32;i++) {
      const t=i/32, u=edge==='U0'?b.uMin:edge==='U1'?b.uMax:b.uMin+(b.uMax-b.uMin)*t
      const v=edge==='V0'?b.vMin:edge==='V1'?b.vMax:b.vMin+(b.vMax-b.vMin)*t
      const p=tuple(k.pointOnSurface(face,u,v)), normal=orientedSurfaceNormal(k,face,u,v), n=choice.plane.normal
      const d=p.reduce((sum,x,a)=>sum+(x-choice.plane.origin[a])*n[a],0)
      const sin=Math.hypot(normal[1]*n[2]-normal[2]*n[1],normal[2]*n[0]-normal[0]*n[2],normal[0]*n[1]-normal[1]*n[0])
      if (!Number.isFinite(d) || Math.abs(d)>tolerance || !Number.isFinite(sin) || sin>1e-7)
        throw new Error('Bordo CAD finale non tangente al piano di supporto.')
    }
  }
  private preparation(): SurfaceEditRecipe['preparation'] {
    const info = this.infos[this.chosen]
    return info.converted ? 'plane-to-bicubic' : info.enriched ? 'bicubic-midpoint-refinement' : 'native-nurbs'
  }
  /** Persist only after exact CAD validation. The host supplies its stable body ID. */
  async createRecipe(net: Net, continuity: 'G0' | 'G1', lockedPoles: number[], bodyId: string, freeBoundary = false, constraintId?: number): Promise<SurfaceEditRecipe> {
    if (this.adaptiveSelection) throw new Error('La preparazione adattiva richiede una ricetta v7 esplicita.')
    return this.createRecipeCommon(net,continuity,lockedPoles,bodyId,freeBoundary,constraintId)
  }
  /** Research-only v7 creation; never encode fine trim as a legacy recipe. */
  async createAdaptiveRecipe(net: Net, continuity: 'G0' | 'G1', lockedPoles: number[], bodyId: string): Promise<AdaptiveTrimRecipe> {
    if (!this.adaptiveSelection || !this.originalNet) throw new Error('Seleziona prima una preparazione adattiva.')
    if (!Array.isArray(lockedPoles) || lockedPoles.some(i=>!Number.isSafeInteger(i) || i<0 || i>=this.originalNet!.poles.length ||
      !net.poles[i] || net.poles[i].some((x,d)=>x!==this.originalNet!.poles[i][d])))
      throw new Error('Un punto bloccato è stato modificato o non è valido.')
    const recipe=await this.createRecipeCommon(net,continuity,lockedPoles,bodyId,false)
    if (recipe.version!==4) throw new Error('Raffinamento adattivo non disponibile.')
    return readAdaptiveTrimRecipe({...recipe,version:7,trimPolicy:'circular-fine-v1'})
  }
  /** Explicit lock-at-current-position contract; no worker/UI exposure yet. */
  async createAdaptiveLockedRecipe(net: Net, continuity: 'G0' | 'G1', locks: AdaptiveLocks, bodyId: string): Promise<AdaptiveLockedRecipe> {
    if (!this.adaptiveSelection || !this.originalNet) throw new Error('Seleziona prima una preparazione adattiva.')
    const next=structuredClone(net), snapshot=structuredClone(locks)
    validateAdaptiveLocks(next,snapshot)
    const recipe=await this.createRecipeCommon(next,continuity,snapshot.map(lock=>lock.index),bodyId,false)
    if(recipe.version!==4) throw new Error('Raffinamento adattivo non disponibile.')
    return readAdaptiveLockedRecipe({...recipe,version:8,trimPolicy:'circular-fine-v1',lockedValues:snapshot})
  }
  private async createRecipeCommon(net: Net, continuity: 'G0' | 'G1', lockedPoles: number[], bodyId: string, freeBoundary = false, constraintId?: number): Promise<SurfaceEditRecipe> {
    if (!this.originalNet || !this.source) throw new Error('Seleziona prima una faccia.')
    if (typeof freeBoundary !== 'boolean' || !['G0', 'G1'].includes(continuity)) throw new Error('Modalità bordo non valida.')
    if (constraintId !== undefined) {
      if (freeBoundary) throw new Error('La ricetta G1 richiede bordi protetti.')
      if (this.g1CurvedConstraints.has(constraintId)) throw new Error('La ricetta G1 B-spline richiede il percorso curvo esplicito.')
      return this.createPlaneRecipe(net, continuity, lockedPoles, bodyId, constraintId)
    }
    const base = structuredClone(this.originalNet), next = structuredClone(net), rev = this.revision, preview = this.previewRevision
    if (freeBoundary && !this.infos[this.chosen].freeBoundary)
      throw new Error('Il bordo libero richiede una sola faccia aperta con contorno naturale rettangolare.')
    assertNet(base, next, continuity, freeBoundary)
    const recipe: SurfaceEditRecipe = {
      schema: 'tmar.surface-edit', ...(this.refinements.length
        ? { version: 4, boundaryMode: freeBoundary ? 'free-natural' : 'locked', refinements: structuredClone(this.refinements) }
        : freeBoundary ? { version: 3, boundaryMode: 'free-natural' } : { version: 2 }), engine: 'occt-wasm-5.7.1/brep-v3',
      units: 'mm', coordinateFrame: 'imported-step',
      source: { bodyId, brepSha256: '', faceCount: this.faces.length, solidCount: this.solids },
      faceIndex: this.chosen, preparation: this.preparation(), baseNetSha256: '', continuity,
      edits: next.poles.flatMap((point, index) => point.some((x, d) => x !== base.poles[index][d]) ? [{ index, point: [...point] as Point }] : []),
      lockedPoles: [...lockedPoles],
    }
    ;[recipe.source.brepSha256, recipe.baseNetSha256] = await Promise.all([sha256(this.brep), sha256(JSON.stringify(base))])
    if (this.revision !== rev || this.previewRevision !== preview) throw new Error('Sorgente o anteprima cambiata durante il salvataggio della ricetta.')
    const checked = readRecipe(recipe)
    if (checked.lockedPoles.some(i => i >= base.poles.length)) throw new Error('Blocco di un polo inesistente.')
    this.evaluate(next, continuity, false, freeBoundary)
    return checked
  }
  private planeSnapshot(id: number, registered = this.g1Constraints.get(id)): SurfacePlaneTangency {
    if (!registered) throw new Error('Vincolo G1 scaduto: verifica di nuovo la tangenza.')
    return structuredClone({ constraintId: id, baseNet: registered.request.baseNet, referenceNet: registered.referenceNet,
      choice: registered.request.choice, lockedPoles: [...(registered.request.lockedPoles ?? [])],
      distanceTolerance: registered.request.distanceTolerance ?? 1e-8 })
  }
  private checkRecipePlaneLocks(registered: { referenceNet: Net; request: { lockedPoles?: readonly number[] } }, locks: readonly number[]): void {
    const n = registered.referenceNet, info = this.infos[this.chosen]
    if (!Array.isArray(locks) || locks.length > 1600 || new Set(locks).size !== locks.length ||
        Array.from(locks).some(i => !Number.isSafeInteger(i) || Object.is(i, -0) || i < 0 || i >= n.poles.length))
      throw new Error('Blocchi della ricetta G1 non validi.')
    const initial = registered.request.lockedPoles ?? []
    if (locks.some(i => !initial.includes(i) && !boundaryLocked(n, i, 'G1')))
      throw new Error('Nuovi blocchi interni richiedono una nuova verifica del vincolo G1.')
    if (initial.some(i => !info.trimLocks.includes(i) && !info.hiddenPoles.includes(i) && !locks.includes(i)))
      throw new Error('I blocchi iniziali della ricetta G1 devono restare protetti.')
  }
  private async createPlaneRecipe(net: Net, continuity: 'G0' | 'G1', lockedPoles: number[], bodyId: string, constraintId: number): Promise<SurfaceEditRecipeV5> {
    const registered = this.g1Constraints.get(constraintId)
    if (!Number.isSafeInteger(constraintId) || !registered) throw new Error('Vincolo G1 scaduto: verifica di nuovo la tangenza.')
    const sourceNet = structuredClone(this.originalNet!), next = structuredClone(net), locks = structuredClone(lockedPoles)
    const rev = this.revision, preview = this.previewRevision, anchor = this.anchorSelectionRevision
    this.checkRecipePlaneLocks(registered, locks)
    // Full CAD verification stays isolated: serializing a recipe must not replace
    // the current interactive face or its note witness.
    await this.planeTangency({ ...registered.request, net: next, exportStep: false }, false, false, { id: constraintId, registered })
    const sparse = (n: Net): SerializedPoleEdit[] => n.poles.flatMap((point, index) =>
      point.some((x, d) => !Object.is(x, sourceNet.poles[index][d])) ? [{ index, point: encodeRecipePoint(point) }] : [])
    const choice = registered.request.choice
    const recipe: SurfaceEditRecipeV5 = {
      schema: 'tmar.surface-edit', version: 5, engine: 'occt-wasm-5.7.1/brep-v3', units: 'mm', coordinateFrame: 'imported-step',
      source: { bodyId, brepSha256: '', faceCount: this.faces.length, solidCount: this.solids }, faceIndex: this.chosen,
      preparation: this.preparation(), baseNetSha256: '', continuity, boundaryMode: 'locked', refinements: structuredClone(this.refinements),
      edits: sparse(next), lockedPoles: locks,
      planeTangency: { kind: 'plane', supportFaceIndex: choice.supportFaceIndex, edgeIndex: choice.edgeIndex, side: choice.side,
        distanceTolerance: registered.request.distanceTolerance ?? 1e-8, initialLockedPoles: [...(registered.request.lockedPoles ?? [])],
        proposalBaseEdits: sparse(registered.request.baseNet), acceptedReferenceEdits: sparse(registered.referenceNet) },
    }
    ;[recipe.source.brepSha256, recipe.baseNetSha256] = await Promise.all([sha256(this.brep), sha256(JSON.stringify(sourceNet))])
    if (this.revision !== rev || this.previewRevision !== preview || this.anchorSelectionRevision !== anchor ||
        this.g1Constraints.get(constraintId) !== registered) throw new Error('Sessione cambiata durante il salvataggio della ricetta G1.')
    return readRecipe(recipe) as SurfaceEditRecipeV5
  }
  private curvedSnapshot(id: number, registered = this.g1CurvedConstraints.get(id)): SurfaceCurvedTangency {
    if (!registered) throw new Error('Vincolo G1 B-spline scaduto.')
    return structuredClone({ kind: 'compatible-bspline', constraintId: id, baseNet: registered.request.baseNet,
      referenceNet: registered.referenceNet, choice: registered.request.choice, lockedPoles: [...(registered.request.lockedPoles ?? [])],
      scale: registered.request.scale ?? 1, distanceTolerance: registered.request.distanceTolerance ?? 1e-8,
      derivativeTolerance: registered.request.derivativeTolerance ?? 1e-8, faceCount: this.faces.length })
  }
  /** Explicit kernel-only v6 path. Generic worker/draft callers remain closed. */
  async createCurvedRecipe(net: Net, continuity: 'G0' | 'G1', lockedPoles: number[], bodyId: string, constraintId: number): Promise<SurfaceEditRecipeV6> {
    const registered = this.g1CurvedConstraints.get(constraintId)
    if (!this.originalNet || !this.source || !Number.isSafeInteger(constraintId) || !registered)
      throw new Error('Vincolo G1 B-spline scaduto: verifica di nuovo la tangenza.')
    if (!['G0', 'G1'].includes(continuity) || this.refinements.length || this.preparation() !== 'native-nurbs')
      throw new Error('La ricetta G1 B-spline richiede il reticolo nativo originale senza raffinamenti.')
    const sourceNet = structuredClone(this.originalNet), next = structuredClone(net), locks = structuredClone(lockedPoles)
    const rev = this.revision, preview = this.previewRevision, anchor = this.anchorSelectionRevision
    this.checkRecipePlaneLocks(registered, locks)
    await this.curvedTangency({ ...registered.request, net: next, exportStep: false }, false, false, { id: constraintId, registered })
    const sparse = (n: Net): SerializedPoleEdit[] => n.poles.flatMap((point, index) =>
      point.some((x, d) => !Object.is(x, sourceNet.poles[index][d])) ? [{ index, point: encodeRecipePoint(point) }] : [])
    const choice = registered.request.choice
    const recipe: SurfaceEditRecipeV6 = {
      schema: 'tmar.surface-edit', version: 6, engine: 'occt-wasm-5.7.1/brep-v3', units: 'mm', coordinateFrame: 'imported-step',
      source: { bodyId, brepSha256: '', faceCount: this.faces.length, solidCount: this.solids }, faceIndex: this.chosen,
      preparation: 'native-nurbs', baseNetSha256: '', continuity, boundaryMode: 'locked', refinements: [], edits: sparse(next), lockedPoles: locks,
      curvedTangency: { kind: 'compatible-bspline', supportFaceIndex: choice.supportFaceIndex, edgeIndex: choice.edgeIndex,
        side: choice.side, supportSide: choice.supportSide, reverseSupport: choice.reverseSupport,
        scale: registered.request.scale ?? 1, distanceTolerance: registered.request.distanceTolerance ?? 1e-8,
        derivativeTolerance: registered.request.derivativeTolerance ?? 1e-8, supportNetSha256: '',
        initialLockedPoles: [...(registered.request.lockedPoles ?? [])], proposalBaseEdits: sparse(registered.request.baseNet),
        acceptedReferenceEdits: sparse(registered.referenceNet) },
    }
    ;[recipe.source.brepSha256, recipe.baseNetSha256, recipe.curvedTangency.supportNetSha256] =
      await Promise.all([sha256(this.brep), sha256(JSON.stringify(sourceNet)), sha256(JSON.stringify(registered.supportNet))])
    if (this.revision !== rev || this.previewRevision !== preview || this.anchorSelectionRevision !== anchor ||
        this.g1CurvedConstraints.get(constraintId) !== registered) throw new Error('Sessione cambiata durante il salvataggio della ricetta G1 B-spline.')
    return readCurvedRecipe(recipe)
  }
  private async prepareRecipe(step: string, value: unknown, bodyId: string, exportStep = false, curved = false, adaptive = false, adaptiveLocked = false): Promise<RecipeRestoreResult> {
    if (adaptiveLocked && (adaptive || curved)) throw new Error('Politiche di ripristino incompatibili.')
    if (curved && adaptive) throw new Error('Politiche di ripristino incompatibili.')
    const recipe = adaptiveLocked ? readAdaptiveLockedRecipe(value) : adaptive ? readAdaptiveTrimRecipe(value) : curved ? readCurvedRecipe(value) : readRecipe(value)
    if (recipe.source.bodyId !== bodyId) throw new Error('Corpo sorgente diverso dalla ricetta.')
    const opened = this.open(step), rev = this.revision
    const fingerprint = await sha256(this.brep)
    if (this.revision !== rev) throw new Error('Sorgente cambiata durante il ripristino.')
    if (fingerprint !== recipe.source.brepSha256 || this.faces.length !== recipe.source.faceCount || this.solids !== recipe.source.solidCount) throw new Error('Geometria sorgente cambiata: ricollegare esplicitamente la modifica della superficie.')
    const ops = recipe.version === 4 || recipe.version === 5 || recipe.version === 6 || recipe.version === 7 || recipe.version === 8 ? recipe.refinements : []
    const net = adaptive || adaptiveLocked ? this.prepareSelection(recipe.faceIndex,ops,false,true) : this.select(recipe.faceIndex,ops), selectedRevision = this.revision
    const baseFingerprint = await sha256(JSON.stringify(net))
    if (this.revision !== selectedRevision) throw new Error('Faccia cambiata durante il ripristino.')
    if (baseFingerprint !== recipe.baseNetSha256 || this.preparation() !== recipe.preparation) throw new Error('Base NURBS o raffinamento diverso dalla ricetta.')
    const info = this.infos[this.chosen]
    const preparation: SurfacePreparation = { face: this.chosen, refinements: structuredClone(this.refinements), originalNet: structuredClone(net),
      trimLocks: [...info.trimLocks], hiddenPoles: [...info.hiddenPoles] }
    if (recipe.version === 6) {
      const constraint = recipe.curvedTangency
      const apply = (edits: SerializedPoleEdit[]): Net => {
        const result = structuredClone(net)
        for (const edit of edits) {
          if (edit.index >= result.poles.length) throw new Error('La ricetta contiene un polo inesistente.')
          result.poles[edit.index] = decodeRecipePoint(edit.point)
        }
        return result
      }
      const baseNet = apply(constraint.proposalBaseEdits), reference = apply(constraint.acceptedReferenceEdits), final = apply(recipe.edits)
      if (constraint.initialLockedPoles.some(i => i >= net.poles.length)) throw new Error('Blocco iniziale G1 B-spline inesistente.')
      const choices = (await this.g1CurvedSupportCandidates()).candidates.filter(c => c.kind === constraint.kind &&
        c.supportFaceIndex === constraint.supportFaceIndex && c.edgeIndex === constraint.edgeIndex && c.side === constraint.side &&
        c.supportSide === constraint.supportSide && c.reverseSupport === constraint.reverseSupport)
      if (choices.length !== 1) throw new Error('Supporto originale della ricetta G1 B-spline non disponibile o ambiguo.')
      const resolved = await this.resolveG1CurvedSupportCandidate(choices[0])
      if (await sha256(JSON.stringify(resolved.supportNet)) !== constraint.supportNetSha256)
        throw new Error('Reticolo nativo del supporto originale diverso dalla ricetta G1 B-spline.')
      // Restore the accepted coefficients verbatim. Never run the projection
      // again, so repeated save/reopen cannot accumulate a tangency correction.
      const accepted = await this.publishG1CurvedTangency({ baseNet, net: reference, choice: choices[0],
        lockedPoles: constraint.initialLockedPoles, scale: constraint.scale, distanceTolerance: constraint.distanceTolerance,
        derivativeTolerance: constraint.derivativeTolerance })
      this.checkRecipePlaneLocks(this.g1CurvedConstraints.get(accepted.constraintId)!, recipe.lockedPoles)
      const evaluated = await this.evaluateG1CurvedTangency({ constraintId: accepted.constraintId, net: final,
        lockedPoles: recipe.lockedPoles, exportStep })
      return { faces: opened.faces, net: evaluated.net, preview: { ...evaluated.preview, ...(evaluated.step !== undefined ? { step: evaluated.step } : {}) },
        continuity: recipe.continuity, freeBoundary: false, lockedPoles: [...recipe.lockedPoles], preparation,
        curvedTangency: this.curvedSnapshot(accepted.constraintId) }
    }
    if (recipe.version === 5) {
      const constraint = recipe.planeTangency
      const apply = (edits: SerializedPoleEdit[]): Net => {
        const result = structuredClone(net)
        for (const edit of edits) {
          if (edit.index >= result.poles.length) throw new Error('La ricetta contiene un polo inesistente.')
          result.poles[edit.index] = decodeRecipePoint(edit.point)
        }
        return result
      }
      const baseNet = apply(constraint.proposalBaseEdits), reference = apply(constraint.acceptedReferenceEdits), final = apply(recipe.edits)
      if (constraint.initialLockedPoles.some(i => i >= net.poles.length)) throw new Error('Blocco iniziale G1 inesistente.')
      const choices = (await this.g1SupportCandidates()).candidates.filter(c => c.supportFaceIndex === constraint.supportFaceIndex &&
        c.edgeIndex === constraint.edgeIndex && c.side === constraint.side)
      if (choices.length !== 1) throw new Error('Supporto della ricetta G1 non disponibile o ambiguo.')
      // Publish the saved accepted coefficients, never regenerate a projection.
      const accepted = await this.publishG1PlaneTangency({ baseNet, net: reference, choice: choices[0],
        lockedPoles: constraint.initialLockedPoles, distanceTolerance: constraint.distanceTolerance })
      const registered = this.g1Constraints.get(accepted.constraintId)!
      this.checkRecipePlaneLocks(registered, recipe.lockedPoles)
      const evaluated = await this.evaluateG1PlaneTangency({ constraintId: accepted.constraintId, net: final,
        lockedPoles: recipe.lockedPoles, exportStep })
      return { faces: opened.faces, net: evaluated.net, preview: { ...evaluated.preview, ...(evaluated.step !== undefined ? { step: evaluated.step } : {}) },
        continuity: recipe.continuity, freeBoundary: false, lockedPoles: [...recipe.lockedPoles], preparation,
        planeTangency: this.planeSnapshot(accepted.constraintId) }
    }
    if ([...recipe.edits.map(e => e.index), ...recipe.lockedPoles].some(i => i >= net.poles.length)) throw new Error('La ricetta contiene un polo inesistente.')
    if (recipe.version === 7 && recipe.edits.some(e => recipe.lockedPoles.includes(e.index) && e.point.some((x,d)=>x!==net.poles[e.index][d])))
      throw new Error('La ricetta modifica un punto bloccato.')
    for (const edit of recipe.edits) net.poles[edit.index] = [...edit.point]
    if (recipe.version === 8) validateAdaptiveLocks(net,recipe.lockedValues)
    const freeBoundary = recipe.version === 3 || (recipe.version === 4 && recipe.boundaryMode === 'free-natural')
    const preview = this.evaluate(net, recipe.continuity, exportStep, freeBoundary)
    return { faces: opened.faces, net, preview, continuity: recipe.continuity, freeBoundary, lockedPoles: recipe.lockedPoles, preparation,
      ...(recipe.version === 8 ? {lockSnapshots:structuredClone(recipe.lockedValues)} : {}) }
  }
  /** Validate in isolation; failed restores leave the current edit untouched. */
  async restoreRecipe(step: string, recipe: unknown, bodyId: string) {
    return this.restoreRecipeIsolated(step, recipe, bodyId, false)
  }
  /** Not wired into the legacy worker/host: adoption requires the curved draft contract. */
  async restoreCurvedRecipe(step: string, recipe: unknown, bodyId: string): Promise<CurvedRecipeRestoreResult> {
    return this.restoreRecipeIsolated(step, recipe, bodyId, true) as Promise<CurvedRecipeRestoreResult>
  }
  /** Experimental v8 restore; commits only after isolated CAD verification. */
  async restoreAdaptiveLockedRecipe(step: string, recipe: unknown, bodyId: string): Promise<RecipeRestoreResult> {
    return this.restoreRecipeIsolated(step, recipe, bodyId, false, true)
  }
  private async restoreRecipeIsolated(step: string, recipe: unknown, bodyId: string, curved: boolean, adaptiveLocked = false): Promise<RecipeRestoreResult> {
    const temporary = new SurfaceEditorKernel(this.kernel), rev = this.revision, preview = this.previewRevision, anchor = this.anchorSelectionRevision
    try {
      const result = await temporary.prepareRecipe(step, recipe, bodyId, false, curved, false, adaptiveLocked)
      // Prepare all response/registration allocations before replacing the
      // live session. Temporary stamps and IDs must never escape restoration.
      let restoredConstraint: { id: number; registered: RegisteredPlaneTangency } | undefined
      let restoredCurved: { id: number; registered: RegisteredCurvedTangency } | undefined
      if (result.planeTangency && result.curvedTangency) throw new Error('Ripristino di vincoli G1 incompatibili.')
      if (result.curvedTangency) {
        const registered = structuredClone(temporary.g1CurvedConstraints.get(result.curvedTangency.constraintId)!)
        if (!registered || registered.kind !== 'compatible-bspline') throw new Error('Registrazione G1 B-spline ripristinata non disponibile.')
        const choice = registered.request.choice
        choice.stamp = { ...choice.stamp, sourceRevision: this.g1SourceRevision + 1,
          selectionRevision: this.g1SelectionRevision + 1, faceIndex: temporary.chosen }
        choice.id = JSON.stringify([choice.stamp.sourceId, choice.stamp.sourceRevision, choice.stamp.selectionRevision,
          choice.stamp.faceIndex, choice.kind, choice.supportFaceIndex, choice.edgeIndex, choice.side, choice.supportSide, choice.reverseSupport])
        const id = this.g1ConstraintSerial + 1
        if (![id, this.previewRevision + 1, choice.stamp.sourceRevision, choice.stamp.selectionRevision].every(n => Number.isSafeInteger(n) && n > 0))
          throw new Error('Limite degli identificativi o delle revisioni G1 B-spline raggiunto.')
        restoredCurved = { id, registered }
        // Snapshot from the temporary source's face count, but replace every
        // transient selection stamp/constraint ID with the new host generation.
        result.curvedTangency = temporary.curvedSnapshot(id, registered)
      }
      if (result.planeTangency) {
        const registered = structuredClone(temporary.g1Constraints.get(result.planeTangency.constraintId)!)
        if (!registered) throw new Error('Registrazione G1 ripristinata non disponibile.')
        const choice = registered.request.choice
        choice.stamp = { ...choice.stamp, sourceRevision: this.g1SourceRevision + 1,
          selectionRevision: this.g1SelectionRevision + 1, faceIndex: temporary.chosen }
        choice.id = JSON.stringify([choice.stamp.sourceId, choice.stamp.sourceRevision, choice.stamp.selectionRevision,
          choice.stamp.faceIndex, choice.supportFaceIndex, choice.edgeIndex])
        restoredConstraint = { id: this.g1ConstraintSerial + 1, registered }
        result.planeTangency = this.planeSnapshot(restoredConstraint.id, registered)
      }
      result.preview.previewRevision = this.previewRevision + 1
      if (this.revision !== rev || this.previewRevision !== preview || this.anchorSelectionRevision !== anchor)
        throw new Error('Sessione cambiata durante il ripristino.')
      this.clear()
      this.source = temporary.source; this.faces = temporary.faces
      this.brep = temporary.brep; this.records = temporary.records; this.recordsByFace = temporary.recordsByFace
      this.chosen = temporary.chosen; this.originalNet = temporary.originalNet; this.refinements = temporary.refinements
      this.adaptiveSelection = temporary.adaptiveSelection
      this.editBrep = temporary.editBrep; this.editRecord = temporary.editRecord
      this.solids = temporary.solids; this.infos = temporary.infos
      // clear() above creates a new host-owned generation. Transfer only the
      // verified source/selection state, never the temporary editor's revisions.
      this.g1SourceReady = temporary.g1SourceReady
      this.g1Selected = temporary.g1Selected
      this.g1Fingerprint = temporary.g1Fingerprint
      if (restoredConstraint) {
        this.g1ConstraintSerial = restoredConstraint.id
        this.g1Constraints.set(restoredConstraint.id, restoredConstraint.registered)
      }
      if (restoredCurved) {
        this.g1ConstraintSerial = restoredCurved.id
        this.g1CurvedConstraints.set(restoredCurved.id, restoredCurved.registered)
      }
      // Transfer handle ownership without disposing the shared OCCT runtime.
      this.validatedSheetBrep=temporary.validatedSheetBrep
      temporary.validatedSheetBrep=null
      this.validatedFace = temporary.validatedFace; temporary.validatedFace = null
      this.previewRevision++
      temporary.source = null; temporary.faces = []
      return result
    } finally { temporary.clear() }
  }
  /** Rebuild from upstream STEP without changing the interactive editing session. */
  async replayRecipe(step: string, recipe: unknown, bodyId: string) {
    const temporary = new SurfaceEditorKernel(this.kernel)
    try { return (await temporary.prepareRecipe(step, recipe, bodyId, true)).preview }
    finally { temporary.clear() }
  }
  /** Isolated explicit v6 replay, retaining the current source and note witness. */
  async replayCurvedRecipe(step: string, recipe: unknown, bodyId: string) {
    const temporary = new SurfaceEditorKernel(this.kernel)
    try { return (await temporary.prepareRecipe(step, recipe, bodyId, true, true)).preview }
    finally { temporary.clear() }
  }
  /** Isolated v7 research replay. Not exposed to the worker or application. */
  async replayAdaptiveRecipe(step: string, recipe: unknown, bodyId: string) {
    const temporary = new SurfaceEditorKernel(this.kernel)
    try { return (await temporary.prepareRecipe(step, recipe, bodyId, true, false, true)).preview }
    finally { temporary.clear() }
  }
  /** Isolated v8 replay preserves the positions at which points were locked. */
  async replayAdaptiveLockedRecipe(step: string, recipe: unknown, bodyId: string) {
    const temporary = new SurfaceEditorKernel(this.kernel)
    try { return (await temporary.prepareRecipe(step, recipe, bodyId, true, false, false, true)).preview }
    finally { temporary.clear() }
  }
  private releasePreviewFace() {
    this.validatedSheetBrep=null
    if (this.validatedFace !== null) this.kernel.release(this.validatedFace)
    this.validatedFace = null
  }
  private noteFace(previewRevision: number) {
    if (this.validatedFace === null || previewRevision !== this.previewRevision)
      throw new Error('Anteprima cambiata. Scegli il punto sulla faccia aggiornata.')
    return this.validatedFace
  }
  private withSheet<T>(revision:number,read:(sheet:ShapeHandle)=>T):T {
    const face=this.noteFace(revision)
    if (!this.infos[this.chosen]?.openSheet) throw new Error('La duplicazione richiede una superficie aperta.')
    if (!this.validatedSheetBrep) return read(face)
    const sheet=this.kernel.fromBREP(this.validatedSheetBrep)
    try {return read(sheet)} finally {this.kernel.release(sheet)}
  }
  sheetEdges(revision:number) { return this.withSheet(revision,s=>sheetEdgePaths(this.kernel,s)) }
  verifySheetEdgeVisibility(revision:number, candidates:readonly SheetEdgeVisibilityCandidate[], origin:Point, parallelDirection?:Point, clipping?:import('./sheetEdgeVisibilityCad').SheetEdgeClippingProof) {
    if (this.adaptiveSelection) throw new Error('Preparazione non qualificata per la verifica del bordo libero.')
    const pick = this.withSheet(revision, sheet => queryVisibleSheetEdge(this.kernel,sheet,candidates,origin,parallelDirection,clipping))
    return { face:this.chosen, previewRevision:revision, pick }
  }
  duplicateSheetEdge(revision:number,edge:number,delta:Point,previous:StripMove[]=[],expectedPath?:Point[]) {
    return this.withSheet(revision,s=>this.extendSequence(s,edge,delta,previous,expectedPath))
  }
  private extendSequence(shape:ShapeHandle,edge:number,delta:Point,previous:StripMove[],expectedPath?:Point[]) {
    const k=this.kernel, source=shape
    if(previous.length>=64) throw new Error('Raggiunto il limite di 64 estensioni per bozza.')
    try {
      let addedArea=0
      const moves:StripMove[]=[]
      for(const move of [...previous,{edge,delta,path:expectedPath}]){
        const paths=sheetEdgePaths(k,shape)
        let index=move.edge
        if(move.path){
          const path=move.path
          const matches=paths.flatMap((p,i)=>p.length===path.length && (
            p.every((q,j)=>dist(q,path[j])<1e-7) || p.every((q,j)=>dist(q,path[p.length-1-j])<1e-7))?[i]:[])
          if(matches.length!==1)throw new Error('Il bordo libero non è più identificabile.')
          index=matches[0]
        }
        const next=extendSheet(k,shape,index,move.delta)
        if(shape!==source)k.release(shape)
        shape=next.shell;addedArea=next.addedArea
        moves.push({edge:index,delta:move.delta,path:paths[index]})
      }
      return {step:k.exportStep(shape),addedArea,totalArea:k.getSurfaceArea(shape),
        paths:sheetEdgePaths(k,shape),preview:this.render(shape),moves}
    } finally {if(shape!==source)k.release(shape)}
  }
  finalFaceWitness(previewRevision: number) {
    const face = this.noteFace(previewRevision)
    return { face: this.chosen, selectionRevision: this.anchorSelectionRevision, previewRevision,
      faceBrep: this.kernel.toBREP(face) }
  }
  /** Export an independent CAD face from the current validated solid preview. */
  duplicateCadFace(previewRevision: number) {
    const face = this.noteFace(previewRevision), k = this.kernel
    if (this.solids !== 1 || this.adaptiveSelection || !this.netFor(this.chosen, this.refinements).natural)
      throw new Error('Duplica faccia richiede una faccia naturale di un singolo solido.')
    const owned: ShapeHandle[] = []
    const own = (shape: ShapeHandle) => { owned.push(shape); return shape }
    try {
      // STEP export uses a private BREP copy so it cannot update the live face.
      const copy = own(k.fromBREP(k.toBREP(face)))
      if (k.getShapeType(copy) !== 'face' || !k.isValid(copy))
        throw new Error('Copia CAD della faccia non valida.')
      const step = k.exportStep(copy), imported = own(k.importStep(step))
      const faces = k.getSubShapes(imported, 'face')
      owned.push(...faces)
      if (!k.isValid(imported) || faces.length !== 1 || k.subShapeCount(imported, 'solid') !== 0)
        throw new Error('Lo STEP deve contenere una sola faccia CAD aperta.')
      const result = faces[0], before = this.ownFaceSupport(face)?.net, after = this.ownFaceSupport(result)?.net
      const orientation = k.shapeOrientation(face)
      if (!before || !after || !this.sameCurvedNet(before, after, true) ||
          !['forward', 'reversed'].includes(orientation) || orientation !== k.shapeOrientation(result))
        throw new Error('Supporto NURBS o orientamento della faccia duplicata diverso.')
      const bounds = k.uvBounds(face), reopened = k.uvBounds(result)
      const uvBefore = [bounds.uMin, bounds.uMax, bounds.vMin, bounds.vMax]
      const uvAfter = [reopened.uMin, reopened.uMax, reopened.vMin, reopened.vMax]
      if (uvBefore.some((x,i) => !Number.isFinite(x) || !Number.isFinite(uvAfter[i]) || Math.abs(x - uvAfter[i]) > 1e-8))
        throw new Error('Dominio UV della faccia duplicata diverso.')
      if (k.subShapeCount(face, 'wire') !== 1 || k.subShapeCount(result, 'wire') !== 1 ||
          k.subShapeCount(face, 'edge') !== 4 || k.subShapeCount(result, 'edge') !== 4)
        throw new Error('Contorno naturale della faccia duplicata non verificabile.')
      this.checkPlanarTrims(face, result, 'Duplica faccia')
      for (const u of [.25,.5,.75]) for (const v of [.25,.5,.75]) {
        const atU = bounds.uMin + u * (bounds.uMax - bounds.uMin), atV = bounds.vMin + v * (bounds.vMax - bounds.vMin)
        if (k.classifyPointOnFace(face, atU, atV) !== 'in' || k.classifyPointOnFace(result, atU, atV) !== 'in')
          throw new Error('Regione interna della faccia duplicata non verificabile.')
      }
      return { face:this.chosen, selectionRevision:this.anchorSelectionRevision, previewRevision, step }
    } finally { owned.reverse().forEach(shape => k.release(shape)) }
  }

  verifyBoundaryVisibility(previewRevision:number,candidates:BoundaryCadCandidate[],origin:Point,parallelDirection?:Point){
    const face=this.noteFace(previewRevision)
    if(this.solids || this.faces.length!==1 || !this.infos[this.chosen]?.freeBoundary || this.adaptiveSelection ||
      !Array.isArray(candidates)||!candidates.length||candidates.length>4||new Set(candidates.map(c=>c.side)).size!==candidates.length)
      throw Error('Verifica bordo limitata a una singola faccia naturale aperta.')
    return {face:this.chosen,previewRevision,results:candidates.map(candidate=>({side:candidate.side,
      ...queryBoundaryVisibilityCad(this.kernel,face,candidate.side,candidate.seed,origin,candidate.segment,parallelDirection)}))}
  }
  pickWholeFaceFromRay(previewRevision:number,input:WholeFaceRayPickInput){
    const face=this.noteFace(previewRevision)
    if(this.solids!==0||this.faces.length!==1||!this.infos[this.chosen]?.freeBoundary||this.adaptiveSelection)
      throw new Error('Selezione limitata a una singola faccia naturale aperta.')
    return {face:this.chosen,selectionRevision:this.anchorSelectionRevision,previewRevision,
      ...queryWholeFaceRayPickCad(this.kernel,face,input)}
  }
  resolveAnchor(anchor: DraftAnchor, previewRevision: number) {
    const face = this.noteFace(previewRevision), k = this.kernel
    if (anchor.face !== this.chosen || anchor.selectionRevision !== this.anchorSelectionRevision ||
        !Number.isFinite(anchor.u) || !Number.isFinite(anchor.v))
      throw new Error('Riferimento della nota estraneo alla faccia attiva.')
    const location = k.classifyPointOnFace(face,anchor.u,anchor.v)
    if (location !== 'in' && location !== 'on') throw new Error('Il punto cade fuori dalla faccia o dentro un foro.')
    const at = tuple(k.pointOnSurface(face,anchor.u,anchor.v)), normal = orientedSurfaceNormal(k, face, anchor.u, anchor.v)
    if (!at.every(Number.isFinite)) throw new Error('Posizione della nota non determinata.')
    return { at, normal }
  }
  anchorFromPick(point: Point, previewRevision: number) {
    const face = this.noteFace(previewRevision)
    if (point.length !== 3 || !point.every(Number.isFinite)) throw new Error('Punto della nota non valido.')
    const uv = this.kernel.uvFromPoint(face,{x:point[0],y:point[1],z:point[2]})
    const anchor = { face:this.chosen, selectionRevision:this.anchorSelectionRevision, u:uv.u, v:uv.v }
    const placement = this.resolveAnchor(anchor,previewRevision)
    // A visible tessellated triangle is only the pick seed; reject unrelated
    // geometry instead of silently taking the nearest face across the part.
    if (dist(point,placement.at)>0.16) throw new Error('Il punto selezionato è distante dalla faccia CAD.')
    return {anchor,...placement}
  }
  private render(shape: ShapeHandle): Preview {
    const k = this.kernel, faces = k.getSubShapes(shape, 'face')
    try { return { mesh: k.tessellate(shape, { linearDeflection: 0.08, angularDeflection: 0.15 }), faceMeshes: faces.map(f => k.tessellate(f, { linearDeflection: 0.08, angularDeflection: 0.15 })), valid: k.isValid(shape), volume: this.solids ? k.getVolume(shape) : 0, maxBoundaryError: 0, minimumNormalDot: 1 } }
    finally { faces.forEach(f => k.release(f)) }
  }
  evaluate(net: Net, continuity: 'G0' | 'G1', exportStep = false, freeBoundary = false) {
    if (!this.source || !this.originalNet || this.chosen < 0) throw new Error('Seleziona prima una faccia.')
    if (typeof freeBoundary !== 'boolean' || !['G0', 'G1'].includes(continuity)) throw new Error('Modalità bordo non valida.')
    this.releasePreviewFace()
    if (freeBoundary && !this.infos[this.chosen].freeBoundary)
      throw new Error('Il bordo libero richiede una sola faccia aperta con contorno naturale rettangolare.')
    assertNet(this.originalNet, net, continuity, freeBoundary)
    for (const i of this.infos[this.chosen].trimLocks) {
      if (net.poles[i].some((x,d) => x !== this.originalNet!.poles[i][d])) throw new Error('Polo protetto dal contorno ritagliato.')
    }
    const k = this.kernel, baseFace = this.faces[this.chosen], text = replaceSurface(this.editBrep, this.editRecord!, net)
    let edited = k.fromBREP(text)
    if (freeBoundary) {
      const old = edited, supports = k.getSubShapes(old, 'face')
      try {
        if (supports.length !== 1) throw new Error('Impossibile identificare la superficie del bordo libero.')
        edited = rebuildFreeBoundary(k, supports[0], net)
      } catch (e) { k.release(old); throw e }
      finally { supports.forEach(face => k.release(face)) }
      k.release(old)
    }
    const fs = k.getSubShapes(edited, 'face')
    try {
      if (!k.isValid(edited) || fs.length !== this.faces.length || this.count(edited, 'solid') !== this.solids) throw new Error('Modifica rifiutata: CAD non valido o topologia alterata.')
      const face = fs[this.chosen], b = k.uvBounds(baseFace)
      // BRepCheck alone does not exclude a face crossing the opposite wall.
      // Intersect the exact CAD faces; only their original boundary is allowed.
      const boundaries = k.getSubShapes(baseFace, 'wire')
      const checkPoint = (p: { x: number; y: number; z: number }) => {
        const vertex = k.makeVertex(p.x, p.y, p.z)
        try {
          if (!boundaries.some(w => k.distanceBetween(vertex, w) <= 1e-6)) throw new Error('Modifica rifiutata: la superficie interseca un’altra faccia fuori dal bordo originale.')
        } finally { k.release(vertex) }
      }
      try {
        for (let f = 0; f < fs.length; f++) if (f !== this.chosen) {
          const section = k.section(face, fs[f])
          const edges = k.getSubShapes(section, 'edge'), vertices = k.getSubShapes(section, 'vertex')
          try {
            if (vertices.length && k.distanceBetween(baseFace, this.faces[f]) > 1e-6) throw new Error('Modifica rifiutata: la superficie attraversa una faccia non adiacente.')
            for (const edge of edges) {
              const t = k.curveParameters(edge)
              for (let i = 0; i <= 16; i++) checkPoint(k.curvePointAtParam(edge, t.first + (t.last - t.first) * i / 16))
            }
          } finally { [...edges, ...vertices].forEach(h => k.release(h)); k.release(section) }
        }
      } finally { boundaries.forEach(h => k.release(h)) }
      let maxBoundaryError = 0, minimumNormalDot = 1
      for (let i = 0; i <= 16; i++) for (let j = 0; j <= 16; j++) {
        const u = b.uMin + (b.uMax - b.uMin) * i / 16, v = b.vMin + (b.vMax - b.vMin) * j / 16
        const p = tuple(k.pointOnSurface(face, u, v)), q = tuple(k.pointOnSurface(baseFace, u, v))
        const a = tuple(k.surfaceNormal(face, u, v)), c = tuple(k.surfaceNormal(baseFace, u, v))
        const dot = a.reduce((s, x, d) => s + x * c[d], 0)
        if (!Number.isFinite(dot) || dot < 0.05) throw new Error('Deformazione troppo forte: normale ribaltata o superficie singolare.')
        minimumNormalDot = Math.min(minimumNormalDot, dot)
        if (i === 0 || i === 16 || j === 0 || j === 16) {
          maxBoundaryError = Math.max(maxBoundaryError, dist(p, q))
          if (!freeBoundary && continuity === 'G1' && dot < 1 - 1e-8) throw new Error('La modifica non conserva la tangente sul bordo.')
        }
      }
      if (!freeBoundary && maxBoundaryError > 1e-6) throw new Error('Il bordo si è mosso: modifica non applicabile al solido.')
      const volume = this.solids ? k.getVolume(edited) : 0
      if (!Number.isFinite(volume) || (this.solids && volume <= 0)) throw new Error('Volume non valido.')
      const step = exportStep ? k.exportStep(edited) : undefined
      const preview = this.render(edited)
      // Transfer this one subshape handle. The finally block releases the others.
      if(this.infos[this.chosen].openSheet && fs.length>1)this.validatedSheetBrep=text
      this.validatedFace = fs.splice(this.chosen,1)[0]
      return { ...preview, volume, maxBoundaryError, minimumNormalDot, step, previewRevision: ++this.previewRevision }
    } finally { fs.forEach(f => k.release(f)); k.release(edited) }
  }
  clear() { this.g1SourceRevision++; this.g1Fingerprint = null; this.g1SourceReady = false; this.invalidateG1Selection(); this.releasePreviewFace(); this.revision++; this.anchorSelectionRevision++; this.faces.forEach(f => this.kernel.release(f)); this.faces = []; if (this.source) this.kernel.release(this.source); this.source = null; this.chosen = -1; this.originalNet = null; this.refinements = []; this.adaptiveSelection = false }
  dispose() { this.clear(); if (this.ownsKernel) this.kernel[Symbol.dispose]() }
}
