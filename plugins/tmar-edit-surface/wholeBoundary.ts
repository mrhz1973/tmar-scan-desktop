// SPDX-License-Identifier: AGPL-3.0-only
import { Vector4 } from 'three'
import { NURBSCurve } from 'three/examples/jsm/curves/NURBSCurve.js'
import type { Net, Point } from './brep'
import { refineClampedNet } from './refineClampedNet'

export type WholeBoundarySide = 'U0' | 'U1' | 'V0' | 'V1'
export const WHOLE_BOUNDARY_SEGMENTS=64
export function wholeBoundaryIndices(net:Net,side:WholeBoundarySide):number[] {
  if(!['U0','U1','V0','V1'].includes(side))throw Error('Bordo naturale non valido.')
  return side==='U0' || side==='U1'
    ? Array.from({length:net.nv},(_,v)=>(side==='U0'?0:net.nu-1)*net.nv+v)
    : Array.from({length:net.nu},(_,u)=>u*net.nv+(side==='V0'?0:net.nv-1))
}
/** Display/pick samples only; editing always changes the exact complete row. */
export function wholeBoundaryPath(net:Net,side:WholeBoundarySide):Point[] {
  const n=refineClampedNet(net,[]),ids=wholeBoundaryIndices(n,side),alongV=side==='U0'||side==='U1'
  const knots=alongV?n.kv:n.ku,mult=alongV?n.mv:n.mu,degree=alongV?n.dv:n.du
  const curve=new NURBSCurve(degree,knots.flatMap((k,i)=>Array<number>(mult[i]).fill(k)),
    ids.map(i=>new Vector4(...n.poles[i],n.weights[i])))
  return Array.from({length:WHOLE_BOUNDARY_SEGMENTS+1},(_,i)=>{
    const p=curve.getPoint(i/WHOLE_BOUNDARY_SEGMENTS)
    if(![p.x,p.y,p.z].every(Number.isFinite))throw Error('Bordo naturale non rappresentabile.')
    return [p.x,p.y,p.z]
  })
}
