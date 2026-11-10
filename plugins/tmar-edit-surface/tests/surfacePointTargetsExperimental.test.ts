// SPDX-License-Identifier: AGPL-3.0-only
import {expect,it} from 'vitest'
import type {Net} from '../brep'
import {targetSurfacePoint} from '../surfacePointTarget'
import {targetSurfacePointsExperimental,type SimultaneousSurfaceTargets} from '../surfacePointTargetsExperimental'

const source=():Net=>({nu:4,nv:4,du:3,dv:3,poles:Array.from({length:16},(_,i)=>[Math.floor(i/4),i%4,0]),
  weights:Array.from({length:16},(_,i)=>1+i/32),rational:[1,1],ku:[0,1],kv:[0,1],mu:[4,4],mv:[4,4]})
const request=():SimultaneousSurfaceTargets=>({points:[{u:.2,v:.3,target:[.63,.92,.02]},{u:.75,v:.7,target:[2.27,2.11,-.01]}],
  editablePoles:Array.from({length:16},(_,i)=>i),maxPoleDisplacement:1,minInfluence:.01,residualTolerance:1e-9})

it('preserves the first accepted contact while adding a second, with fixed rational basis and only authorized poles',()=>{
  const n=source(),saved=structuredClone(n),r=request(),first=targetSurfacePoint(n,{...r,...r.points[0]})
  const sequential=targetSurfacePoint(first.net,{...r,...r.points[1]})
  const drift=targetSurfacePoint(sequential.net,{...r,...r.points[0]}).before
  expect(Math.hypot(...drift.map((x,d)=>x-r.points[0].target[d]))).toBeGreaterThan(1e-5)
  const result=targetSurfacePointsExperimental(first.net,r)
  expect(Math.max(...result.residuals)).toBeLessThanOrEqual(r.residualTolerance)
  expect(n).toEqual(saved);expect({...result.net,poles:[]}).toEqual({...n,poles:[]})
  const limited=request();limited.editablePoles=[5,6,9,10]
  const protectedResult=targetSurfacePointsExperimental(n,limited)
  n.poles.forEach((p,i)=>{if(!limited.editablePoles.includes(i))expect(protectedResult.net.poles[i]).toEqual(p)})
})

it('refuses duplicate/contradictory, insufficient influence, aggregate budget and incompatible constraints without changing the source',()=>{
  const n=source(),saved=structuredClone(n),r=request()
  expect(()=>targetSurfacePointsExperimental(n,{...r,points:[r.points[0],{...r.points[0],target:[0,0,1]}]})).toThrow(/ambigui/)
  expect(()=>targetSurfacePointsExperimental(n,{...r,editablePoles:[0],minInfluence:.9})).toThrow(/Influenza/)
  expect(()=>targetSurfacePointsExperimental(n,{...r,maxPoleDisplacement:.001})).toThrow(/limite/)
  // One authorized pole cannot independently produce two opposing Z offsets.
  const a=targetSurfacePoint(n,{...r,...r.points[0]}).before,b=targetSurfacePoint(n,{...r,...r.points[1]}).before
  expect(()=>targetSurfacePointsExperimental(n,{...r,editablePoles:[5],minInfluence:1e-8,
    points:[{u:.2,v:.3,target:[a[0],a[1],.01]},{u:.75,v:.7,target:[b[0],b[1],-.01]}]})).toThrow(/non risolti|limite/)
  expect(n).toEqual(saved)
})
