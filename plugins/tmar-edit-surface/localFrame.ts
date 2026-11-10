// SPDX-License-Identifier: AGPL-3.0-only
import { Vector3 } from 'three'
import { findSpan, calcBasisFunctionDerivatives } from 'three/examples/jsm/curves/NURBSUtils.js'
import type { Net, Point } from './brep'
import { refineClampedNet } from './refineClampedNet'

export type DragMode = 'axis' | 'screen' | 'local'
type Frame = [Point, Point, Point]
const expand = (knots: number[], mult: number[]) => knots.flatMap((k, i) => Array<number>(mult[i]).fill(k))
const greville = (knots: number[], degree: number, i: number) => knots.slice(i + 1, i + degree + 1).reduce((a, b) => a + b, 0) / degree

function frameAt(net: Net, ku: number[], kv: number[], u: number, v: number, periodicU = false): Frame | null {
  const sv = findSpan(net.dv, v, kv)
  const bv = calcBasisFunctionDerivatives(sv, v, net.dv, 1, kv)
  let su = findSpan(net.du, u, ku)
  if (periodicU) while (su+1 < ku.length && ku[su+1] === u) su++
  const bu = calcBasisFunctionDerivatives(su, u, net.du, 1, ku)
  const h = [new Vector3(), new Vector3(), new Vector3()], w = [0, 0, 0]
  for (let i = 0; i <= net.du; i++) for (let j = 0; j <= net.dv; j++) {
    const rawU = su-net.du+i, poleU = periodicU ? ((rawU-1)%net.nu+net.nu)%net.nu : rawU
    const at = poleU * net.nv + sv - net.dv + j
    const c = [bu[0][i] * bv[0][j], bu[1][i] * bv[0][j], bu[0][i] * bv[1][j]]
    for (let d = 0; d < 3; d++) { const a = c[d] * net.weights[at]; h[d].addScaledVector(new Vector3(...net.poles[at]), a); w[d] += a }
  }
  if (!(w[0] > 0)) return null
  const p = h[0].divideScalar(w[0])
  const du = h[1].addScaledVector(p, -w[1]).divideScalar(w[0]), dv = h[2].addScaledVector(p, -w[2]).divideScalar(w[0])
  if (![...du.toArray(), ...dv.toArray()].every(Number.isFinite) || du.lengthSq() === 0 || dv.lengthSq() === 0) return null
  du.normalize(); dv.normalize()
  const normal = new Vector3().crossVectors(du, dv)
  if (normal.lengthSq() < 1e-16) return null
  normal.normalize()
  const transverse = new Vector3().crossVectors(normal, du).normalize()
  return [du.toArray() as Point, transverse.toArray() as Point, normal.toArray() as Point]
}

// A pole is not generally on the surface. Associate it with its Greville
// parameters, then differentiate the rational surface (not its control polygon).
// N = U x V is parametric, not necessarily the solid's outward normal.
export function localFrame(net: Net, index: number): Frame | null {
  if (!Number.isInteger(index) || index < 0 || index >= net.poles.length) return null
  const periodicU = !!net.periodic?.[0], periodicV = !!net.periodic?.[1]
  let ku = expand(net.ku, net.mu), periodicStep = 0
  if (periodicU || periodicV) {
    // OCCT's native conversion of the qualified full cylinder uses a
    // six-pole quadratic cyclic U net with three equal double-knot spans.
    // Other periodic conventions need their own mapping and fail closed.
    if (!periodicU || periodicV || net.nu !== 6 || net.du !== 2 || ![5,6,9].includes(net.nv) || net.dv !== 3 || net.ku.length !== 4 ||
        net.mu.join() !== '2,2,2,2' || net.poles.length !== net.nu*net.nv || net.weights.length !== net.poles.length ||
        net.kv.length !== net.nv-2 || net.mv.join() !== [4,...Array(net.nv-4).fill(1),4].join() || net.kv.some((x,i)=>!Number.isFinite(x) || (i>0 && x<=net.kv[i-1])) ||
        net.poles.some(p=>p.length!==3 || p.some(x=>!Number.isFinite(x))) || net.weights.some(w=>!Number.isFinite(w) || w<=0) ||
        net.ku.some(x => !Number.isFinite(x)) || net.ku.some((x,i) => i>0 && x<=net.ku[i-1])) return null
    const step=(net.ku[3]-net.ku[0])/3
    if (!Number.isFinite(step) || step<=0 || Math.abs(net.ku[1]-net.ku[0]-step)>1e-10*step || Math.abs(net.ku[2]-net.ku[1]-step)>1e-10*step) return null
    const base=expand(net.ku.slice(0,-1),net.mu.slice(0,-1)),period=net.ku[3]-net.ku[0]
    const at=(i:number)=>base[((i%net.nu)+net.nu)%net.nu]+Math.floor(i/net.nu)*period
    ku=Array.from({length:net.nu+2*net.du+1},(_,i)=>at(i-net.du))
    periodicStep=step
  }
  const kv = expand(net.kv, net.mv)
  const u = greville(ku, net.du, Math.floor(index / net.nv)+(periodicU?1:0)), v = greville(kv, net.dv, index % net.nv)
  if (!Number.isFinite(u) || !Number.isFinite(v)) return null
  if (periodicU && net.ku.slice(0,-1).some(k=>Math.abs(k-u)<=periodicStep*1e-10)) {
    // At a multiple knot there may be two distinct tangents. Do not silently
    // choose one for a manipulator on a creased surface.
    const eps=periodicStep*1e-7
    const left=frameAt(net,ku,kv,u===net.ku[0]?net.ku[3]-eps:u-eps,v,periodicU)
    const right=frameAt(net,ku,kv,u+eps,v,periodicU)
    const dot=(a:Point,b:Point)=>a.reduce((sum,x,i)=>sum+x*b[i],0)
    if (!left || !right || dot(left[0],right[0])<1-1e-8 || dot(left[2],right[2])<1-1e-8) return null
  }
  return frameAt(net, ku, kv, u, v, periodicU)
}

function regularParameter(parameter: number, knots: number[], mult: number[], degree: number): boolean {
  if (!Number.isFinite(parameter) || parameter < knots[0] || parameter > knots.at(-1)!) return false
  // A CAD projection may round to either side of an internal C0 knot.
  return !knots.some((knot, i) => i > 0 && i < knots.length - 1 && mult[i] >= degree &&
    Math.abs(parameter - knot) <= 16 * Number.EPSILON * Math.max(1, Math.abs(parameter), Math.abs(knot)))
}

/** A right-handed frame at the CAD UV on a clamped, positive-weight net.
 * U follows increasing U. V completes the frame with the CAD-oriented normal. */
export function localFrameAtUv(net: Net, u: number, v: number, cadNormal: Readonly<Point>): Frame | null {
  const normalLength = Math.hypot(...cadNormal)
  if (!Number.isFinite(normalLength) || normalLength <= 1e-12) return null

  let clamped: Net
  try { clamped = refineClampedNet(net, []) } catch { return null }
  if (!regularParameter(u, clamped.ku, clamped.mu, clamped.du) ||
      !regularParameter(v, clamped.kv, clamped.mv, clamped.dv)) return null

  const frame = frameAt(clamped, expand(clamped.ku, clamped.mu), expand(clamped.kv, clamped.mv), u, v)
  if (!frame) return null
  const alignment = frame[2].reduce((sum, x, i) => sum + x * (cadNormal[i] / normalLength), 0)
  if (!Number.isFinite(alignment) || Math.abs(alignment) < 1 - 1e-8) return null
  if (alignment > 0) return frame
  return [frame[0], frame[1].map(x => -x) as Point, frame[2].map(x => -x) as Point]
}

export function dragDirection(net: Net, index: number, mode: DragMode, axis: number): Point | null {
  if (mode === 'local') return localFrame(net, index)?.[axis] ?? null
  return [0, 1, 2].map(i => i === axis ? 1 : 0) as Point
}
