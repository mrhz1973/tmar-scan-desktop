// SPDX-License-Identifier: AGPL-3.0-only
import { OcctKernel, type Mesh, type BoundingBox, type ShapeHandle } from 'occt-wasm'
import { assertNet, boundaryLocked, enrichBicubic, perforatedPlaneNet, planeNet, replaceSurface, signature, surfaceTable, type Net, type Point, type RecordSpan } from './brep'
import { readRecipe, sha256, type SurfaceEditRecipe } from './recipe'
import { refineClampedNet, type KnotInsertion } from './refineClampedNet'

import { extendSheet, sheetEdgePaths, type StripMove } from './sheetExtension'
import { rebuildFreeBoundary } from './freeBoundary'
import { prepareCylinder } from './cylinderPreparation'
import { assertSimpleCylinderSource } from './cylinderSource'
import { listG1SupportCandidates, resolveG1SupportCandidate as resolveSupport, type G1SourceStamp, type G1SupportCandidate } from './g1SupportTopology'

export interface FaceInfo { index: number; kind: string; reason: string | null; converted: boolean; enriched: boolean; openSheet: boolean; freeBoundary: boolean; trimLocks: number[]; hiddenPoles: number[]; experimentalCylinder?: boolean }
export interface G1SupportCandidates { stamp: G1SourceStamp; candidates: G1SupportCandidate[] }
export interface DraftAnchor { face: number; selectionRevision: number; u: number; v: number }
export interface Preview { previewRevision?: number; mesh: Mesh; faceMeshes: Mesh[]; valid: boolean; volume: number; maxBoundaryError: number; minimumNormalDot: number }
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
function outerEdgeBoxes(k: OcctKernel, edge: ShapeHandle): BoundingBox[] {
  if (k.curveType(edge) !== 'circle') return [k.getBoundingBox(edge,{useTriangulation:false})]
  const {first,last} = k.curveParameters(edge)
  const count = Math.max(1,Math.ceil(Math.abs(last-first)/(Math.PI/12)))
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
  private faces: ShapeHandle[] = []
  private brep = ''
  private records: RecordSpan[] = []
  private recordsByFace: number[] = []
  private chosen = -1
  private originalNet: Net | null = null
  private refinements: KnotInsertion[] = []
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
    this.invalidateG1Selection()
    if(!this.source) throw new Error('Apri prima un corpo CAD.')
    return prepareCylinder(this.kernel,this.source,face)
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
      return { index, trimLocks, hiddenPoles, openSheet, freeBoundary: openSheet && this.faces.length === 1 && natural, kind: k.surfaceType(face), reason, converted: record?.kind === 1,
        enriched: !!record?.net && enrichBicubic(record.net) !== record.net, experimentalCylinder }
    })
    const preview = this.render(this.source)
    this.g1SourceReady = true
    return { faces: this.infos, preview }
  }
  private netFor(index: number, refinements: readonly KnotInsertion[] = []) {
    const face = this.faces[index], id = this.recordsByFace[index], r = this.records[id], k = this.kernel
    if (!face || !r) throw new Error('Superficie ambigua o condivisa: non modificabile.')
    if (this.recordsByFace.filter(n => n === id).length !== 1) throw new Error('Superficie condivisa da più facce.')
    if (r.kind !== 1 && !r.net) throw new Error('Prototipo: solo piani e B-spline non periodiche.')
    const wires = k.getSubShapes(face, 'wire'), outer = k.outerWire(face), edges = k.getSubShapes(outer, 'edge')
    try {
      const inner = wires.filter(w => !k.isSame(w, outer))
      if (!edges.length) throw new Error('Contorno esterno privo di bordi.')
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
      if (!rectangular || partial) for (const edge of edges) trimBoxes.push(...outerEdgeBoxes(k,edge))

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
  private checkPlanarTrims(before: ShapeHandle, after: ShapeHandle) {
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
      if (match < 0) throw new Error('Conversione piana: contorno alterato.')
      pending.splice(match,1)
    }
    if (pending.length) throw new Error('Conversione piana: contorno aggiunto.')
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
  /** Reprepare the active face without invalidating its UV anchors. Switching
   * face still starts a new logical selection; failed preparation commits neither. */
  selectRefined(index: number, refinements: readonly KnotInsertion[] = []) {
    return this.prepareSelection(index, refinements, true)
  }
  private prepareSelection(index: number, refinements: readonly KnotInsertion[], preserveAnchors: boolean) {
    this.invalidateG1Selection()
    const info = this.netFor(index, refinements), net = info.net, record = this.records[this.recordsByFace[index]], k = this.kernel
    let text = this.brep, editRecord = record
    if (record.kind === 1) {
      // STEP readers may omit planar pcurves (derived implicitly on a plane).
      // Materialize them on the EXACT, still planar NURBS before any edit.
      // Never heal a deformed result. Reject any geometric/topological change.
      const converted = k.fromBREP(replaceSurface(this.brep, record, net))
      const prepared = k.fixShape(converted), fs = k.getSubShapes(prepared, 'face')
      try {
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
      } finally { fs.forEach(f => k.release(f)); k.release(prepared); k.release(converted) }
    }
    this.releasePreviewFace()
    this.revision++
    if (!preserveAnchors || this.chosen !== index) this.anchorSelectionRevision++
    this.chosen = index; this.originalNet = structuredClone(net); this.editBrep = text; this.editRecord = editRecord
    this.g1Selected = index
    this.refinements = structuredClone(refinements) as KnotInsertion[]
    this.infos[index] = { ...this.infos[index], trimLocks: info.trimLocks, hiddenPoles: info.hiddenPoles }
    return net
  }
  private invalidateG1Selection() { this.g1Selected = -1; this.g1SelectionRevision++ }
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
  private preparation(): SurfaceEditRecipe['preparation'] {
    const info = this.infos[this.chosen]
    return info.converted ? 'plane-to-bicubic' : info.enriched ? 'bicubic-midpoint-refinement' : 'native-nurbs'
  }
  /** Persist only after exact CAD validation. The host supplies its stable body ID. */
  async createRecipe(net: Net, continuity: 'G0' | 'G1', lockedPoles: number[], bodyId: string, freeBoundary = false): Promise<SurfaceEditRecipe> {
    if (!this.originalNet || !this.source) throw new Error('Seleziona prima una faccia.')
    if (typeof freeBoundary !== 'boolean' || !['G0', 'G1'].includes(continuity)) throw new Error('Modalità bordo non valida.')
    const base = structuredClone(this.originalNet), next = structuredClone(net), rev = this.revision
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
    if (this.revision !== rev) throw new Error('Sorgente cambiata durante il salvataggio della ricetta.')
    const checked = readRecipe(recipe)
    if (checked.lockedPoles.some(i => i >= base.poles.length)) throw new Error('Blocco di un polo inesistente.')
    this.evaluate(next, continuity, false, freeBoundary)
    return checked
  }
  private async prepareRecipe(step: string, value: unknown, bodyId: string, exportStep = false) {
    const recipe = readRecipe(value)
    if (recipe.source.bodyId !== bodyId) throw new Error('Corpo sorgente diverso dalla ricetta.')
    const opened = this.open(step), rev = this.revision
    const fingerprint = await sha256(this.brep)
    if (this.revision !== rev) throw new Error('Sorgente cambiata durante il ripristino.')
    if (fingerprint !== recipe.source.brepSha256 || this.faces.length !== recipe.source.faceCount || this.solids !== recipe.source.solidCount) throw new Error('Geometria sorgente cambiata: ricollegare esplicitamente la modifica della superficie.')
    const net = this.select(recipe.faceIndex, recipe.version === 4 ? recipe.refinements : []), selectedRevision = this.revision
    const baseFingerprint = await sha256(JSON.stringify(net))
    if (this.revision !== selectedRevision) throw new Error('Faccia cambiata durante il ripristino.')
    if (baseFingerprint !== recipe.baseNetSha256 || this.preparation() !== recipe.preparation) throw new Error('Base NURBS o raffinamento diverso dalla ricetta.')
    if ([...recipe.edits.map(e => e.index), ...recipe.lockedPoles].some(i => i >= net.poles.length)) throw new Error('La ricetta contiene un polo inesistente.')
    for (const edit of recipe.edits) net.poles[edit.index] = [...edit.point]
    const freeBoundary = recipe.version === 3 || (recipe.version === 4 && recipe.boundaryMode === 'free-natural')
    const preview = this.evaluate(net, recipe.continuity, exportStep, freeBoundary)
    return { faces: opened.faces, net, preview, continuity: recipe.continuity, freeBoundary, lockedPoles: recipe.lockedPoles }
  }
  /** Validate in isolation; failed restores leave the current edit untouched. */
  async restoreRecipe(step: string, recipe: unknown, bodyId: string) {
    const temporary = new SurfaceEditorKernel(this.kernel), rev = this.revision
    try {
      const result = await temporary.prepareRecipe(step, recipe, bodyId)
      if (this.revision !== rev) throw new Error('Sessione cambiata durante il ripristino.')
      this.clear()
      this.source = temporary.source; this.faces = temporary.faces
      this.brep = temporary.brep; this.records = temporary.records; this.recordsByFace = temporary.recordsByFace
      this.chosen = temporary.chosen; this.originalNet = temporary.originalNet; this.refinements = temporary.refinements
      this.editBrep = temporary.editBrep; this.editRecord = temporary.editRecord
      this.solids = temporary.solids; this.infos = temporary.infos
      // clear() above creates a new host-owned generation. Transfer only the
      // verified source/selection state, never the temporary editor's revisions.
      this.g1SourceReady = temporary.g1SourceReady
      this.g1Selected = temporary.g1Selected
      this.g1Fingerprint = temporary.g1Fingerprint
      // Transfer handle ownership without disposing the shared OCCT runtime.
      this.validatedSheetBrep=temporary.validatedSheetBrep
      this.validatedFace = temporary.validatedFace; temporary.validatedFace = null
      result.preview.previewRevision = ++this.previewRevision
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
  clear() { this.g1SourceRevision++; this.g1Fingerprint = null; this.g1SourceReady = false; this.invalidateG1Selection(); this.releasePreviewFace(); this.revision++; this.anchorSelectionRevision++; this.faces.forEach(f => this.kernel.release(f)); this.faces = []; if (this.source) this.kernel.release(this.source); this.source = null; this.chosen = -1; this.originalNet = null; this.refinements = [] }
  dispose() { this.clear(); if (this.ownsKernel) this.kernel[Symbol.dispose]() }
}
