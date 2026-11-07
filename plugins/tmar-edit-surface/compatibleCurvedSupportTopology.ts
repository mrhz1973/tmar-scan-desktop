// SPDX-License-Identifier: AGPL-3.0-only
import type { OcctKernel, ShapeHandle } from 'occt-wasm'
import { signature, surfaceTable, type Net, type Point } from './brep'
import { associateSerializedEdgeCurve } from './experimentalEdgeCurveAssociation'
import { matchNaturalSideCurve } from './experimentalNaturalSideCurveMatch'
import type { G1SourceStamp, NaturalSide } from './g1SupportTopology'
import { refineClampedNet } from './refineClampedNet'
import { sha256 } from './recipe'

export interface CompatibleCurvedSupportCandidate {
  kind: 'compatible-bspline'
  id: string
  stamp: G1SourceStamp
  supportFaceIndex: number
  edgeIndex: number
  side: NaturalSide
  supportSide: NaturalSide
  reverseSupport: boolean
  lengthMm: number
}
export interface NaturalPcurveWitness {
  method: 'brep-v3-axis-aligned-line-pcurves'
  faceIndex: number
  surfaceSignature: string
  orientation: 'forward' | 'reversed'
  domain: [number, number, number, number]
  /** Indexed by the actual owning face's edge traversal, not curve proximity. */
  sides: { edgeIndex: number; side: NaturalSide; direction: 1 | -1; parameterRange: [number, number]; maxParameterResidual: number }[]
  parameterBudget: number
  geometricBudgetMm: 1e-8
  maxGeometricDeviationBound: number
}
export interface ResolvedCompatibleCurvedSupport {
  candidate: CompatibleCurvedSupportCandidate
  selectedNet: Net
  supportNet: Net
  selectedWitness: NaturalPcurveWitness
  supportWitness: NaturalPcurveWitness
}
export interface ExperimentalSharedBSplineEdge {
  kind: 'experimental-shared-bspline-edge'
  id: string
  stamp: G1SourceStamp
  supportFaceIndex: number
  edgeIndex: number
  supportEdgeIndex: number
  lengthMm: number
  degree: number
  selectedWitness: NaturalPcurveWitness
  supportWitness: NaturalPcurveWitness
}
function fail(reason: string): never { throw new Error(`Supporto curvo CAD rifiutato: ${reason}`) }
const eq = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]))
const finite = (s: string): number => { const n = Number(s); if (!s.trim() || !Number.isFinite(n)) fail('numero BREP non finito'); return n }
const integer = (s: string, min: number, max: number) => { const n = finite(s); if (!Number.isSafeInteger(n) || n < min || n > max) fail('indice BREP non valido'); return n }
const sides: NaturalSide[] = ['uMin', 'uMax', 'vMin', 'vMax']

type I = [number, number]
type V = [I, I, I]
const bytes = new BigUint64Array(1), floats = new Float64Array(bytes.buffer)
const scalar = (x: number): I => [x, x]
function next(x: number, up: boolean): number {
  if (!Number.isFinite(x)) fail('overflow del testimone parametrico')
  if (x === 0) return up ? Number.MIN_VALUE : -Number.MIN_VALUE
  floats[0] = x; bytes[0] += (x > 0) === up ? 1n : -1n
  return floats[0]
}
function enclose(lo: number, hi: number): I {
  const out: I = [next(lo, false), next(hi, true)]
  if (!out.every(Number.isFinite)) fail('overflow del testimone parametrico')
  return out
}
const add = (a: I, b: I): I => enclose(a[0] + b[0], a[1] + b[1])
const sub = (a: I, b: I): I => enclose(a[0] - b[1], a[1] - b[0])
function mul(a: I, b: I): I {
  const p = [a[0] * b[0], a[0] * b[1], a[1] * b[0], a[1] * b[1]]
  return enclose(Math.min(...p), Math.max(...p))
}
const abs = (x: I) => Math.max(Math.abs(x[0]), Math.abs(x[1]))
const l1 = (v: V) => v.reduce((sum, x) => add(scalar(sum), scalar(abs(x)))[1], 0)
function positiveDivide(a: I, b: I): I {
  if (!(b[0] > 0)) fail('intervallo parametrico non comprovabilmente positivo')
  return mul(a, enclose(1 / b[1], 1 / b[0]))
}

/** Polynomial derivative control hulls bound the displacement caused by ANY UV
 * residual over the whole native rectangle. Large UV offsets never increase
 * the allowed geometric error; ill-conditioned domains fail closed. */
function parameterBudgetFor(n: Net, domain: NaturalPcurveWitness['domain']) {
  const derivativeBound = (axis: 'U' | 'V') => {
    const isU = axis === 'U', degree = isU ? n.du : n.dv, count = isU ? n.nu : n.nv
    const knots = isU ? n.ku : n.kv, multiplicity = isU ? n.mu : n.mv
    const full = knots.flatMap((x, i) => Array<number>(multiplicity[i]).fill(x))
    let bound = 0
    for (let i = 0; i < count - 1; i++) {
      const factor = positiveDivide(scalar(degree), sub(scalar(full[i + degree + 1]), scalar(full[i + 1])))
      for (let j = 0; j < (isU ? n.nv : n.nu); j++) {
        const a = n.poles[isU ? i * n.nv + j : j * n.nv + i]
        const b = n.poles[isU ? (i + 1) * n.nv + j : j * n.nv + i + 1]
        const derivative = a.map((x, d) => mul(sub(scalar(b[d]), scalar(x)), factor)) as V
        bound = Math.max(bound, l1(derivative))
      }
    }
    return bound
  }
  // Numerical pcurves can lie infinitesimally outside the clamped rectangle.
  // Bound that extrapolation too: below 1e-10 of EVERY knot span, the absolute
  // Bernstein basis sum grows by at most (1+2e-10)^(du+dv) < 2 (degrees <=25).
  // Exact knot refinement is convex in-domain, so twice the derivative hull
  // encloses this tiny extension without assuming nonnegative bases outside.
  const derivativeSum = mul(add(scalar(derivativeBound('U')), scalar(derivativeBound('V'))), scalar(2))[1]
  if (!(derivativeSum > 0) || !Number.isFinite(derivativeSum)) fail('scala geometrica del dominio non verificabile')
  const span = Math.min(...[n.ku, n.kv].flatMap(k => k.slice(1).map((x, i) => sub(scalar(x), scalar(k[i]))[0])))
  if (!(span > 0)) fail('dominio parametrico degenere')
  const budget = Math.min(64 * Number.EPSILON * Math.max(1, ...domain.map(Math.abs)),
    mul(scalar(span), scalar(1e-10))[0], positiveDivide(scalar(1e-8), scalar(derivativeSum))[0])
  if (!(budget > 0) || !Number.isFinite(budget)) fail('dominio troppo malcondizionato per certificare i lati naturali')
  return { budget, derivativeSum }
}

interface Line2 { kind: 'line'; origin: [number, number]; direction: [number, number]; trims: [number, number][] }
interface Degree1Pcurve {
  kind: 'degree1-bspline'
  poles: [[number, number], [number, number]]
  knots: [number, number]
  trims: [number, number][]
}
type AxisPcurve = Line2 | Degree1Pcurve
/** Deliberately bounded BREP V3 parser. Unsupported UV curves are refused,
 * never approximated by sampled projection. Trimmed lines retain their ranges. */
function pcurves(text: string): AxisPcurve[] {
  const match = /^Curve2ds (\d+)\s*\n([\s\S]*?)^Curves /m.exec(text)
  if (!match) fail('tabella pcurve assente')
  const count = integer(match[1], 0, 100000), tokens = match[2].trim().split(/\s+/).filter(Boolean)
  let cursor = 0
  const take = () => { const t = tokens[cursor++]; if (t === undefined) fail('pcurve incompleta'); return t }
  const curve = (depth = 0): AxisPcurve => {
    if (depth > 8) fail('pcurve annidata oltre il limite')
    const kind = integer(take(), 1, 9)
    if (kind === 8) {
      const first = finite(take()), last = finite(take())
      if (!(last > first)) fail('intervallo della pcurve non valido')
      const line = curve(depth + 1); line.trims.push([first, last]); return line
    }
    if (kind === 7) {
      // A clamped nonrational degree-1 curve with two poles and two knots
      // is exactly the affine segment between its poles. No fit/conversion.
      const rational = integer(take(), 0, 1), periodic = integer(take(), 0, 1), degree = integer(take(), 1, 25)
      const poles = integer(take(), 2, 25000), knots = integer(take(), 2, 25000)
      if (rational !== 0 || periodic !== 0 || degree !== 1 || poles !== 2 || knots !== 2)
        fail('pcurve B-spline diversa dal segmento non razionale grado 1 a due poli/nodi')
      const a: [number, number] = [finite(take()), finite(take())], b: [number, number] = [finite(take()), finite(take())]
      const first = finite(take()), m0 = integer(take(), 1, 26), last = finite(take()), m1 = integer(take(), 1, 26)
      if (!(last > first) || m0 !== 2 || m1 !== 2) fail('segmento pcurve B-spline non clamped o con nodi invalidi')
      return { kind: 'degree1-bspline', poles: [a, b], knots: [first, last], trims: [] }
    }
    if (kind !== 1) fail('pcurve diversa da linea assiale o segmento B-spline certificabile')
    return { kind: 'line', origin: [finite(take()), finite(take())], direction: [finite(take()), finite(take())], trims: [] }
  }
  const result = Array.from({ length: count }, () => curve())
  if (cursor !== tokens.length) fail('token inattesi nella tabella pcurve')
  return result
}
interface EdgeData { tolerance: number; range: [number, number]; reps: { curve: number; surface: number; range: [number, number] }[] }
function edgeData(text: string): EdgeData {
  const matches = [...text.matchAll(/^Ed\s*\n([^\n]*)\n([\s\S]*?)^0\s*$/gm)]
  if (matches.length !== 1) fail('occorrenza del bordo ambigua')
  const header = matches[0][1].trim().split(/\s+/)
  if (header.length !== 4 || header[1] !== '1' || header[2] !== '1' || header[3] !== '0')
    fail('bordo degenere o senza SameParameter/SameRange verificabili')
  const tolerance = finite(header[0])
  if (tolerance < 0 || tolerance > 1e-6) fail('tolleranza topologica del bordo oltre il limite')
  const reps: EdgeData['reps'] = [], curves: [number, number][] = []
  for (const raw of matches[0][2].trim().split(/\r?\n/)) {
    const t = raw.trim().split(/\s+/)
    if (t[0] === '1' && t.length === 5) {
      integer(t[1], 1, 100000); if (t[2] !== '0') fail('bordo con trasformazione')
      curves.push([finite(t[3]), finite(t[4])])
    } else if (t[0] === '2' && t.length === 6) {
      if (t[3] !== '0') fail('pcurve con trasformazione')
      reps.push({ curve: integer(t[1], 1, 100000), surface: integer(t[2], 1, 100000), range: [finite(t[4]), finite(t[5])] })
    } else if (t[0] === '4' && t.length === 6 && /^(C0|C1|C2|C3|CN|G1|G2)$/.test(t[1]) && t[3] === '0' && t[5] === '0') {
      // Declared continuity is metadata, not evidence of a geometric G1 join.
      integer(t[2], 1, 100000); integer(t[4], 1, 100000)
    } else fail('rappresentazione del bordo non certificabile; seam e poligoni non supportati')
  }
  if (curves.length !== 1 || !(curves[0][1] > curves[0][0]) || reps.some(r => !eq(r.range, curves[0])))
    fail('intervalli delle rappresentazioni del bordo diversi o ambigui')
  return { tolerance, range: curves[0], reps }
}
function ownSurface(text: string) {
  const headers = [...text.matchAll(/^Fa\s*\n\s*([01])\s+([\deE+.-]+)\s+(\d+)\s+(\d+)\s*$/gm)]
  if (headers.length !== 1 || headers[0][4] !== '0') fail('superficie propria della faccia ambigua o trasformata')
  const tolerance = finite(headers[0][2]), records = surfaceTable(text), record = records[integer(headers[0][3], 1, records.length) - 1]
  if (tolerance < 0 || tolerance > 1e-6 || !record) fail('superficie o tolleranza della faccia non supportata')
  return record
}
function polynomialNet(input: Net): Net {
  const n = refineClampedNet(input, [])
  if (n.rational.some(Boolean) || n.weights.some(x => x !== 1)) fail('supportati solo reticoli nativi non razionali')
  for (const [degree, multiplicity] of [[n.du, n.mu], [n.dv, n.mv]] as const)
    if (multiplicity.slice(1, -1).some(m => m >= degree)) fail('reticolo nativo privo di continuità C1')
  return n
}
function nativeNet(text: string): Net {
  const record = ownSurface(text)
  if (record.kind !== 9 || !record.net) fail('serve una B-spline nativa non periodica; nessuna conversione implicita')
  return polynomialNet(record.net)
}
export interface NaturalLinearPcurveInput {
  origin: [number, number]
  direction: [number, number]
  parameterRange: [number, number]
}
function linearPcurveSide(domain: NaturalPcurveWitness['domain'], parameterBudget: number, input: NaturalLinearPcurveInput) {
  if ([input.origin, input.direction, input.parameterRange].some(a => !Array.isArray(a) || a.length !== 2 || Array.from(a).some(x => !Number.isFinite(x))) ||
      !(input.parameterRange[1] > input.parameterRange[0])) fail('pcurve lineare non valida')
  const dx = input.direction[0], dy = input.direction[1]
  const axis = dx === 0 && Math.abs(dy) === 1 ? 0 : dy === 0 && Math.abs(dx) === 1 ? 1 : -1
  if (axis !== 0 && axis !== 1) fail('pcurve non isoparametrica assiale')
  const varying = axis === 0 ? 1 : 0
  const coordinate = input.origin[axis], ends = input.parameterRange.map(t =>
    add(scalar(input.origin[varying]), mul(scalar(input.direction[varying]), scalar(t))))
  return endpointPcurveSide(domain, parameterBudget, axis, coordinate, ends as [I, I], input.direction[varying] > 0, input.parameterRange)
}
function endpointPcurveSide(domain: NaturalPcurveWitness['domain'], parameterBudget: number, axis: 0 | 1, coordinate: number,
  ends: [I, I], increasing: boolean, range: [number, number]) {
  const low = axis === 0 ? domain[2] : domain[0], high = axis === 0 ? domain[3] : domain[1]
  const first = ends[increasing ? 0 : 1], last = ends[increasing ? 1 : 0]
  const options = axis === 0 ? [0, 1] : [2, 3]
  const hits = options.filter(i => abs(sub(scalar(coordinate), scalar(domain[i]))) <= parameterBudget)
  const residual = Math.max(abs(sub(first, scalar(low))), abs(sub(last, scalar(high))),
    ...hits.map(i => abs(sub(scalar(coordinate), scalar(domain[i])))))
  if (hits.length !== 1 || residual > parameterBudget) fail('pcurve non copre esattamente un lato naturale entro il budget numerico')
  return { side: sides[hits[0]], direction: (increasing ? 1 : -1) as 1 | -1,
    parameterRange: [...range] as [number, number], maxParameterResidual: residual }
}
/** Pure parameter-domain guard also used by the CAD parser. Parameters T are
 * arbitrary: neither a UV nor a model-space tolerance can relax containment. */
export function assertCompleteDegree1PcurveDomain(knots: readonly [number, number], range: readonly [number, number],
  trims: readonly (readonly [number, number])[] = []): void {
  const interval = (a: readonly number[]) => Array.isArray(a) && a.length === 2 && Array.from(a).every(Number.isFinite) && a[1] > a[0]
  if (!interval(knots) || !interval(range) || !Array.isArray(trims) || Array.from(trims).some(t => !t || !interval(t)))
    fail('intervallo parametrico del segmento pcurve B-spline non valido')
  if (!eq(range, knots)) fail('pcurve B-spline usata su un intervallo parziale: segmento completo richiesto')
  if (trims.some(([a, b]) => range[0] < a || range[1] > b)) fail('intervallo del segmento pcurve B-spline oltre il trim')
}
function degree1PcurveSide(domain: NaturalPcurveWitness['domain'], parameterBudget: number, curve: Degree1Pcurve, range: [number, number]) {
  assertCompleteDegree1PcurveDomain(curve.knots, range, curve.trims)
  const [a, b] = curve.poles
  const axis = Object.is(a[0], b[0]) && !Object.is(a[1], b[1]) ? 0 : Object.is(a[1], b[1]) && !Object.is(a[0], b[0]) ? 1 : -1
  if (axis !== 0 && axis !== 1) fail('segmento pcurve B-spline non assiale o degenere')
  const varying = axis === 0 ? 1 : 0
  if (a[varying] === b[varying]) fail('segmento pcurve B-spline degenere')
  // For the FULL degree-1 knot domain these are exact endpoint coefficients;
  // avoid dividing knot spans or normalizing a nearly axial direction.
  return endpointPcurveSide(domain, parameterBudget, axis, a[axis], [scalar(a[varying]), scalar(b[varying])], b[varying] > a[varying], range)
}
/** Pure arithmetic certificate used by the CAD path below. It establishes UV
 * coverage and a geometric error bound, NOT edge ownership or CAD validity. */
export function certifyNaturalLinearPcurveSide(net: Net, input: NaturalLinearPcurveInput) {
  const n = polynomialNet(net), domain: NaturalPcurveWitness['domain'] = [n.ku[0], n.ku.at(-1)!, n.kv[0], n.kv.at(-1)!]
  const { budget: parameterBudget, derivativeSum } = parameterBudgetFor(n, domain)
  const result = linearPcurveSide(domain, parameterBudget, input)
  const maxGeometricDeviationBound = mul(scalar(result.maxParameterResidual), scalar(derivativeSum))[1]
  if (maxGeometricDeviationBound > 1e-8) fail('errore geometrico del testimone naturale oltre il limite')
  return { ...result, parameterBudget, geometricBudgetMm: 1e-8 as const, maxGeometricDeviationBound }
}
function boundary(n: Net, side: NaturalSide): Point[] {
  if (side === 'uMin') return n.poles.slice(0, n.nv)
  if (side === 'uMax') return n.poles.slice((n.nu - 1) * n.nv)
  return Array.from({ length: n.nu }, (_, u) => n.poles[u * n.nv + (side === 'vMin' ? 0 : n.nv - 1)])
}
function naturalWitness(k: OcctKernel, face: ShapeHandle, faceIndex: number, edges: ShapeHandle[], n: Net, surfaceSignature: string): NaturalPcurveWitness {
  const domain: NaturalPcurveWitness['domain'] = [n.ku[0], n.ku.at(-1)!, n.kv[0], n.kv.at(-1)!]
  const { budget: parameterBudget, derivativeSum } = parameterBudgetFor(n, domain)
  const b = k.uvBounds(face)
  if ([b.uMin, b.uMax, b.vMin, b.vMax].some((x, i) => abs(sub(scalar(x), scalar(domain[i]))) > parameterBudget))
    fail('faccia ritagliata rispetto al dominio naturale')
  const orientation = k.shapeOrientation(face)
  if (orientation !== 'forward' && orientation !== 'reversed') fail('orientamento della faccia non supportato')
  const found = edges.map((edge, edgeIndex) => {
    const text = k.toBREP(edge), geometry = surfaceTable(text), data = edgeData(text), lines = pcurves(text)
    const reps = data.reps.filter(rep => geometry[rep.surface - 1] && signature(geometry[rep.surface - 1]) === surfaceSignature)
    if (reps.length !== 1) fail('pcurve propria del bordo assente o non univoca')
    const rep = reps[0], line = lines[rep.curve - 1]
    // B-spline wrappers are checked exactly in degree1PcurveSide below.
    if (!line || (line.kind === 'line' && line.trims.some(([a, b]) => rep.range[0] < a - parameterBudget || rep.range[1] > b + parameterBudget)))
      fail('pcurve mancante o intervallo oltre il trim')
    return { edgeIndex, ...(line.kind === 'line' ? linearPcurveSide(domain, parameterBudget, {
      origin: line.origin, direction: line.direction, parameterRange: rep.range }) : degree1PcurveSide(domain, parameterBudget, line, rep.range)) }
  })
  if (new Set(found.map(x => x.side)).size !== 4) fail('quattro lati naturali distinti non comprovati')
  const maxGeometricDeviationBound = mul(scalar(Math.max(...found.map(side => side.maxParameterResidual))), scalar(derivativeSum))[1]
  if (maxGeometricDeviationBound > 1e-8) fail('errore geometrico del testimone naturale oltre il limite')
  return { method: 'brep-v3-axis-aligned-line-pcurves', faceIndex, surfaceSignature, orientation, domain, sides: found,
    parameterBudget, geometricBudgetMm: 1e-8, maxGeometricDeviationBound }
}
function exactSumZero(values: number[]): boolean {
  const parts = values.map(x => { floats[0] = x; const bits = bytes[0], e = Number((bits >> 52n) & 2047n)
    const m = (bits & ((1n << 52n) - 1n)) | (e ? 1n << 52n : 0n)
    return { m: bits >> 63n ? -m : m, e: (e || 1) - 1075 } })
  const low = Math.min(...parts.map(p => p.e))
  return parts.reduce((sum, p) => sum + (p.m << BigInt(p.e - low)), 0n) === 0n
}
function sameBasis(a: Net, side: NaturalSide, b: Net, supportSide: NaturalSide, reverse: boolean): boolean {
  const x = side[0] === 'u' ? { degree: a.dv, k: a.kv, m: a.mv } : { degree: a.du, k: a.ku, m: a.mu }
  const y = supportSide[0] === 'u' ? { degree: b.dv, k: b.kv, m: b.mv } : { degree: b.du, k: b.ku, m: b.mu }
  const k = reverse ? [...y.k].reverse() : y.k, m = reverse ? [...y.m].reverse() : y.m
  return x.degree === y.degree && eq(x.m, m) && x.k.length === k.length && x.k.every((t, i) =>
    reverse ? exactSumZero([y.k[0], y.k.at(-1)!, -k[i], -t]) : Object.is(t, k[i]))
}
function straightSeam(k: OcctKernel, edge: ShapeHandle, points: Point[]): boolean {
  if (k.curveType(edge) !== 'line') return false
  const text = k.toBREP(edge), match = /^Curves 1\s*\n([^\n]*)\n/m.exec(text)
  if (!match) fail('curva 3D del bordo non univoca')
  const t = match[1].trim().split(/\s+/)
  if (t.length !== 7 || t[0] !== '1') fail('rappresentazione 3D del seam diversa da linea')
  const p = t.slice(1, 4).map(finite) as Point, d = t.slice(4).map(finite) as Point, data = edgeData(text)
  const divisor = Math.max(...d.map(Math.abs))
  if (!(divisor > 0)) fail('linea 3D degenere')
  for (const point of points) {
    const delta = point.map((x, i) => sub(scalar(x), scalar(p[i]))) as V
    const c = [0, 1, 2].map(i => sub(mul(delta[(i + 1) % 3], scalar(d[(i + 2) % 3])), mul(delta[(i + 2) % 3], scalar(d[(i + 1) % 3])))) as V
    if (l1(c) > divisor * 1e-8) return false
  }
  const endpoints = data.range.map(t => p.map((x, i) => add(scalar(x), mul(scalar(d[i]), scalar(t)))) as V)
  const agrees = (point: Point, endpoint: V) => l1(point.map((x, i) => sub(scalar(x), endpoint[i])) as V) <= 1e-8
  return (agrees(points[0], endpoints[0]) && agrees(points.at(-1)!, endpoints[1])) ||
    (agrees(points[0], endpoints[1]) && agrees(points.at(-1)!, endpoints[0]))
}

/** A clamped polynomial curve is straight only if its control points lie on
 * a line. Use outward-rounded intervals so near-collinear data fail closed. */
function hasNoncollinearPoles(points: Point[]): boolean {
  const offset = (p: Point) => p.map((x, i) => sub(scalar(x), scalar(points[0][i]))) as V
  const end = offset(points.at(-1)!)
  return points.slice(1, -1).some(point => {
    const delta = offset(point)
    return [[0, 1], [0, 2], [1, 2]].some(([i, j]) => {
      const component = sub(mul(end[i], delta[j]), mul(end[j], delta[i]))
      return component[0] > 0 || component[1] < 0
    })
  })
}

function exactSharedBSplineDegree(edgeBrep: string, selectedNet: Net, supportNet: Net,
  selectedSide: NaturalPcurveWitness['sides'][number], supportSide: NaturalPcurveWitness['sides'][number]): number | null {
  try {
    const { curve, pcurveCount } = associateSerializedEdgeCurve(edgeBrep)
    if (pcurveCount !== 2 || curve.rational || !hasNoncollinearPoles(curve.poles)) return null
    // Reversed pcurves need an OCCT/STEP topology fixture before recognition.
    if (selectedSide.direction !== 1 || supportSide.direction !== 1) return null
    const a = matchNaturalSideCurve(selectedNet, selectedSide.side, curve, selectedSide.direction)
    const b = matchNaturalSideCurve(supportNet, supportSide.side, curve, supportSide.direction)
    return a.comparison.exact && b.comparison.exact ? curve.degree : null
  } catch {
    return null // Unsupported curve representation or parameter direction.
  }
}

async function identify(k: OcctKernel, sourceBrep: string, inputStamp: G1SourceStamp, curveKind: 'line' | 'bspline') {
  const stamp = structuredClone(inputStamp)
  if (typeof sourceBrep !== 'string' || !sourceBrep || sourceBrep.length > 128_000_000 || !stamp ||
      ![stamp.sourceRevision, stamp.selectionRevision, stamp.faceIndex].every(x => Number.isSafeInteger(x) && x >= 0)) fail('identità sorgente non valida')
  if (stamp.sourceId !== 'brep-sha256:' + await sha256(sourceBrep)) fail('fingerprint della sorgente diverso')
  surfaceTable(sourceBrep) // V3, no Locations, complete known surface grammar.
  const owned: ShapeHandle[] = [], own = (h: ShapeHandle) => { owned.push(h); return h }
  const many = (h: ShapeHandle[]) => { owned.push(...h); return h }
  try {
    const source = own(k.fromBREP(sourceBrep))
    if (!k.isValid(source)) fail('sorgente CAD non valida')
    const faces = many(k.getSubShapes(source, 'face')), selected = faces[stamp.faceIndex]
    if (!selected) fail('faccia selezionata assente')
    for (let i = 0; i < faces.length; i++) for (let j = 0; j < i; j++) if (k.isSame(faces[i], faces[j])) fail('occorrenze faccia duplicate')
    const records = faces.map(f => ownSurface(k.toBREP(f))), signatures = records.map(signature)
    if (new Set(signatures).size !== signatures.length) fail('superfici proprie condivise o ambigue')
    const perFace = faces.map(f => many(k.getSubShapes(f, 'edge')))
    const certify = (index: number) => {
      const face = faces[index], wires = many(k.getSubShapes(face, 'wire')), edges = perFace[index]
      if (wires.length !== 1 || edges.length !== 4) fail('serve una sola wire naturale senza fori e con quattro bordi')
      for (let i = 0; i < edges.length; i++) for (let j = 0; j < i; j++) if (k.isSame(edges[i], edges[j])) fail('seam o bordo ripetuto')
      const net = nativeNet(k.toBREP(face))
      return { net, witness: naturalWitness(k, face, index, edges, net, signatures[index]) }
    }
    const chosen = certify(stamp.faceIndex)
    const compatible: ResolvedCompatibleCurvedSupport[] = [], curved: ExperimentalSharedBSplineEdge[] = []
    for (let edgeIndex = 0; edgeIndex < perFace[stamp.faceIndex].length; edgeIndex++) {
      const edge = perFace[stamp.faceIndex][edgeIndex], incidence = perFace.flatMap((es, i) => es.some(e => k.isSame(e, edge)) ? [i] : [])
      if (incidence.length > 2) fail('bordo non manifold')
      if (incidence.length !== 2 || k.curveType(edge) !== curveKind) continue
      const supportFaceIndex = incidence.find(i => i !== stamp.faceIndex)!
      const shared = many(k.sharedEdges(selected, faces[supportFaceIndex]))
      if (shared.length !== 1 || !k.isSame(shared[0], edge)) fail('adiacenza multipla o incoerente')
      const supportEdgeIndex = perFace[supportFaceIndex].findIndex(e => k.isSame(e, edge))
      const aOrientation = k.shapeOrientation(edge), bOrientation = k.shapeOrientation(perFace[supportFaceIndex][supportEdgeIndex])
      if (!['forward', 'reversed'].includes(aOrientation) || !['forward', 'reversed'].includes(bOrientation) || aOrientation === bOrientation)
        fail('orientazione del bordo condiviso incoerente')
      let support: ReturnType<typeof certify>
      try { support = certify(supportFaceIndex) } catch { continue } // Explicitly unsupported neighbors are never candidates.
      if (curveKind === 'bspline') {
        const selectedSide = chosen.witness.sides[edgeIndex], supportSide = support.witness.sides[supportEdgeIndex]
        const degree = exactSharedBSplineDegree(k.toBREP(edge), chosen.net, support.net, selectedSide, supportSide)
        if (degree === null) continue
        const lengthMm = k.curveLength(edge)
        if (!Number.isFinite(lengthMm) || lengthMm <= 1e-8) continue
        const kind = 'experimental-shared-bspline-edge'
        const { sourceId, sourceRevision, selectionRevision, faceIndex } = stamp
        const id = JSON.stringify([sourceId, sourceRevision, selectionRevision, faceIndex, kind,
          supportFaceIndex, edgeIndex, supportEdgeIndex, degree, lengthMm,
          selectedSide.side, selectedSide.direction, selectedSide.parameterRange,
          supportSide.side, supportSide.direction, supportSide.parameterRange])
        curved.push({ kind, id, stamp: { sourceId, sourceRevision, selectionRevision, faceIndex },
          supportFaceIndex, edgeIndex, supportEdgeIndex,
          lengthMm, degree, selectedWitness: chosen.witness, supportWitness: support.witness })
        continue
      }
      const side = chosen.witness.sides[edgeIndex].side, supportSide = support.witness.sides[supportEdgeIndex].side
      const a = boundary(chosen.net, side), b = boundary(support.net, supportSide)
      if (!straightSeam(k, edge, a) || !straightSeam(k, edge, b)) continue
      const directions = [false, true].filter(reverse => a.length === b.length && a.every((p, i) => eq(p, b[reverse ? b.length - 1 - i : i])) &&
        sameBasis(chosen.net, side, support.net, supportSide, reverse))
      if (directions.length !== 1) continue
      const reverseSupport = directions[0], lengthMm = k.curveLength(edge)
      if (!Number.isFinite(lengthMm) || lengthMm <= 1e-8) continue
      const candidate: CompatibleCurvedSupportCandidate = { kind: 'compatible-bspline',
        id: JSON.stringify([stamp.sourceId, stamp.sourceRevision, stamp.selectionRevision, stamp.faceIndex, 'compatible-bspline', supportFaceIndex, edgeIndex, side, supportSide, reverseSupport]),
        stamp: { ...stamp }, supportFaceIndex, edgeIndex, side, supportSide, reverseSupport, lengthMm }
      compatible.push({ candidate, selectedNet: chosen.net, supportNet: support.net, selectedWitness: chosen.witness, supportWitness: support.witness })
    }
    return structuredClone({ compatible, curved })
  } finally { owned.reverse().forEach(h => k.release(h)) }
}

/** Immutable source text is imported privately; no caller-owned handle is modified. */
export async function listCompatibleCurvedSupportCandidates(k: OcctKernel, sourceBrep: string, stamp: G1SourceStamp): Promise<CompatibleCurvedSupportCandidate[]> {
  return (await identify(k, sourceBrep, stamp, 'line')).compatible.map(item => item.candidate)
}
export async function resolveCompatibleCurvedSupportCandidate(k: OcctKernel, sourceBrep: string, stamp: G1SourceStamp,
  choice: CompatibleCurvedSupportCandidate): Promise<ResolvedCompatibleCurvedSupport> {
  const requested = structuredClone(choice), { compatible: current } = await identify(k, sourceBrep, stamp, 'line')
  const found = current.find(item => item.candidate.id === requested?.id)
  if (!found || JSON.stringify(found.candidate) !== JSON.stringify(requested)) fail('scelta del supporto scaduta o alterata')
  return found
}

/** Read-only adjacency and curve/side coefficient evidence. G1 continuity
 * requires an independent check of the two surface tangent fields. */
export async function listExperimentalSharedBSplineEdges(k: OcctKernel, sourceBrep: string,
  stamp: G1SourceStamp): Promise<ExperimentalSharedBSplineEdge[]> {
  return (await identify(k, sourceBrep, stamp, 'bspline')).curved
}

// Compare the complete fresh record, including both witnesses, independent of property order.
function sameEvidence(expected: unknown, requested: unknown): boolean {
  if (Object.is(expected, requested)) return true
  if (expected === null || requested === null || typeof expected !== 'object' || typeof requested !== 'object') return false
  if (Array.isArray(expected)) {
    if (!Array.isArray(requested) || expected.length !== requested.length) return false
  } else if (Array.isArray(requested)) return false
  const entries = Object.entries(expected), fields = requested as Record<string, unknown>
  return entries.length === Object.keys(fields).length && entries.every(([key, value]) =>
    Object.hasOwn(fields, key) && sameEvidence(value, fields[key]))
}

/** Reimport the source and recheck adjacency, pcurves and curve coefficients. */
export async function resolveExperimentalSharedBSplineEdge(k: OcctKernel, sourceBrep: string, stamp: G1SourceStamp,
  choice: ExperimentalSharedBSplineEdge): Promise<ExperimentalSharedBSplineEdge> {
  const requested = structuredClone(choice), { curved } = await identify(k, sourceBrep, stamp, 'bspline')
  const found = curved.find(item => item.id === requested?.id)
  if (!found || !sameEvidence(found, requested)) fail('scelta del bordo sperimentale scaduta o alterata')
  return found
}
