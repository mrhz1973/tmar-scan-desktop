// SPDX-License-Identifier: AGPL-3.0-only
import { findSpan, calcBasisFunctions } from 'three/examples/jsm/curves/NURBSUtils.js'
import type { Net, Point } from './brep'
import { refineClampedNet } from './refineClampedNet'

export interface SurfacePointTarget {
  u: number
  v: number
  target: Point
  /** Already authorized by the caller after boundary, trim and manual locks. */
  editablePoles: readonly number[]
  /** Mandatory movement budget in the net's units, normally millimetres. */
  maxPoleDisplacement: number
  /** Lower bound on the sum of authorized rational basis coefficients. */
  minInfluence: number
  /** Maximum accepted numerical point residual, in the net's units. */
  residualTolerance: number
}

/** Mathematical candidate only: not a trim, G1, topology or CAD-validity check.
 * Fixed positive weights make the surface point linear in its poles. The
 * minimum-norm solution moves authorized poles only, preserving every basis
 * value and weight. The caller must validate the candidate before publication.
 */
export function targetSurfacePoint(source: Net, request: SurfacePointTarget): {
  net: Net; before: Point; after: Point; influence: number; maxPoleDisplacement: number; residual: number
} {
  // Empty refinement is the shared clamped-net validator and independent copy.
  const net = refineClampedNet(source, [])
  const { u, v, target, editablePoles, maxPoleDisplacement, minInfluence, residualTolerance } = request
  if (![u, v, maxPoleDisplacement, minInfluence, residualTolerance].every(Number.isFinite) ||
      !Array.isArray(target) || target.length !== 3 || !target.every(Number.isFinite) ||
      maxPoleDisplacement <= 0 || minInfluence <= 0 || minInfluence > 1 || residualTolerance <= 0 ||
      !editablePoles.length || new Set(editablePoles).size !== editablePoles.length ||
      editablePoles.some(i => !Number.isInteger(i) || i < 0 || i >= net.poles.length) ||
      u < net.ku[0] || u > net.ku.at(-1)! || v < net.kv[0] || v > net.kv.at(-1)!)
    throw new Error('Richiesta di punto superficie non valida.')
  const ku = net.ku.flatMap((k, i) => Array<number>(net.mu[i]).fill(k))
  const kv = net.kv.flatMap((k, i) => Array<number>(net.mv[i]).fill(k))
  const su = findSpan(net.du, u, ku), sv = findSpan(net.dv, v, kv)
  const bu = calcBasisFunctions(su, u, net.du, ku), bv = calcBasisFunctions(sv, v, net.dv, kv)
  const coefficients = Array<number>(net.poles.length).fill(0)
  // Common weight scaling avoids overflow for large, otherwise valid weights.
  const scale = Math.max(...net.weights)
  let denominator = 0
  for (let i = 0; i <= net.du; i++) for (let j = 0; j <= net.dv; j++) {
    const id = (su - net.du + i) * net.nv + sv - net.dv + j
    const value = bu[i] * bv[j] * (net.weights[id] / scale)
    coefficients[id] = value; denominator += value
  }
  if (!Number.isFinite(denominator) || denominator <= 0) throw new Error('Base razionale non determinabile.')
  for (let i = 0; i < coefficients.length; i++) coefficients[i] /= denominator
  if (coefficients.some(x => !Number.isFinite(x) || x < 0)) throw new Error('Base razionale non determinabile.')
  const evaluate = (n: Net): Point => [0, 1, 2].map(d => coefficients.reduce((sum, r, i) => sum + r * n.poles[i][d], 0)) as Point
  const before = evaluate(net)
  const influence = editablePoles.reduce((sum, i) => sum + coefficients[i], 0)
  const squared = editablePoles.reduce((sum, i) => sum + coefficients[i] ** 2, 0)
  if (influence < minInfluence || squared <= 0 || !Number.isFinite(squared))
    throw new Error('Influenza insufficiente dei poli autorizzati sul punto superficie.')
  const delta = target.map((x, d) => x - before[d]) as Point
  let largest = 0
  for (const id of editablePoles) {
    if (coefficients[id] === 0) continue
    const move = delta.map(x => x * (coefficients[id] / squared)) as Point
    const length = Math.hypot(...move)
    if (!Number.isFinite(length) || length > maxPoleDisplacement)
      throw new Error('Spostamento dei poli oltre il limite autorizzato.')
    largest = Math.max(largest, length)
    net.poles[id] = net.poles[id].map((x, d) => x + move[d]) as Point
  }
  const after = evaluate(net), residual = Math.hypot(...after.map((x, d) => x - target[d]))
  if (!before.every(Number.isFinite) || net.poles.some(p => !p.every(Number.isFinite)) ||
      !Number.isFinite(residual) || residual > residualTolerance)
    throw new Error('Residuo numerico del punto superficie oltre il limite.')
  return { net, before, after, influence, maxPoleDisplacement: largest, residual }
}
