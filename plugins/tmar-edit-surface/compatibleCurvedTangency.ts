// SPDX-License-Identifier: AGPL-3.0-only
import type { Net, Point } from './brep'
import type { NaturalEdge } from './planeTangency'
import { refineClampedNet } from './refineClampedNet'
import { add, cross, difference, divide, dot, l1, mul, scalar, sub, times, vector, type I, type V } from './tangencyCoefficientIntervals'

/** Pure coefficient operation. The caller must prove a shared straight natural
 * CAD edge, incidence/orientation and source identity, then validate rebuilt CAD/STEP.
 * Only nonrational, clamped, C1 nets with an identical straight seam basis pass.
 * Inward transverse derivatives are opposite with a positive constant scale.
 * This sufficient condition is intentionally narrower than general G1. */
export interface CompatibleCurvedTangencyRequest {
  net: Net
  supportNet: Net
  edge: NaturalEdge
  supportEdge: NaturalEdge
  reverseSupport?: boolean
  scale?: number
  lockIndices?: readonly number[]
  /** Default: preserve all three other tangent rows. */
  preserveTangentEdges?: readonly NaturalEdge[]
  /** Coefficient straightness budget; does not replace the CAD line-type check. */
  distanceTolerance?: number
  derivativeTolerance?: number
}
export interface CompatibleCurvedTangencyValidation {
  edgeRegularity: 'outward-rounded-coefficient-hull-proof'
  checkedDerivativePairs: number
  minSupportNormalMagnitudeBound: number
  minSelectedNormalMagnitudeBound: number
  maxDerivativeCoefficientResidual: number
  maxStraightnessResidual: number
  maxNormalSinBound: number
  protectedPoleCount: number
  /** No CAD topology or global surface regularity certificate is implied. */
  globalG1Certified: false
}
export interface CompatibleCurvedTangencyResult {
  net: Net
  changedIndices: number[]
  validation: CompatibleCurvedTangencyValidation
}
/** Experimental coefficient-only path for a shared natural boundary.
 * It proves no CAD edge ownership, geometry identity or topology. */
export type ExperimentalCurvedSeamRequest = CompatibleCurvedTangencyRequest
export interface ExperimentalCurvedSeamValidation extends Omit<CompatibleCurvedTangencyValidation, 'maxStraightnessResidual'> {
  /** Coefficient-based upper bound on departure from the endpoint chord; not a curvature proof. */
  maxSeamDepartureUpperBound: number
}
export interface ExperimentalCurvedSeamResult {
  net: Net
  changedIndices: number[]
  validation: ExperimentalCurvedSeamValidation
}
const edges: NaturalEdge[] = ['U0', 'U1', 'V0', 'V1']
const fail = (why: string): never => { throw new Error(`Tangenza curva compatibile rifiutata: ${why}`) }
const equal = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]))
const raw = new BigUint64Array(1), number = new Float64Array(raw.buffer)
function row(n: Net, edge: NaturalEdge, inner = false): number[] {
  if (edge[0] === 'U') {
    const u = edge === 'U0' ? +inner : n.nu - 1 - +inner
    return Array.from({ length: n.nv }, (_, v) => u * n.nv + v)
  }
  const v = edge === 'V0' ? +inner : n.nv - 1 - +inner
  return Array.from({ length: n.nu }, (_, u) => u * n.nv + v)
}

/** Exact dyadic equality for affine knot reversal, including nonbinary-looking
 * decimal inputs. A rounded `first + last - knot` is not a basis identity proof. */
function exactSumZero(values: number[]): boolean {
  const parts = values.map(x => {
    number[0] = x
    const bits = raw[0], exponent = Number((bits >> 52n) & 2047n)
    const mantissa = (bits & ((1n << 52n) - 1n)) | (exponent ? 1n << 52n : 0n)
    return { value: bits >> 63n ? -mantissa : mantissa, exponent: (exponent || 1) - 1075 }
  })
  const low = Math.min(...parts.map(p => p.exponent))
  return parts.reduce((sum, p) => sum + (p.value << BigInt(p.exponent - low)), 0n) === 0n
}
function validNet(input: Net): Net {
  let n: Net
  try { n = refineClampedNet(input, []) } catch { return fail('reticolo clamped non valido o oltre 1600 poli') }
  if (Array.from(n.poles).some(p => !Array.isArray(p) || p.length !== 3 || Array.from(p).some(x => !Number.isFinite(x))) ||
      [n.weights, n.ku, n.kv, n.mu, n.mv, n.rational, n.periodic ?? [0, 0]].some(a => Array.from(a).some(x => !Number.isFinite(x))))
    fail('reticolo sparso o con coefficienti non finiti')
  if (n.rational.some(Boolean) || n.weights.some(w => w !== 1)) fail('supportati solo reticoli non razionali con pesi unitari')
  for (const [p, m] of [[n.du, n.mu], [n.dv, n.mv]] as const)
    if (m.slice(1, -1).some(x => x >= p)) fail('serve continuità parametrica C1 sui nodi interni')
  return n
}
function coefficientFactor(n: Net, edge: NaturalEdge): I {
  const degree = edge[0] === 'U' ? n.du : n.dv, k = edge[0] === 'U' ? n.ku : n.kv
  const gap = edge[1] === '0' ? sub(scalar(k[1]), scalar(k[0])) : sub(scalar(k.at(-1)!), scalar(k.at(-2)!))
  return divide(scalar(degree), gap)
}
function inward(n: Net, edge: NaturalEdge, reverse = false): V[] {
  const outer = row(n, edge), inner = row(n, edge, true), factor = coefficientFactor(n, edge)
  const out = outer.map((id, i) => times(difference(n.poles[inner[i]], n.poles[id]), factor))
  return reverse ? out.reverse() : out
}
function along(n: Net, edge: NaturalEdge) {
  return edge[0] === 'U' ? { p: n.dv, k: n.kv, m: n.mv } : { p: n.du, k: n.ku, m: n.mu }
}
function prepare(request: CompatibleCurvedTangencyRequest, requireStraight = true) {
  if (!request || !edges.includes(request.edge) || !edges.includes(request.supportEdge)) fail('bordo naturale non valido')
  if (request.reverseSupport !== undefined && typeof request.reverseSupport !== 'boolean') fail('verso del supporto non valido')
  const n = validNet(request.net), support = validNet(request.supportNet)
  const scale = request.scale ?? 1, distance = request.distanceTolerance ?? 1e-8, derivative = request.derivativeTolerance ?? 1e-8
  if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(distance) || distance <= 0 || distance > 1e-6 ||
      !Number.isFinite(derivative) || derivative <= 0 || derivative > 1e-6) fail('scala positiva o tolleranze non valide')
  const locks = request.lockIndices ?? [], protectedEdges = request.preserveTangentEdges ?? edges.filter(e => e !== request.edge)
  if (!Array.isArray(locks) || Array.from(locks).some(i => !Number.isInteger(i) || i < 0 || i >= n.poles.length)) fail('indice bloccato non valido')
  if (!Array.isArray(protectedEdges) || Array.from(protectedEdges).some(e => !edges.includes(e) || e === request.edge)) fail('altro bordo protetto non valido')
  const a = along(n, request.edge), b = along(support, request.supportEdge)
  const reversed = !!request.reverseSupport, bk = reversed ? [...b.k].reverse() : b.k, bm = reversed ? [...b.m].reverse() : b.m
  if (a.p !== b.p || !equal(a.m, bm) || a.k.length !== bk.length ||
      a.k.some((x, i) => reversed ? !exactSumZero([b.k[0], b.k.at(-1)!, -bk[i], -x]) : !Object.is(x, bk[i])))
    fail('basi lungo il bordo diverse: nessun fitting o riparametrizzazione automatica')
  const boundary = row(n, request.edge), neighborBoundary = row(support, request.supportEdge)
  if (reversed) neighborBoundary.reverse()
  if (boundary.length !== neighborBoundary.length || boundary.some((id, i) => !equal(n.poles[id], support.poles[neighborBoundary[i]])))
    fail('coefficienti del bordo comune non identici')
  const c = boundary.map(id => n.poles[id]), chord = difference(c.at(-1)!, c[0])
  const lengthLower = Math.max(...chord.map(x => x[0] > 0 ? x[0] : x[1] < 0 ? -x[1] : 0))
  if (!(lengthLower > distance)) fail('bordo degenere')
  let straightness = 0
  for (let i = 0; i < c.length; i++) {
    straightness = Math.max(straightness, divide(scalar(l1(cross(difference(c[i], c[0]), chord))), scalar(lengthLower))[1])
    if (i && !(chord.reduce((s, x, d) => add(s, mul(x, difference(c[i], c[i - 1])[d])), scalar(0))[0] > 0))
      fail('bordo non strettamente monotono')
  }
  if (requireStraight && straightness > distance) fail('bordo naturale non rettilineo entro il limite dei coefficienti')
  const full = a.k.flatMap((x, i) => Array<number>(a.m[i]).fill(x))
  const tangent = c.slice(1).map((p, i) => times(difference(p, c[i]), divide(scalar(a.p), sub(scalar(full[i + a.p + 1]), scalar(full[i + 1])))))
  const supportDerivative = inward(support, request.supportEdge, reversed), inner = row(n, request.edge, true)
  if (tangent.length * supportDerivative.length > 65536) fail('limite di 65536 coppie per la prova continua superato')
  if (!requireStraight && tangent.some(t => l1(t) <= distance)) fail('derivata del seam non comprovabilmente regolare')
  const fixed = new Set([...locks, ...edges.flatMap(e => row(n, e)), ...protectedEdges.flatMap(e => row(n, e, true))])
  return { n, support, inner, boundary, scale, distance, derivative, straightness, tangent, supportDerivative, fixed }
}

function validateStructure(base: Net, n: Net): void {
  if (base.nu !== n.nu || base.nv !== n.nv || base.du !== n.du || base.dv !== n.dv ||
      !equal(base.ku, n.ku) || !equal(base.kv, n.kv) || !equal(base.mu, n.mu) || !equal(base.mv, n.mv) ||
      !equal(base.weights, n.weights) || !equal(base.rational, n.rational) || !equal(base.periodic ?? [0, 0], n.periodic ?? [0, 0]))
    fail('struttura, nodi, pesi o dominio modificati')
}

/** Nonmutating validation of the supplied coefficients, not a regenerated proposal. */
function validateResult(request: CompatibleCurvedTangencyRequest, finalNet: Net, requireStraight: boolean): CompatibleCurvedTangencyValidation {
  const p = prepare(request, requireStraight), final = validNet(finalNet)
  validateStructure(p.n, final)
  const editable = new Set(p.inner)
  let protectedPoleCount = 0
  for (let i = 0; i < final.poles.length; i++) if (!editable.has(i) || p.fixed.has(i)) {
    if (!equal(p.n.poles[i], final.poles[i])) fail(`polo protetto modificato: ${i}`)
    protectedPoleCount++
  }
  const selected = inward(final, request.edge)
  let residual = 0
  for (let i = 0; i < selected.length; i++) residual = Math.max(residual,
    l1(selected[i].map((x, d) => add(x, mul(scalar(p.scale), p.supportDerivative[i][d]))) as V))
  if (residual > p.derivative) fail('derivate trasversali non opposte e proporzionali entro la tolleranza')
  const first = cross(p.tangent[0], p.supportDerivative[0])
  const witness = first.map(x => x[0] + (x[1] - x[0]) / 2) as Point
  if (!witness.every(Number.isFinite) || !witness.some(x => x !== 0)) fail('normale testimone non determinata')
  let supportProjection = Infinity, selectedProjection = Infinity
  // Nonnegative B-spline bases partition unity. Every pair has the same strict
  // projection sign, so the entire derivative cross-product is nonzero on every
  // closed span and knot. This conservative hull can refuse otherwise valid joins.
  for (const tangent of p.tangent) for (let j = 0; j < selected.length; j++) {
    supportProjection = Math.min(supportProjection, dot(cross(tangent, p.supportDerivative[j]), witness)[0])
    selectedProjection = Math.min(selectedProjection, -dot(cross(tangent, selected[j]), witness)[1])
  }
  if (!(supportProjection > 0) || !(selectedProjection > 0)) fail('regolarità continua o verso delle derivate non comprovati')
  const witnessUpper = l1(vector(witness))
  const supportLower = divide(scalar(supportProjection), scalar(witnessUpper))[0]
  const selectedLower = divide(scalar(selectedProjection), scalar(witnessUpper))[0]
  const tangentUpper = Math.max(...p.tangent.map(l1))
  const normalSinBound = divide(mul(scalar(tangentUpper), scalar(residual)), scalar(selectedLower))[1]
  if (!(selectedLower > 0) || normalSinBound > 1e-7) fail('limite angolare continuo non sufficientemente stretto')
  return { edgeRegularity: 'outward-rounded-coefficient-hull-proof', checkedDerivativePairs: p.tangent.length * selected.length,
    minSupportNormalMagnitudeBound: supportLower, minSelectedNormalMagnitudeBound: selectedLower,
    maxDerivativeCoefficientResidual: residual, maxStraightnessResidual: p.straightness, maxNormalSinBound: normalSinBound,
    protectedPoleCount, globalG1Certified: false }
}

export function validateCompatibleCurvedTangencyResult(request: CompatibleCurvedTangencyRequest, finalNet: Net): CompatibleCurvedTangencyValidation {
  return validateResult(request, finalNet, true)
}

function propose(request: CompatibleCurvedTangencyRequest, requireStraight: boolean): CompatibleCurvedTangencyResult {
  const p = prepare(request, requireStraight), net = structuredClone(p.n), a = coefficientFactor(p.n, request.edge)
  const b = coefficientFactor(p.support, request.supportEdge)
  const ratio = p.scale * (b[0] + (b[1] - b[0]) / 2) / (a[0] + (a[1] - a[0]) / 2)
  if (!Number.isFinite(ratio) || ratio <= 0) fail('scala della proposta non rappresentabile')
  const otherBoundary = row(p.support, request.supportEdge), otherInner = row(p.support, request.supportEdge, true)
  if (request.reverseSupport) { otherBoundary.reverse(); otherInner.reverse() }
  const current = inward(p.n, request.edge)
  for (let j = 0; j < p.inner.length; j++) if (p.fixed.has(p.inner[j]) &&
      l1(current[j].map((x, d) => add(x, mul(scalar(p.scale), p.supportDerivative[j][d]))) as V) > p.derivative)
    fail(`vincolo incompatibile sul polo ${p.inner[j]}`)
  for (let j = 0; j < p.inner.length; j++) if (!p.fixed.has(p.inner[j])) {
    net.poles[p.inner[j]] = net.poles[p.boundary[j]].map((x, d) => x - ratio *
      (p.support.poles[otherInner[j]][d] - p.support.poles[otherBoundary[j]][d])) as Point
  }
  const validation = validateResult(request, net, requireStraight)
  const changedIndices = net.poles.flatMap((point, i) => equal(point, p.n.poles[i]) ? [] : [i])
  return { net, changedIndices, validation }
}

export function proposeCompatibleCurvedTangency(request: CompatibleCurvedTangencyRequest): CompatibleCurvedTangencyResult {
  return propose(request, true)
}

/** Experimental and deliberately disconnected from CAD topology, UI and workers.
 * Inputs must be nonrational, unit-weight, clamped, nonperiodic C1 nets whose
 * shared seam (straight or curved) has exactly identical coefficients and basis.
 * The reported chord departure is an upper bound, not proof of curvature. */
export function proposeExperimentalCurvedSeamTangency(request: ExperimentalCurvedSeamRequest): ExperimentalCurvedSeamResult {
  const result = propose(request, false)
  const { maxStraightnessResidual, ...validation } = result.validation
  return { ...result, validation: { ...validation, maxSeamDepartureUpperBound: maxStraightnessResidual } }
}

export function validateExperimentalCurvedSeamTangencyResult(request: ExperimentalCurvedSeamRequest,
  finalNet: Net): ExperimentalCurvedSeamValidation {
  const { maxStraightnessResidual, ...validation } = validateResult(request, finalNet, false)
  return { ...validation, maxSeamDepartureUpperBound: maxStraightnessResidual }
}
