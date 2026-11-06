// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { OcctKernel } from 'occt-wasm'
import { planeNet, replaceSurface, surfaceTable, type Net, type Point } from '../brep'
import { targetSurfacePoint, type SurfacePointTarget } from '../surfacePointTarget'

const fixture = (): Net => ({ nu:4,nv:4,du:3,dv:3,ku:[-2,8],kv:[3,9],mu:[4,4],mv:[4,4],rational:[1,1],
  weights:Array.from({length:16},(_,i)=>1+i/11),poles:Array.from({length:16},(_,i)=>[Math.floor(i/4)*2,i%4*3,Math.sin(i)]) })
const request = (overrides: Partial<SurfacePointTarget> = {}): SurfacePointTarget => ({u:1.7,v:6.8,target:[2,4,1],
  editablePoles:[5,6,9,10],maxPoleDisplacement:100,minInfluence:.01,residualTolerance:1e-10,...overrides})
// Independent bicubic Bernstein oracle: no production evaluator or NURBSUtils.
function bernstein(n: Net, u: number, v: number): Point {
  const b=(t:number)=>[(1-t)**3,3*t*(1-t)**2,3*t*t*(1-t),t**3]
  const a=b((u+2)/10),c=b((v-3)/6),out:Point=[0,0,0];let sum=0
  for(let i=0;i<4;i++) for(let j=0;j<4;j++) {
    const id=i*4+j,w=a[i]*c[j]*n.weights[id];sum+=w
    for(let d=0;d<3;d++) out[d]+=w*n.poles[id][d]
  }
  return out.map(x=>x/sum) as Point
}

it('targets the actual rational surface, preserves the basis and every unauthorized pole, and minimizes squared motion',()=>{
  const n=fixture(),saved=structuredClone(n),r=request(),result=targetSurfacePoint(n,r)
  bernstein(result.net,r.u,r.v).forEach((x,d)=>expect(x).toBeCloseTo(r.target[d],11))
  bernstein(n,r.u,r.v).forEach((x,d)=>expect(result.before[d]).toBeCloseTo(x,12))
  expect(n).toEqual(saved)
  expect({...result.net,poles:[]}).toEqual({...n,poles:[]})
  n.poles.forEach((p,i)=>{if(!r.editablePoles.includes(i)) expect(result.net.poles[i]).toEqual(p)})
  // Feasible null-space perturbation of two authorized poles increases norm.
  const coefficient=(id:number)=>{
    const unit=structuredClone(n);unit.poles=unit.poles.map(()=>[0,0,0]);unit.poles[id]=[1,0,0]
    return bernstein(unit,r.u,r.v)[0]
  }
  const alternate=structuredClone(result.net),[i,j]=r.editablePoles
  alternate.poles[i][0]+=.2*coefficient(j);alternate.poles[j][0]-=.2*coefficient(i)
  const energy=(net:Net)=>net.poles.reduce((s,p,i)=>s+p.reduce((q,x,d)=>q+(x-n.poles[i][d])**2,0),0)
  expect(energy(alternate)).toBeGreaterThan(energy(result.net))
  bernstein(alternate,r.u,r.v).forEach((x,d)=>expect(x).toBeCloseTo(r.target[d],11))
})

it('refuses unreachable or weakly influenced points and movement budgets without mutating input',()=>{
  const n=fixture(),saved=structuredClone(n)
  expect(()=>targetSurfacePoint(n,request({u:-2,v:3}))).toThrow(/Influenza/)
  expect(()=>targetSurfacePoint(n,request({editablePoles:[5],minInfluence:.9}))).toThrow(/Influenza/)
  expect(()=>targetSurfacePoint(n,request({maxPoleDisplacement:.001}))).toThrow(/limite/)
  expect(n).toEqual(saved)
})

it('handles clamped endpoints, unchanged targets and common large rational weight scaling',()=>{
  const n=fixture(),r=request({u:8,v:9,editablePoles:[15],target:[8,11,2]})
  const result=targetSurfacePoint(n,r)
  expect(result.after).toEqual(r.target);expect(result.influence).toBe(1)
  const identity=targetSurfacePoint(n,request({target:bernstein(n,1.7,6.8)}))
  expect(identity.maxPoleDisplacement).toBeLessThan(1e-12)
  const huge=structuredClone(n);huge.weights=huge.weights.map(w=>w*1e300)
  const scaled=targetSurfacePoint(huge,request())
  scaled.after.forEach((x,d)=>expect(x).toBeCloseTo(request().target[d],10))
})

it('rejects malformed requests, unsupported nets and numerical overflow',()=>{
  const n=fixture()
  for(const bad of [{u:9},{v:NaN},{editablePoles:[]},{editablePoles:[5,5]},{editablePoles:[-1]},
    {minInfluence:0},{minInfluence:2},{residualTolerance:0},{maxPoleDisplacement:Infinity},
    {target:[Infinity,0,0] as Point}]) expect(()=>targetSurfacePoint(n,request(bad))).toThrow()
  expect(()=>targetSurfacePoint({...n,periodic:[1,0]},request())).toThrow()
  expect(()=>targetSurfacePoint({...n,weights:n.weights.map(()=>0)},request())).toThrow()
  const overflow=structuredClone(n);overflow.poles=overflow.poles.map(()=>[-1e308,0,0])
  expect(()=>targetSurfacePoint(overflow,request({target:[1e308,0,0],maxPoleDisplacement:1e308}))).toThrow()
  const cancellation=structuredClone(n);cancellation.poles[15]=[1e16,0,0]
  expect(()=>targetSurfacePoint(cancellation,request({u:8,v:9,editablePoles:[15],target:[1,0,0],
    maxPoleDisplacement:1e17,residualTolerance:1e-6}))).toThrow(/Residuo/)
})

it('independently checks the target and protected G1 boundary points/normals with OCCT on a refined net',async()=>{
  const k=await OcctKernel.init(),owned:ReturnType<typeof k.makeBox>[]=[]
  const own=<T extends ReturnType<typeof k.makeBox>>(h:T):T=>{owned.push(h);return h}
  try {
    const body=own(k.makeBox(20,30,10)),faces=k.getSubShapes(body,'face');owned.push(...faces)
    const face=faces.find(f=>{const b=k.uvBounds(f);return Math.abs(k.pointOnSurface(f,(b.uMin+b.uMax)/2,(b.vMin+b.vMax)/2).z-10)<1e-8})!
    const bounds=k.uvBounds(face),text=k.toBREP(face),record=surfaceTable(text).find(r=>r.kind===1)!
    const n=planeNet(record,[bounds.uMin,bounds.uMax,bounds.vMin,bounds.vMax])
    n.rational=[1,1];n.weights[12]=1.7
    const before=own(k.fromBREP(replaceSurface(text,record,n))),u=(bounds.uMin+bounds.uMax)/2,v=(bounds.vMin+bounds.vMax)/2
    const p=k.pointOnSurface(before,u,v),target:Point=[p.x,p.y,p.z+.2]
    // In a bicubic 5x5 net only pole 12 is outside both protected G1 rings.
    const result=targetSurfacePoint(n,request({u,v,target,editablePoles:[12]}))
    const after=own(k.fromBREP(replaceSurface(text,record,result.net))),actual=k.pointOnSurface(after,u,v)
    expect(Math.hypot(actual.x-target[0],actual.y-target[1],actual.z-target[2])).toBeLessThan(1e-10)
    for(let i=0;i<=8;i++) for(const [s,t] of [[bounds.uMin,bounds.vMin+(bounds.vMax-bounds.vMin)*i/8],
      [bounds.uMax,bounds.vMin+(bounds.vMax-bounds.vMin)*i/8],
      [bounds.uMin+(bounds.uMax-bounds.uMin)*i/8,bounds.vMin],
      [bounds.uMin+(bounds.uMax-bounds.uMin)*i/8,bounds.vMax]]) {
      const a=k.pointOnSurface(before,s,t),b=k.pointOnSurface(after,s,t)
      expect(Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)).toBeLessThan(1e-10)
      const na=k.surfaceNormal(before,s,t),nb=k.surfaceNormal(after,s,t)
      expect(na.x*nb.x+na.y*nb.y+na.z*nb.z).toBeGreaterThan(1-1e-12)
    }
  } finally {for(const h of owned.reverse()) k.release(h)}
})
