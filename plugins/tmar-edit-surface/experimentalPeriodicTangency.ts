// SPDX-License-Identifier: AGPL-3.0-only
import type { Net, Point } from './brep'
import { add, cross, difference, divide, dot, l1, mul, scalar, sub, times, type I, type V } from './tangencyCoefficientIntervals'

type PeriodicSide = 'V0' | 'V1'

export interface ExperimentalPeriodicTangencyRequest {
  net: Net
  supportNet: Net
  edge: PeriodicSide
  supportEdge: PeriodicSide
  scale?: number
  lockIndices?: readonly number[]
}

const fail = (reason: string): never => { throw new Error(`Tangenza periodica rifiutata: ${reason}`) }
const equal = (a: readonly number[], b: readonly number[]) => a.length === b.length && Array.from(a).every((x, i) => Object.is(x, b[i]))
const finitePoint = (point: Point): boolean => Array.isArray(point) && point.length === 3 && Array.from(point).every(Number.isFinite)
const validKnots = (knots: number[], mult: number[]) => knots.length >= 2 && knots.length === mult.length &&
  Number.isFinite(knots.at(-1)! - knots[0]) &&
  Array.from(knots).every((k, i) => Number.isFinite(k) && (i === 0 || k > knots[i - 1]))
const subtract = (a: V, b: V): V => a.map((x, i) => sub(x, b[i])) as V

function checkNet(n: Net): void {
  if (n.periodic?.length !== 2 || n.periodic[0] !== 1 || n.periodic[1] !== 0 ||
      n.rational.length !== 2 || Array.from(n.rational).some(x => x !== 0 && x !== 1) ||
      !Number.isInteger(n.nu) || !Number.isInteger(n.nv) || n.nu * n.nv > 25000 ||
      !Number.isInteger(n.du) || n.du < 2 || n.du > 25 || n.nu <= n.du ||
      !Number.isInteger(n.dv) || n.dv < 1 || n.dv > 25 || n.nv <= n.dv ||
      n.poles.length !== n.nu * n.nv || Array.from(n.poles).some(point => !finitePoint(point)) ||
      n.weights.length !== n.poles.length || Array.from(n.weights).some(w => !Number.isFinite(w) || w <= 0) ||
      (!n.rational.some(Boolean) && n.weights.some(w => w !== 1))) fail('reticolo periodico U non valido')
  if (!validKnots(n.ku, n.mu) || n.mu[0] !== n.mu.at(-1) ||
      Array.from(n.mu).some(m => !Number.isInteger(m) || m < 1 || m >= n.du) ||
      n.mu.slice(0, -1).reduce((sum, m) => sum + m, 0) !== n.nu) fail('base U periodica C1 non valida')
  if (!validKnots(n.kv, n.mv) || n.mv[0] !== n.dv + 1 || n.mv.at(-1) !== n.dv + 1 ||
      Array.from(n.mv.slice(1, -1)).some(m => !Number.isInteger(m) || m < 1 || m >= n.dv) ||
      n.mv.reduce((sum, m) => sum + m, 0) !== n.nv + n.dv + 1) fail('base V clamped C1 non valida')
}

function side(n: Net, edge: PeriodicSide) {
  const boundary = edge === 'V0' ? 0 : n.nv - 1, step = edge === 'V0' ? 1 : -1
  const knot = edge === 'V0' ? 0 : n.kv.length - 2
  const gap = sub(scalar(n.kv[knot + 1]), scalar(n.kv[knot]))
  const outer = Array.from({ length: n.nu }, (_, u) => u * n.nv + boundary)
  return { outer, inner: outer.map(index => index + step), factor: divide(scalar(n.dv), gap),
    approximateFactor: n.dv / (n.kv[knot + 1] - n.kv[knot]) }
}

function prepare(request: ExperimentalPeriodicTangencyRequest) {
  const { net, supportNet, edge, supportEdge, scale = 1, lockIndices = [] } = request
  if ((edge !== 'V0' && edge !== 'V1') || (supportEdge !== 'V0' && supportEdge !== 'V1') ||
      !Number.isFinite(scale) || scale <= 0) fail('bordi naturali V o scala positiva non validi')
  checkNet(net)
  checkNet(supportNet)
  if (net.nv < 4) fail('servono quattro file V per proteggere la derivata del bordo opposto')
  if (net.du !== supportNet.du || net.nu !== supportNet.nu || !equal(net.ku, supportNet.ku) || !equal(net.mu, supportNet.mu))
    fail('basi U diverse: occorrono lo stesso periodo, la stessa fase e lo stesso ordinamento')
  if (net.nu * net.du * (net.du + 1) ** 2 > 65536) fail('limite di coppie per la verifica del bordo superato')
  if (!Array.isArray(lockIndices) || Array.from(lockIndices).some(i => !Number.isInteger(i) || i < 0 || i >= net.poles.length))
    fail('indice bloccato non valido')
  const a = side(net, edge), b = side(supportNet, supportEdge)
  for (const [u, i] of a.outer.entries()) {
    const j = b.outer[u], w = net.weights[i]
    if (!equal(net.poles[i], supportNet.poles[j]) || w !== supportNet.weights[j]) fail('coefficienti del bordo comune non identici')
    if (w !== net.weights[a.inner[u]] || w !== supportNet.weights[b.inner[u]])
      fail('pesi variabili tra bordo e fila adiacente non supportati')
  }
  return { a, b, scale, locks: new Set(lockIndices), boundary: a.outer.map(i => net.poles[i]), weights: a.outer.map(i => net.weights[i]) }
}

function inwardNumerator(n: Net, s: ReturnType<typeof side>): V[] {
  return s.outer.map((i, u) => times(difference(n.poles[s.inner[u]], n.poles[i]), mul(s.factor, scalar(n.weights[i]))))
}

// Expand the OCCT periodic knot sequence and wrap pole indices past the last
// pole. The first nonempty span starts at flat index p and uses poles 0..p.
// Derivative basis coefficients on a span use the same active block with one
// fewer entry. All knot differences are evaluated with outward rounding.
function* tangentHulls(n: Net, boundary: Point[], weights: number[]) {
  const { du: p, nu } = n
  const pad = p + 1 - n.mu[0]
  const period = sub(scalar(n.ku.at(-1)!), scalar(n.ku[0]))
  const central = n.ku.flatMap((k, i) => Array<I>(n.mu[i]).fill(scalar(k)))
  const knots = [...central.slice(nu - pad, nu).map(k => sub(k, period)), ...central,
    ...central.slice(n.mu[0], n.mu[0] + pad).map(k => add(k, period))]
  let start = 0
  for (let span = 0; span < n.ku.length - 1; span++) {
    if (span > 0) start += n.mu[span]
    const ids = Array.from({ length: p + 1 }, (_, i) => (start + i) % nu)
    // Work in a local origin. In homogeneous coordinates, the tangent
    // numerator H'W-HW' lies in the hull of the products below.
    const localWeights = ids.map(i => scalar(weights[i]))
    const homogeneous = ids.map((i, j) => times(difference(boundary[i], boundary[ids[0]]), localWeights[j]))
    const tangent: V[] = []
    for (let j = 0; j < p; j++) {
      const i = start + j
      const factor = divide(scalar(p), sub(knots[i + p + 1], knots[i + 1]))
      const dh = times(subtract(homogeneous[j + 1], homogeneous[j]), factor)
      const a = localWeights[j], b = localWeights[j + 1]
      const dw = a[0] === b[0] ? scalar(0) : mul(sub(b, a), factor)
      for (let k = 0; k <= p; k++) tangent.push(subtract(times(dh, localWeights[k]), times(homogeneous[k], dw)))
    }
    yield { ids, tangent }
  }
}

type Prepared = ReturnType<typeof prepare>

function validate(request: ExperimentalPeriodicTangencyRequest, p: Prepared, finalNet: Net) {
  checkNet(finalNet)
  const { net, supportNet } = request
  if (net.nu !== finalNet.nu || net.nv !== finalNet.nv || net.du !== finalNet.du || net.dv !== finalNet.dv ||
      !equal(net.ku, finalNet.ku) || !equal(net.kv, finalNet.kv) || !equal(net.mu, finalNet.mu) ||
      !equal(net.mv, finalNet.mv) || !equal(net.rational, finalNet.rational) || !equal(net.weights, finalNet.weights))
    fail('struttura, nodi o pesi modificati')
  const editable = new Set(p.a.inner), changedIndices: number[] = []
  for (const [i, point] of finalNet.poles.entries()) if (!equal(point, net.poles[i])) {
    if (!editable.has(i) || p.locks.has(i)) fail(`polo protetto modificato: ${i}`)
    changedIndices.push(i)
  }
  const support = inwardNumerator(supportNet, p.b), selected = inwardNumerator(finalNet, p.a)
  const original = inwardNumerator(net, p.a)
  const residuals = selected.map((v, i) => l1(v.map((x, d) => add(x, mul(scalar(p.scale), support[i][d]))) as V))
  const maxDerivativeResidualBound = divide(scalar(Math.max(...residuals)), scalar(Math.min(...p.weights)))[1]
  if (maxDerivativeResidualBound > 1e-8) fail('derivate trasversali non opposte e proporzionali entro la tolleranza')

  let checkedSpans = 0, maxNormalSinBound = 0
  for (const { ids, tangent } of tangentHulls(net, p.boundary, p.weights)) {
    const first = cross(tangent[0], support[ids[0]])
    const witness = first.map(x => x[0] / 2 + x[1] / 2) as Point
    let selectedProjection = Infinity
    for (const t of tangent) for (const u of ids) {
      if (!(dot(cross(t, support[u]), witness)[0] > 0) || !(dot(cross(t, original[u]), witness)[1] < 0))
        fail('regolarità del bordo o verso delle superfici non comprovati')
      selectedProjection = Math.min(selectedProjection, -dot(cross(t, selected[u]), witness)[1])
    }
    if (!(selectedProjection > 0)) fail('regolarità del bordo modificato non comprovata')
    // The three normal numerators have the same positive denominator W^3.
    const selectedLower = divide(scalar(selectedProjection), scalar(l1(witness.map(scalar) as V)))[0]
    const normalSinBound = divide(mul(scalar(Math.max(...tangent.map(l1))), scalar(Math.max(...ids.map(i => residuals[i])))),
      scalar(selectedLower))[1]
    if (normalSinBound > 1e-7) fail('limite angolare continuo non sufficientemente stretto')
    maxNormalSinBound = Math.max(maxNormalSinBound, normalSinBound)
    checkedSpans++
  }
  return { changedIndices, checkedSpans, maxDerivativeResidualBound, maxNormalSinBound,
    edgeRegularity: 'outward-rounded-periodic-span-hulls' as const,
    evidenceScope: 'input-coefficients-only' as const, cadRoundTripVerified: false as const, globalG1Certified: false as const }
}

/** Verify the supplied coefficients independently of the proposal. */
export function validateExperimentalPeriodicTangency(request: ExperimentalPeriodicTangencyRequest, finalNet: Net) {
  return validate(request, prepare(request), finalNet)
}

/** Experimental natural-side coefficient proposal. The continuous bounds
 * concern the mathematical edge of the supplied coefficients, including its
 * periodic wrap. OCCT may reject closely spaced knots or normalize weights,
 * and large parameter domains can lose distinct knots in the numeric wrap.
 * CAD publication requires separate kernel round-trip and closure checks,
 * plus verification of incidence, trims, correspondence and solid validity. */
export function proposeExperimentalPeriodicTangency(request: ExperimentalPeriodicTangencyRequest) {
  const p = prepare(request), net = structuredClone(request.net)
  const ratio = p.scale * p.b.approximateFactor / p.a.approximateFactor
  if (!Number.isFinite(ratio) || ratio <= 0) fail('scala della proposta non rappresentabile')
  for (const [u, i] of p.a.inner.entries()) if (!p.locks.has(i)) {
    const from = request.supportNet.poles[p.b.outer[u]], into = request.supportNet.poles[p.b.inner[u]]
    net.poles[i] = p.boundary[u].map((x, d) => x - ratio * (into[d] - from[d])) as Point
  }
  return { net, validation: validate(request, p, net) }
}
