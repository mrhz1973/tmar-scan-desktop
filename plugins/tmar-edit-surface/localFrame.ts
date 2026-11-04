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
  if (!Number.isInteger(index) || index < 0 || index >= net.poles.length) return null
  const periodicU = !!net.periodic?.[0], periodicV = !!net.periodic?.[1]
  let ku = expand(net.ku, net.mu), periodicStep = 0
  if (periodicU || periodicV) {
    // OCCT's native conversion of the qualified full cylinder uses a
    // six-pole quadratic cyclic U net with three equal double-knot spans.
    // Other periodic conventions need their own mapping and fail closed.
    if (!periodicU || periodicV || net.nu !== 6 || net.du !== 2 || (net.nv !== 5 && net.nv !== 6) || net.dv !== 3 || net.ku.length !== 4 ||
        net.mu.join() !== '2,2,2,2' || net.poles.length !== net.nu*net.nv || net.weights.length !== net.poles.length ||
        net.kv.length !== net.nv-2 || net.mv.join() !== (net.nv === 5 ? '4,1,4' : '4,1,1,4') || net.kv.some((x,i)=>!Number.isFinite(x) || (i>0 && x<=net.kv[i-1])) ||
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
  const sv = findSpan(net.dv, v, kv)
  const bv = calcBasisFunctionDerivatives(sv, v, net.dv, 1, kv)
  const frameAt = (parameter: number): [Point, Point, Point] | null => {
    let su = findSpan(net.du, parameter, ku)
    if (periodicU) while (su+1 < ku.length && ku[su+1] === parameter) su++
    const bu = calcBasisFunctionDerivatives(su, parameter, net.du, 1, ku)
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
  if (periodicU && net.ku.slice(0,-1).some(k=>Math.abs(k-u)<=periodicStep*1e-10)) {
    // At a multiple knot there may be two distinct tangents. Do not silently
    // choose one for a manipulator on a creased surface.
    const eps=periodicStep*1e-7, left=frameAt(u===net.ku[0]?net.ku[3]-eps:u-eps), right=frameAt(u+eps)
    const dot=(a:Point,b:Point)=>a.reduce((sum,x,i)=>sum+x*b[i],0)
    if (!left || !right || dot(left[0],right[0])<1-1e-8 || dot(left[2],right[2])<1-1e-8) return null
  }
  return frameAt(u)
}

export function dragDirection(net: Net, index: number, mode: DragMode, axis: number): Point | null {
  if (mode === 'local') return localFrame(net, index)?.[axis] ?? null
  return [0, 1, 2].map(i => i === axis ? 1 : 0) as Point
}
