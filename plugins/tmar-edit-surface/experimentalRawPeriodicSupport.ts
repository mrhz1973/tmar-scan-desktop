// SPDX-License-Identifier: AGPL-3.0-only
import type { Net, Point } from './brep'
import { clampExperimentalPolynomialBSpline } from './experimentalClampedBSplineTrim'
import { canonicalizeExperimentalClosedClampedCurve } from './experimentalPeriodicCurveAffineDifference'
import { validateExperimentalPeriodicSurfaceU } from './experimentalPeriodicSurfaceRefinement'

/** Raw polynomial STEP ordering: outer array U, inner array V, then XYZ. */
export interface ExperimentalRawPolynomialSupport {
  degreeU: number
  degreeV: number
  knotsU: readonly number[]
  multiplicitiesU: readonly number[]
  knotsV: readonly number[]
  multiplicitiesV: readonly number[]
  poles: readonly (readonly (readonly [number, number, number])[])[]
  activeU: readonly [number, number]
  /** Absent weights mean implicit unit weights; rational input is refused. */
  weights?: readonly (readonly number[])[]
  rational?: boolean
  periodic?: boolean
}

const fail = (reason: string): never => { throw Error(`raw-periodic-support: ${reason}`) }
function dense<T>(values: readonly T[], predicate: (value: T, index: number) => boolean): boolean {
  if (!Array.isArray(values)) return false
  for (let i = 0; i < values.length; i++) {
    if (!Object.hasOwn(values, i) || !predicate(values[i], i)) return false
  }
  return true
}
const same = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && dense(a, (x, i) => Object.hasOwn(b, i) && Object.is(x, b[i]))
const knotsValid = (values: readonly number[], maximum: number) =>
  Array.isArray(values) && values.length >= 2 && values.length <= maximum &&
  dense(values, (x, i) => Number.isFinite(x) && (i === 0 || x > values[i - 1]))

/**
 * Representation preparation only: compose the existing exact clamp and
 * closed-clamped canonicalizer independently for each V control column.
 * Identical U curves imply the same tensor-product coefficient surface on
 * the original closed active domain, because the V basis is retained.
 *
 * A nonzero clamp emission bound is refused, even if it would be small.
 * No fitting, row movement, knot normalization, cyclic rotation, native
 * object construction, derivative/G1 claim, or Tube qualification occurs.
 * The caller binds source files/hashes and face identity in its contract.
 */
export function prepareExperimentalRawPeriodicSupport(input: ExperimentalRawPolynomialSupport) {
  if (!input || !Number.isInteger(input.degreeU) || input.degreeU < 1 || input.degreeU > 3 ||
      !Number.isInteger(input.degreeV) || input.degreeV < 1 || input.degreeV > 25 ||
      (input.rational !== undefined && input.rational !== false) ||
      (input.periodic !== undefined && input.periodic !== false) ||
      !Array.isArray(input.poles) || input.poles.length <= input.degreeU || input.poles.length > 512 ||
      !Array.isArray(input.poles[0])) fail('invalid-polynomial-input')

  const nu = input.poles.length, nv = input.poles[0].length
  if (nv <= input.degreeV || nv > 500 || nu * nv > 25_000 ||
      !dense(input.poles, row => Array.isArray(row) && row.length === nv &&
        dense(row, p => Array.isArray(p) && p.length === 3 && dense(p, Number.isFinite))) ||
      (input.weights !== undefined && (!Array.isArray(input.weights) || input.weights.length !== nu ||
        !dense(input.weights, row => Array.isArray(row) && row.length === nv && dense(row, w => w === 1)))))
    fail('nonrectangular-nonfinite-or-nonunit-control-net')

  if (!knotsValid(input.knotsU, 518) || !Array.isArray(input.multiplicitiesU) ||
      input.multiplicitiesU.length !== input.knotsU.length ||
      !dense(input.multiplicitiesU, m => Number.isInteger(m) && m >= 1 && m <= input.degreeU + 1) ||
      input.multiplicitiesU.reduce((sum, m) => sum + m, 0) !== nu + input.degreeU + 1 ||
      !knotsValid(input.knotsV, 1000) || !Array.isArray(input.multiplicitiesV) ||
      input.multiplicitiesV.length !== input.knotsV.length ||
      !dense(input.multiplicitiesV, (m, i) => i === 0 || i === input.multiplicitiesV.length - 1
        ? m === input.degreeV + 1 : Number.isInteger(m) && m >= 1 && m <= input.degreeV) ||
      input.multiplicitiesV.reduce((sum, m) => sum + m, 0) !== nv + input.degreeV + 1)
    fail('invalid-polynomial-basis')

  const flatU = input.knotsU.flatMap((k, i) => Array<number>(input.multiplicitiesU[i]).fill(k))
  const originalActiveU: [number, number] = [flatU[input.degreeU], flatU[nu]]
  if (!Array.isArray(input.activeU) || input.activeU.length !== 2 ||
      !dense(input.activeU, Number.isFinite) || !same(input.activeU, originalActiveU) ||
      !(originalActiveU[0] < originalActiveU[1])) fail('active-u-domain-substitution')
  if (!(input.knotsU[0] < originalActiveU[0] && input.knotsU.at(-1)! > originalActiveU[1]))
    fail('missing-u-padding')

  const columns = Array.from({ length: nv }, (_, vIndex) => {
    const curve = { degree: input.degreeU, knots: input.knotsU, multiplicities: input.multiplicitiesU,
      poles: input.poles.map(row => row[vIndex]), periodic: false, rational: false }
    const clamped = clampExperimentalPolynomialBSpline(curve, originalActiveU)
    if (clamped.status !== 'converted') return fail(`column-${vIndex}-clamp-${clamped.reason}`)
    if (!clamped.exactInBinary64 || clamped.maximumCurveErrorUpper !== 0)
      fail(`column-${vIndex}-nonzero-clamp-emission-error`)
    if (!same(clamped.curve.poles[0], clamped.curve.poles.at(-1)!))
      fail(`column-${vIndex}-not-exactly-closed`)
    const canonical = canonicalizeExperimentalClosedClampedCurve(clamped.curve)
    return { curve: canonical.curve, receipt: { vIndex, sourcePoleCount: nu,
      clampedPoleCount: clamped.curve.poles.length, canonicalPoleCount: canonical.curve.poles.length,
      maximumClampEmissionErrorUpper: clamped.maximumCurveErrorUpper,
      exactClampInBinary64: clamped.exactInBinary64,
      exactClosedCurveIdentity: canonical.exactRepresentationIdentity,
      nativeCadCertified: false as const } }
  })
  const first = columns[0].curve
  if (columns.some(({ curve }) => curve.degree !== first.degree || curve.poles.length !== first.poles.length ||
      !same(curve.knots, first.knots) || !same(curve.multiplicities, first.multiplicities)))
    fail('inconsistent-column-bases')
  if (!same([first.knots[0], first.knots.at(-1)!], originalActiveU)) fail('changed-active-u-domain')

  const poles: Point[] = Array.from({ length: first.poles.length }, (_, u) =>
    columns.map(({ curve }) => [...curve.poles[u]] as Point)).flat()
  const net: Net = { nu: first.poles.length, nv, du: input.degreeU, dv: input.degreeV,
    poles, weights: Array<number>(poles.length).fill(1), rational: [0, 0], periodic: [1, 0],
    ku: [...first.knots], mu: [...first.multiplicities], kv: [...input.knotsV], mv: [...input.multiplicitiesV] }
  validateExperimentalPeriodicSurfaceU(net)
  return { status: 'prepared-coefficient-representation' as const, net,
    correspondence: 'identity-u-v-on-original-closed-active-domain' as const,
    originalActiveU, perVClamps: columns.map(column => column.receipt),
    scope: 'polynomial-tensor-product-coefficient-representation-only' as const,
    nativeCadCertified: false as const, differentialContinuityCertified: false as const, tubeAccepted: false as const }
}
