// SPDX-License-Identifier: AGPL-3.0-only
import { expect,it } from 'vitest'
import type { Net } from '../brep'
import { wholeBoundaryIndices,wholeBoundaryPath } from '../wholeBoundary'

it.each(['U0','U1','V0','V1'] as const)('samples the actual rational %s curve rather than its control polygon',side=>{
  const net:Net={nu:4,nv:4,du:3,dv:3,ku:[-7,13],kv:[2,5],mu:[4,4],mv:[4,4],rational:[1,1],
    poles:Array.from({length:16},(_,i)=>[Math.floor(i/4)*2,i%4*3,Math.sin(i)]),weights:Array.from({length:16},(_,i)=>1+i/5)}
  const before=structuredClone(net),ids=wholeBoundaryIndices(net,side),path=wholeBoundaryPath(net,side)
  expect(path).toHaveLength(65)
  path.forEach((p,i)=>{
    const t=i/64,b=[(1-t)**3,3*t*(1-t)**2,3*t*t*(1-t),t**3]
    const denominator=ids.reduce((s,id,j)=>s+b[j]*net.weights[id],0)
    for(let d=0;d<3;d++)expect(p[d]).toBeCloseTo(ids.reduce((s,id,j)=>s+b[j]*net.weights[id]*net.poles[id][d],0)/denominator,11)
  })
  expect(path[0]).toEqual(net.poles[ids[0]])
  expect(path.at(-1)).toEqual(net.poles[ids.at(-1)!])
  expect(net).toEqual(before)
})
