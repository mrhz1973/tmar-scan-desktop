// SPDX-License-Identifier: AGPL-3.0-only
import { OcctKernel, type Mesh, type ShapeHandle } from 'occt-wasm'
import { assertNet, enrichBicubic, planeNet, replaceSurface, signature, surfaceTable, type Net, type Point, type RecordSpan } from './brep'
import { readRecipe, sha256, type SurfaceEditRecipe } from './recipe'

export interface FaceInfo { index: number; kind: string; reason: string | null; converted: boolean; enriched: boolean }
export interface Preview { mesh: Mesh; faceMeshes: Mesh[]; valid: boolean; volume: number; maxBoundaryError: number; minimumNormalDot: number }
const tuple = (p: { x: number; y: number; z: number }): Point => [p.x, p.y, p.z]
const dist = (a: Point, b: Point) => Math.hypot(...a.map((x, i) => x - b[i]))
export class SurfaceEditorKernel {
  private source: ShapeHandle | null = null
  private faces: ShapeHandle[] = []
  private brep = ''
  private records: RecordSpan[] = []
  private recordsByFace: number[] = []
  private chosen = -1
  private originalNet: Net | null = null
  private editBrep = ''
  private editRecord: RecordSpan | null = null
  private solids = 0
  private revision = 0
  infos: FaceInfo[] = []
  /** Injected kernels are borrowed; load() creates an editor-owned runtime. */
  constructor(readonly kernel: OcctKernel, private readonly ownsKernel = false) {}
  static async load(wasm?: string) { return new SurfaceEditorKernel(await OcctKernel.init(wasm ? { wasm } : undefined), true) }
  private count(s: ShapeHandle, type: 'solid' | 'shell' | 'face') { const a = this.kernel.getSubShapes(s, type); const n = a.length; a.forEach(h => this.kernel.release(h)); return n }
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
    this.infos = this.faces.map((face, index) => {
      let reason: string | null = null
      try { this.netFor(index) } catch (e) { reason = e instanceof Error ? e.message : String(e) }
      const record = this.records[this.recordsByFace[index]]
      return { index, kind: k.surfaceType(face), reason, converted: record?.kind === 1,
        enriched: !!record?.net && enrichBicubic(record.net) !== record.net }
    })
    return { faces: this.infos, preview: this.render(this.source) }
  }
  private netFor(index: number): Net {
    const face = this.faces[index], id = this.recordsByFace[index], r = this.records[id], k = this.kernel
    if (!face || !r) throw new Error('Superficie ambigua o condivisa: non modificabile.')
    if (this.recordsByFace.filter(n => n === id).length !== 1) throw new Error('Superficie condivisa da più facce.')
    if (r.kind !== 1 && !r.net) throw new Error('Prototipo: solo piani e B-spline non periodiche.')
    const wires = k.getSubShapes(face, 'wire'), edges = k.getSubShapes(face, 'edge')
    try {
      if (wires.length !== 1 || edges.length !== 4) throw new Error('Prototipo: serve una faccia rettangolare senza fori né trim interni.')
      const b = k.uvBounds(face), bounds: [number, number, number, number] = [b.uMin, b.uMax, b.vMin, b.vMax]
      if (bounds.some(x => !Number.isFinite(x)) || b.uMax <= b.uMin || b.vMax <= b.vMin) throw new Error('Dominio della faccia non valido.')
      const epsU = 1e-7 * Math.max(1, b.uMax - b.uMin), epsV = 1e-7 * Math.max(1, b.vMax - b.vMin)
      // Each of the four trimmed edges must lie on ONE natural parameter bound.
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
      if (sides.includes(-1) || new Set(sides).size !== 4) throw new Error('Bordi ritagliati non coincidenti con il dominio naturale: editing protetto non disponibile.')
      const net = r.kind === 1 ? planeNet(r, bounds) : structuredClone(r.net!)
      if (net.mu[0] !== net.du + 1 || net.mu.at(-1) !== net.du + 1 || net.mv[0] !== net.dv + 1 || net.mv.at(-1) !== net.dv + 1) throw new Error('Servono nodi estremi clamped.')
      if (Math.abs(net.ku[0] - b.uMin) > epsU || Math.abs(net.ku.at(-1)! - b.uMax) > epsU || Math.abs(net.kv[0] - b.vMin) > epsV || Math.abs(net.kv.at(-1)! - b.vMax) > epsV) throw new Error('Il trim non coincide con il dominio NURBS.')
      if (net.nu * net.nv > 1600) throw new Error('Reticolo oltre 1600 punti: non interattivo in questo prototipo.')
      return net
    } finally { [...wires, ...edges].forEach(h => k.release(h)) }
  }
  select(index: number) {
    const net = enrichBicubic(this.netFor(index)), record = this.records[this.recordsByFace[index]], k = this.kernel
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
          if (Math.abs(k.getSurfaceArea(fs[f]) - k.getSurfaceArea(this.faces[f])) > 1e-6) throw new Error('Conversione piana: area alterata.')
          for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
            const u = b.uMin + (b.uMax - b.uMin) * i / 4, v = b.vMin + (b.vMax - b.vMin) * j / 4
            if (dist(tuple(k.pointOnSurface(fs[f], u, v)), tuple(k.pointOnSurface(this.faces[f], u, v))) > 1e-7) throw new Error('Conversione piana: geometria o ordine delle facce alterato.')
          }
        }
        text = k.toBREP(prepared)
        const found = surfaceTable(text).filter(r => r.net && JSON.stringify(r.net) === JSON.stringify(net))
        if (found.length !== 1) throw new Error('Impossibile identificare il reticolo convertito.')
        editRecord = found[0]
      } finally { fs.forEach(f => k.release(f)); k.release(prepared); k.release(converted) }
    }
    this.revision++
    this.chosen = index; this.originalNet = structuredClone(net); this.editBrep = text; this.editRecord = editRecord
    return net
  }
  private preparation(): SurfaceEditRecipe['preparation'] {
    const info = this.infos[this.chosen]
    return info.converted ? 'plane-to-bicubic' : info.enriched ? 'bicubic-midpoint-refinement' : 'native-nurbs'
  }
  /** Persist only after exact CAD validation. The host supplies its stable body ID. */
  async createRecipe(net: Net, continuity: 'G0' | 'G1', lockedPoles: number[], bodyId: string): Promise<SurfaceEditRecipe> {
    if (!this.originalNet || !this.source) throw new Error('Seleziona prima una faccia.')
    const base = structuredClone(this.originalNet), next = structuredClone(net), rev = this.revision
    assertNet(base, next, continuity)
    const recipe: SurfaceEditRecipe = {
      schema: 'tmar.surface-edit', version: 2, engine: 'occt-wasm-5.7.1/brep-v3',
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
    this.evaluate(next, continuity)
    return checked
  }
  private async prepareRecipe(step: string, value: unknown, bodyId: string, exportStep = false) {
    const recipe = readRecipe(value)
    if (recipe.source.bodyId !== bodyId) throw new Error('Corpo sorgente diverso dalla ricetta.')
    const opened = this.open(step), rev = this.revision
    const fingerprint = await sha256(this.brep)
    if (this.revision !== rev) throw new Error('Sorgente cambiata durante il ripristino.')
    if (fingerprint !== recipe.source.brepSha256 || this.faces.length !== recipe.source.faceCount || this.solids !== recipe.source.solidCount) throw new Error('Geometria sorgente cambiata: ricollegare esplicitamente la modifica della superficie.')
    const net = this.select(recipe.faceIndex), selectedRevision = this.revision
    const baseFingerprint = await sha256(JSON.stringify(net))
    if (this.revision !== selectedRevision) throw new Error('Faccia cambiata durante il ripristino.')
    if (baseFingerprint !== recipe.baseNetSha256 || this.preparation() !== recipe.preparation) throw new Error('Base NURBS o raffinamento diverso dalla ricetta.')
    if ([...recipe.edits.map(e => e.index), ...recipe.lockedPoles].some(i => i >= net.poles.length)) throw new Error('La ricetta contiene un polo inesistente.')
    for (const edit of recipe.edits) net.poles[edit.index] = [...edit.point]
    const preview = this.evaluate(net, recipe.continuity, exportStep)
    return { faces: opened.faces, net, preview, continuity: recipe.continuity, lockedPoles: recipe.lockedPoles }
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
      this.chosen = temporary.chosen; this.originalNet = temporary.originalNet
      this.editBrep = temporary.editBrep; this.editRecord = temporary.editRecord
      this.solids = temporary.solids; this.infos = temporary.infos
      // Transfer handle ownership without disposing the shared OCCT runtime.
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
  private render(shape: ShapeHandle): Preview {
    const k = this.kernel, faces = k.getSubShapes(shape, 'face')
    try { return { mesh: k.tessellate(shape, { linearDeflection: 0.08, angularDeflection: 0.15 }), faceMeshes: faces.map(f => k.tessellate(f, { linearDeflection: 0.08, angularDeflection: 0.15 })), valid: k.isValid(shape), volume: this.solids ? k.getVolume(shape) : 0, maxBoundaryError: 0, minimumNormalDot: 1 } }
    finally { faces.forEach(f => k.release(f)) }
  }
  evaluate(net: Net, continuity: 'G0' | 'G1', exportStep = false) {
    if (!this.source || !this.originalNet || this.chosen < 0) throw new Error('Seleziona prima una faccia.')
    assertNet(this.originalNet, net, continuity)
    const k = this.kernel, baseFace = this.faces[this.chosen], text = replaceSurface(this.editBrep, this.editRecord!, net)
    const edited = k.fromBREP(text), fs = k.getSubShapes(edited, 'face')
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
          if (continuity === 'G1' && dot < 1 - 1e-8) throw new Error('La modifica non conserva la tangente sul bordo.')
        }
      }
      if (maxBoundaryError > 1e-6) throw new Error('Il bordo si è mosso: modifica non applicabile al solido.')
      const volume = this.solids ? k.getVolume(edited) : 0
      if (!Number.isFinite(volume) || (this.solids && volume <= 0)) throw new Error('Volume non valido.')
      const step = exportStep ? k.exportStep(edited) : undefined
      return { ...this.render(edited), volume, maxBoundaryError, minimumNormalDot, step }
    } finally { fs.forEach(f => k.release(f)); k.release(edited) }
  }
  clear() { this.revision++; this.faces.forEach(f => this.kernel.release(f)); this.faces = []; if (this.source) this.kernel.release(this.source); this.source = null; this.chosen = -1; this.originalNet = null }
  dispose() { this.clear(); if (this.ownsKernel) this.kernel[Symbol.dispose]() }
}
