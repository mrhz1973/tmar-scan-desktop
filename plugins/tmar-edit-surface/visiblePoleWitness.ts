// SPDX-License-Identifier: AGPL-3.0-only
import type { Net } from './brep'
import { findSpan, calcBasisFunctions } from 'three/examples/jsm/curves/NURBSUtils.js'

/** Find a sampled interior point influenced by a positive-weight, non-periodic
 * pole. A witness proves visibility at that UV point only; a missing witness
 * does not prove the support has no visible intersection with the trim. */
export function visiblePoleWitness(net: Net, index: number,
  classify: (u: number, v: number) => 'in' | 'on' | 'out', minInfluence = 0): { u: number; v: number } | null {
  if (!Number.isInteger(net.nu) || !Number.isInteger(net.nv) || net.nu < 2 || net.nv < 2 ||
      net.nu * net.nv > 1600 || !Number.isInteger(index) || index < 0 || index >= net.nu * net.nv ||
      net.periodic?.some(Boolean) || net.weights.length !== net.nu * net.nv ||
      net.weights.some(weight => !Number.isFinite(weight) || weight <= 0) ||
      !Number.isFinite(minInfluence) || minInfluence < 0 || minInfluence >= 1)
    throw new Error('Polo non qualificabile.')
  function samples(knots: number[], mult: number[], degree: number, count: number, i: number): number[] {
    if (!Number.isInteger(degree) || degree < 1 || degree > 25 || knots.length !== mult.length ||
        knots.some((k, n) => !Number.isFinite(k) || (n > 0 && k <= knots[n - 1])) ||
        count <= degree || knots.length < 2 || mult[0] !== degree + 1 || mult.at(-1) !== degree + 1 ||
        mult.some((m, n) => !Number.isInteger(m) || m < 1 || m > degree + (n === 0 || n === mult.length - 1 ? 1 : 0)) ||
        mult.reduce((a, b) => a + b, 0) !== count + degree + 1)
      throw new Error('Nodi non qualificabili.')
    const expanded = knots.flatMap((k, j) => Array<number>(mult[j]).fill(k))
    const low = expanded[i], high = expanded[i + degree + 1], result: number[] = []
    for (let j = 0; j + 1 < knots.length; j++) {
      const a = Math.max(low, knots[j]), b = Math.min(high, knots[j + 1])
      if (a < b) for (let n = 1; n < 16; n++) {
        const x = a + (b - a) * n / 16
        if (Number.isFinite(x) && x > a && x < b) result.push(x)
      }
    }
    return result
  }
  const us = samples(net.ku, net.mu, net.du, net.nu, Math.floor(index / net.nv))
  const vs = samples(net.kv, net.mv, net.dv, net.nv, index % net.nv)
  const ku=net.ku.flatMap((k,i)=>Array<number>(net.mu[i]).fill(k)),kv=net.kv.flatMap((k,i)=>Array<number>(net.mv[i]).fill(k))
  for (const u of us) for (const v of vs) {
    const su=findSpan(net.du,u,ku),sv=findSpan(net.dv,v,kv),bu=calcBasisFunctions(su,u,net.du,ku),bv=calcBasisFunctions(sv,v,net.dv,kv)
    let total=0,selected=0
    for(let i=0;i<=net.du;i++) for(let j=0;j<=net.dv;j++) {
      const id=(su-net.du+i)*net.nv+sv-net.dv+j, w=bu[i]*bv[j]*net.weights[id]
      total+=w; if(id===index) selected=w
    }
    if(total>0 && selected/total>minInfluence && classify(u,v)==='in') return {u,v}
  }
  return null
}
