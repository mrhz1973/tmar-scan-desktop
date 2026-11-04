// SPDX-License-Identifier: AGPL-3.0-only
import { Vector3 } from 'three'
import { findSpan, calcBasisFunctionDerivatives } from 'three/examples/jsm/curves/NURBSUtils.js'
import type { Net, Point } from './brep'

export type DragMode = 'axis' | 'screen' | 'local'
const expand = (knots: number[], mult: number[]) => knots.flatMap((k, i) => Array<number>(mult[i]).fill(k))
const greville = (knots: number[], degree: number, i: number) => knots.slice(i + 1, i + degree + 1).reduce((a, b) => a + b, 0) / degree

// A pole is not generally on the surface. Associate it with its Greville
// parameters, then differentiate the rational surface (not its control polygon).
// N = U x V is parametric, not necessarily the solid's outward normal.
export function localFrame(net: Net, index: number): [Point, Point, Point] | null {
  // The clamped Greville/basis calculation below does not represent periodic
  // knot vectors. Fail closed until cyclic local derivatives are supported.
  if (net.periodic?.some(Boolean)) return null
  if (!Number.isInteger(index) || index < 0 || index >= net.poles.length) return null
  const ku = expand(net.ku, net.mu), kv = expand(net.kv, net.mv)
  const u = greville(ku, net.du, Math.floor(index / net.nv)), v = greville(kv, net.dv, index % net.nv)
  const su = findSpan(net.du, u, ku), sv = findSpan(net.dv, v, kv)
  const bu = calcBasisFunctionDerivatives(su, u, net.du, 1, ku), bv = calcBasisFunctionDerivatives(sv, v, net.dv, 1, kv)
  const h = [new Vector3(), new Vector3(), new Vector3()], w = [0, 0, 0]
  for (let i = 0; i <= net.du; i++) for (let j = 0; j <= net.dv; j++) {
    const at = (su - net.du + i) * net.nv + sv - net.dv + j
    const c = [bu[0][i] * bv[0][j], bu[1][i] * bv[0][j], bu[0][i] * bv[1][j]]
    for (let d = 0; d < 3; d++) { const a = c[d] * net.weights[at]; h[d].addScaledVector(new Vector3(...net.poles[at]), a); w[d] += a }
  }
  if (!(w[0] > 0)) return null
  const p = h[0].divideScalar(w[0])
  const du = h[1].addScaledVector(p, -w[1]).divideScalar(w[0]), dv = h[2].addScaledVector(p, -w[2]).divideScalar(w[0])
  if (![...du.toArray(), ...dv.toArray()].every(Number.isFinite) || du.lengthSq() === 0 || dv.lengthSq() === 0) return null
  du.normalize(); dv.normalize()
  const normal = new Vector3().crossVectors(du, dv)
  if (normal.lengthSq() < 1e-16) return null // Undefined local frame: never substitute a world axis.
  normal.normalize()
  const transverse = new Vector3().crossVectors(normal, du).normalize()
  return [du.toArray() as Point, transverse.toArray() as Point, normal.toArray() as Point]
}

export function dragDirection(net: Net, index: number, mode: DragMode, axis: number): Point | null {
  if (mode === 'local') return localFrame(net, index)?.[axis] ?? null
  return [0, 1, 2].map(i => i === axis ? 1 : 0) as Point
}
