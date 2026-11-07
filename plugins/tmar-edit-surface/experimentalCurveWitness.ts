// SPDX-License-Identifier: AGPL-3.0-only
// Experimental, read-only coefficient comparison. It deliberately does not
// resolve an OCCT Edge record to a curve-table entry or infer topology.
export interface Curve3dRecord {
  kind: number
  rational: boolean
  periodic: boolean
  degree: number
  poles: [number, number, number][]
  weights: number[]
  knots: number[]
  multiplicities: number[]
  source: 'curve-table' | 'inline-surface-generator'
}
export interface CoefficientComparison {
  comparable: boolean
  exact: boolean
  maxPoleDistance: number | null
  sameWeights: boolean | null
  sameKnots: boolean | null
  sameMultiplicity: boolean | null
  reason?: string
}
const fail = (reason: string): never => { throw new Error(`Curva BREP sperimentale rifiutata: ${reason}`) }
function validateRecord(r: Curve3dRecord): void {
  if (!r || r.kind !== 7 || typeof r.rational !== 'boolean' || typeof r.periodic !== 'boolean' ||
      !Number.isSafeInteger(r.degree) || r.degree < 1 || r.degree > 25 ||
      !Array.isArray(r.poles) || !Array.isArray(r.weights) || !Array.isArray(r.knots) || !Array.isArray(r.multiplicities)) fail('struttura curva non valida')
  if (r.periodic) fail('curve periodiche non supportate')
  const p = r.poles.length, k = r.knots.length
  if (p < r.degree + 1 || p > 25000 || k < 2 || k > 25000 || r.weights.length !== p || r.multiplicities.length !== k) fail('lunghezze curva incoerenti')
  if (Array.from(r.poles).some(v => !Array.isArray(v) || v.length !== 3 || Array.from(v).some(x => !Number.isFinite(x))) ||
      Array.from(r.weights).some(w => !Number.isFinite(w) || w <= 0) || Array.from(r.knots).some(x => !Number.isFinite(x)) ||
      Array.from(r.multiplicities).some(m => !Number.isSafeInteger(m) || m < 1 || m > r.degree + 1)) fail('coefficienti curva non finiti o fuori limite')
  if (!r.rational && r.weights.some(w => w !== 1)) fail('curva non razionale con pesi non unitari')
  if (r.knots.some((x, i) => i > 0 && x <= r.knots[i - 1])) fail('nodi non strettamente crescenti')
  if (!r.periodic) {
    const multiplicityTotal = r.multiplicities.reduce((sum, m) => sum + m, 0)
    if (r.multiplicities[0] !== r.degree + 1 || r.multiplicities.at(-1) !== r.degree + 1 || p !== multiplicityTotal - r.degree - 1)
      fail('numero poli o molteplicità non valido per curva non periodica')
  }
}

/** Reads only OCCT BREP V3 `Curves N` table records of kind 7 (B-splines).
 * Other curve types and transformed BREP files fail closed. */
export function curve3dTable(text: string): Curve3dRecord[] {
  if (!text.includes('CASCADE Topology V3') || !/^Locations 0\s*$/m.test(text)) fail('versione o trasformazioni non supportate')
  const header = /^Curves (\d+)\s*$/m.exec(text)
  if (!header) return fail('tabella curve 3D assente')
  const start = header.index + header[0].length
  // The table ends at the next named BREP section; its first line is the
  // record count, so locate a known section explicitly.
  const rest = text.slice(start)
  const section = /^(?:Curve2ds|Polygon3D|PolygonOnTriangulations|Surfaces|Triangulations|TShapes)\b/m.exec(rest)
  if (!section) return fail('fine tabella curve 3D non determinata')
  const raw = rest.slice(0, section.index).trim().split(/\s+/).filter(Boolean).map(Number)
  if (raw.some(x => !Number.isFinite(x))) fail('numero non valido')
  let i = 0
  const take = () => { if (i >= raw.length) fail('record incompleto'); return raw[i++] }
  const int = (lo: number, hi: number) => { const x = take(); if (!Number.isInteger(x) || x < lo || x > hi) fail('campo intero fuori limite'); return x }
  const records: Curve3dRecord[] = []
  const count = Number(header[1]); if (!Number.isSafeInteger(count) || count > 100000) fail('conteggio eccessivo')
  for (let n = 0; n < count; n++) {
    const kind = int(1, 9)
    if (kind !== 7) fail(`tipo curva ${kind} non B-spline; conteggio record non interpretabile in sicurezza`)
    const rational = int(0, 1) === 1, periodic = int(0, 1) === 1
    const degree = int(1, 25), poleCount = int(1, 25000), knotCount = int(2, 25000)
    const poles: [number, number, number][] = [], weights: number[] = []
    for (let p = 0; p < poleCount; p++) {
      const xyz: [number, number, number] = [take(), take(), take()], weight = rational ? take() : 1
      if (weight <= 0) fail('peso non positivo')
      poles.push(xyz); weights.push(weight)
    }
    const knots: number[] = [], multiplicities: number[] = []
    for (let k = 0; k < knotCount; k++) { knots.push(take()); multiplicities.push(int(1, degree + 1)) }
    if (knots.some((x, j) => j > 0 && x <= knots[j - 1])) fail('nodi non strettamente crescenti')
    const parsed: Curve3dRecord = { kind, rational, periodic, degree, poles, weights, knots, multiplicities, source: 'curve-table' }
    validateRecord(parsed)
    records.push(parsed)
  }
  if (i !== raw.length) fail('dati residui non interpretati')
  return records
}

/** Compares coefficients as written, without reversing/reparameterizing or
 * treating agreement as proof that a particular Edge references the curve. */
export function compareCurveCoefficients(a: Curve3dRecord, b: Curve3dRecord, tolerance = 0): CoefficientComparison {
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new Error('Tolleranza non valida.')
  validateRecord(a); validateRecord(b)
  if (a.degree !== b.degree || a.poles.length !== b.poles.length || a.rational !== b.rational || a.periodic !== b.periodic)
    return { comparable: false, exact: false, maxPoleDistance: null, sameWeights: null, sameKnots: null, sameMultiplicity: null, reason: 'strutture diverse' }
  const maxPoleDistance = Math.max(0, ...a.poles.map((p, i) => Math.hypot(...p.map((x, d) => x - b.poles[i][d]))))
  const weightsEqual = (x: number, y: number) => tolerance === 0 ? Object.is(x, y) : Math.abs(x - y) <= tolerance
  const sameWeights = a.weights.length === b.weights.length && a.weights.every((x, i) => weightsEqual(x, b.weights[i]))
  const sameKnots = a.knots.length === b.knots.length && a.knots.every((x, i) => Math.abs(x - b.knots[i]) <= tolerance)
  const sameMultiplicity = a.multiplicities.length === b.multiplicities.length && a.multiplicities.every((x, i) => x === b.multiplicities[i])
  const exact = maxPoleDistance === 0 && a.weights.length === b.weights.length && a.weights.every((x, i) => Object.is(x, b.weights[i])) &&
    a.knots.length === b.knots.length && a.knots.every((x, i) => Object.is(x, b.knots[i])) && sameMultiplicity
  return { comparable: true, exact, maxPoleDistance, sameWeights, sameKnots, sameMultiplicity }
}
