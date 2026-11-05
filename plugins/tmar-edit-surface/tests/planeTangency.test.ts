// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { OcctKernel } from 'occt-wasm'
import { replaceSurface, surfaceTable, type Net, type Point } from '../brep'
import { proposePlaneTangency, type NaturalEdge, type PlaneTangencyRequest } from '../planeTangency'
import { refineClampedNet } from '../refineClampedNet'

function fixture(edge: NaturalEdge='U0', rational=true): Net {
  const poles: Point[]=Array.from({length:16},(_,id)=> {
    const i=Math.floor(id/4), j=id%4, across=edge[0]==='U'?i:j, along=edge[0]==='U'?j:i
    const inset=edge[1]==='0'?across:3-across
    return [i*2,j*3,inset===1&&along>0&&along<3?2:inset===2&&along>0&&along<3?.2:0]
  })
  return {nu:4,nv:4,du:3,dv:3,ku:[-2,5],kv:[4,9],mu:[4,4],mv:[4,4],poles,
    weights:poles.map((_,i)=>rational?1+i/13:1),rational:rational?[1,1]:[0,0]}
}
const request = (net=fixture(), edge: NaturalEdge='U0'): PlaneTangencyRequest => ({
  net,edge,plane:{point:[0,0,0],normal:[0,0,1]},lockIndices:[],distanceTolerance:1e-10,
})
const isPerimeter = (id: number,n: Net) => Math.floor(id/n.nv)===0||Math.floor(id/n.nv)===n.nu-1||id%n.nv===0||id%n.nv===n.nv-1

describe('pure natural-edge plane proposal',()=> {
  it.each(['U0','U1','V0','V1'] as const)('projects only the first inner row of %s with rational weights and preserves source/perimeter',edge=> {
    const input=request(fixture(edge),edge), saved=structuredClone(input)
    const out=proposePlaneTangency(input)
    expect(out.changedIndices).toHaveLength(2)
    expect(out.edgeRegularity).toBe('outward-rounded-interval-proof')
    expect(out.proofLeaves).toBeGreaterThan(0)
    expect(out.globalG1Certified).toBe(false)
    expect(out.sampledRegularity.count).toBe(81)
    expect(out.sampledMaxBoundaryNormalSin).toBeLessThan(1e-12)
    expect(input).toEqual(saved)
    for (let id=0;id<input.net.poles.length;id++) {
      if (isPerimeter(id,input.net)||!out.changedIndices.includes(id)) expect(out.net.poles[id]).toEqual(input.net.poles[id])
      else expect(out.net.poles[id][2]).toBe(0)
    }
    expect({...out.net,poles:[]}).toEqual({...input.net,poles:[]})
    out.net.poles[0][0]=100
    expect(input).toEqual(saved)
  })

  it('preserves an already compatible lock bit-for-bit and rejects conflicting locks/other tangent edges atomically',()=> {
    const n=fixture(), saved=structuredClone(n)
    expect(()=>proposePlaneTangency({...request(n),lockIndices:[5]})).toThrow(/incompatibile/)
    expect(()=>proposePlaneTangency({...request(n),preserveTangentEdges:['V0']})).toThrow(/incompatibile/)
    n.poles[5][2]=0
    const compatible=proposePlaneTangency({...request(n),lockIndices:[5]})
    expect(compatible.net.poles[5]).toEqual(n.poles[5]); expect(compatible.changedIndices).toEqual([6])
    const boundaryOff=structuredClone(saved); boundaryOff.poles[1][2]=.01
    expect(()=>proposePlaneTangency(request(boundaryOff))).toThrow(/bordo fuori/)
    const cornerConflict=structuredClone(saved); cornerConflict.poles[4][2]=.01
    expect(()=>proposePlaneTangency(request(cornerConflict))).toThrow(/incompatibile/)
    expect(saved).toEqual(fixture())
  })

  it('retains other tangent rings when compatible and handles an oblique translated plane',()=> {
    const n=fixture(), c=Math.SQRT1_2
    // Orthonormal rotation about Y and translation, applied to all poles.
    n.poles=n.poles.map(([x,y,z])=>[c*x+c*z+7,y-3,-c*x+c*z+11])
    const out=proposePlaneTangency({...request(n),plane:{point:[7,-3,11],normal:[c,0,c]}})
    expect(out.changedIndices).toEqual([5,6])
    expect(out.maxPlaneCoefficientResidual).toBeLessThan(1e-12)
    const compatible=fixture(); compatible.poles[5][2]=0; compatible.poles[6][2]=0
    const kept=proposePlaneTangency({...request(compatible),preserveTangentEdges:['V0','V1','U1']})
    expect(kept.changedIndices).toEqual([]); expect(kept.net).toEqual(compatible)
  })

  it('rejects unsupported structures, non-normalized plane, invalid locks and unproved multi-span edges',()=> {
    const n=fixture()
    for (const normal of [[0,0,0],[0,0,2],[0,NaN,1]] as Point[])
      expect(()=>proposePlaneTangency({...request(n),plane:{point:[0,0,0],normal}})).toThrow()
    for (const lockIndices of [[-1],[16],[.5],[NaN]]) expect(()=>proposePlaneTangency({...request(n),lockIndices})).toThrow()
    for (const distanceTolerance of [0,-1,NaN,1]) expect(()=>proposePlaneTangency({...request(n),distanceTolerance})).toThrow()
    for (const broken of [{...n,periodic:[1,0] as [number,number]}, {...n,weights:n.weights.map(()=>0)},
      {...n,mu:[3,4]}, {...n,poles:n.poles.map(()=>[Infinity,0,0] as Point)}])
      expect(()=>proposePlaneTangency(request(broken))).toThrow()
    const multi=refineClampedNet(n,[{axis:'V',value:6,count:1}])
    expect(()=>proposePlaneTangency(request(multi))).toThrow(/multi-span/)
    const crossMulti=refineClampedNet(n,[{axis:'U',value:1,count:3}])
    expect(()=>proposePlaneTangency(request(crossMulti))).toThrow(/continuità C1/)
  })

  it('rejects collapsed cross derivative, folded boundary and interior sampled singularity without mutating input',()=> {
    const collapsed=fixture('U0',false)
    for (let j=0;j<4;j++) collapsed.poles[4+j]=[...collapsed.poles[j]]
    const folded=fixture('U0',false)
    // Cubic y(t) with stationary point at t=1/2: continuous proof must fail.
    for (let i=0;i<4;i++) for (let j=0;j<4;j++) folded.poles[i*4+j][1]=[0,3,-3,0][j]
    const singular=fixture('U0',false)
    // x(t) derivative is zero at U midpoint, away from the selected U0 edge.
    for (let i=0;i<4;i++) for (let j=0;j<4;j++) singular.poles[i*4+j]=[[0,2,0,2][i],j,0]
    for (const n of [collapsed,folded,singular]) {
      const saved=structuredClone(n)
      expect(()=>proposePlaneTangency(request(n))).toThrow(/degenere|comprovabile|inversione/)
      expect(n).toEqual(saved)
    }
  })

  it('refuses an edge singularity between all grid samples, not just observed zero derivatives',()=> {
    const n=fixture('U0',false), y=[-.027,.063,-.147,.343]
    // y(t)=(t-.3)^3; y'(t)=3(t-.3)^2 vanishes at t=.3,
    // whereas the regularity grid contains only multiples of 1/8.
    for (let i=0;i<4;i++) for (let j=0;j<4;j++) n.poles[i*4+j]=[i*2,y[j],0]
    expect(()=>proposePlaneTangency(request(n))).toThrow(/comprovabile|degenere/)
  })
})

it.each([false,true])('OCCT verifies plane normals, changed interior and unchanged full boundary; STEP roundtrip (rational=%s)',async rational=> {
  const k=await OcctKernel.init(), owned:ReturnType<typeof k.makeBox>[]=[]
  const own=<T extends ReturnType<typeof k.makeBox>>(h:T):T=>{owned.push(h);return h}
  try {
    const box=own(k.makeBox(6,9,2)), faces=k.getSubShapes(box,'face'); owned.push(...faces)
    const plane=faces.find(f=>{const b=k.uvBounds(f);return Math.abs(k.pointOnSurface(f,(b.uMin+b.uMax)/2,(b.vMin+b.vMax)/2).z-2)<1e-9})!
    const text=k.toBREP(plane), record=surfaceTable(text).find(r=>r.kind===1)!, bounds=k.uvBounds(plane)
    const n=fixture('U0',rational)
    n.ku=[bounds.uMin,bounds.uMax]; n.kv=[bounds.vMin,bounds.vMax]
    // Use the kernel's plane frame so trim and UV coordinates agree with its BREP.
    n.poles=n.poles.map((p,id)=> {
      const i=Math.floor(id/4),j=id%4, base=k.pointOnSurface(plane,bounds.uMin+(bounds.uMax-bounds.uMin)*i/3,bounds.vMin+(bounds.vMax-bounds.vMin)*j/3)
      return [base.x,base.y,base.z+p[2]]
    })
    const input={...request(n),plane:{point:[0,0,2] as Point,normal:[0,0,1] as Point}}
    const result=proposePlaneTangency(input)
    const before=own(k.fromBREP(replaceSurface(text,record,n))), after=own(k.fromBREP(replaceSurface(text,record,result.net)))
    // Rebuild natural-boundary topology on the modified support; no stale
    // 3D edge curves/pcurves from the original plane are used in the oracle.
    const build=(support:typeof before,net:Net)=> {
      const boundary=(ids:number[],axis:'u'|'v')=>own(k.makeBSplineEdge(ids.flatMap(i=>net.poles[i]),ids.map(i=>net.weights[i]),axis==='u'?net.ku:net.kv,axis==='u'?net.mu:net.mv,axis==='u'?net.du:net.dv))
      const e0=Array.from({length:net.nu},(_,i)=>i*net.nv),e1=Array.from({length:net.nv},(_,j)=>(net.nu-1)*net.nv+j)
      const e2=Array.from({length:net.nu},(_,i)=>i*net.nv+net.nv-1).reverse(),e3=Array.from({length:net.nv},(_,j)=>j).reverse()
      const wire=own(k.makeWire([boundary(e0,'u'),boundary(e1,'v'),boundary(e2,'u'),boundary(e3,'v')]))
      return own(k.fixShape(own(k.makeFaceOnSurface(support,wire))))
    }
    const beforeFace=build(before,n), afterFace=build(after,result.net)
    expect(k.isValid(beforeFace)).toBe(true);expect(k.isValid(afterFace)).toBe(true)
    const readback=surfaceTable(k.toBREP(beforeFace)).find(r=>r.net)!.net!, savedReadback=structuredClone(readback)
    // Refusal checks on the actual OCCT serialization, not only the original
    // JavaScript fixture; rejected proposals never change the kernel shape.
    expect(()=>proposePlaneTangency({...input,net:readback,lockIndices:[5]})).toThrow(/incompatibile/)
    expect(()=>proposePlaneTangency({...input,net:readback,preserveTangentEdges:['V0']})).toThrow(/incompatibile/)
    const offPlane=structuredClone(readback);offPlane.poles[1][2]+=.01
    expect(()=>proposePlaneTangency({...input,net:offPlane})).toThrow(/bordo fuori/)
    const collapsed=structuredClone(readback)
    for(let j=0;j<collapsed.nv;j++) collapsed.poles[collapsed.nv+j]=[...collapsed.poles[j]]
    expect(()=>proposePlaneTangency({...input,net:collapsed})).toThrow(/degenere|comprovabile/)
    expect(readback).toEqual(savedReadback)
    expect(surfaceTable(k.toBREP(afterFace)).find(r=>r.net)?.net?.weights).toEqual(n.weights)
    const round=own(k.importStep(k.exportStep(afterFace))), reopened=k.getSubShapes(round,'face');owned.push(...reopened)
    expect(k.isValid(round)).toBe(true);expect(reopened).toHaveLength(1)
    const reNet=surfaceTable(k.toBREP(reopened[0])).find(r=>r.net)?.net
    if (rational) {
      expect(reNet?.weights).toHaveLength(n.weights.length)
      reNet!.weights.forEach((w,i)=>expect(w).toBeCloseTo(n.weights[i],11))
    }
    let maximumNormalError=0, interiorMovement=0
    for (const actual of [afterFace,reopened[0]]) {
      for (let i=0;i<=32;i++) for (let j=0;j<=32;j++) {
        const u=bounds.uMin+(bounds.uMax-bounds.uMin)*i/32,v=bounds.vMin+(bounds.vMax-bounds.vMin)*j/32
        const a=k.pointOnSurface(beforeFace,u,v),b=k.pointOnSurface(actual,u,v)
        const error=Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)
        if (i===0||i===32||j===0||j===32) expect(error).toBeLessThan(1e-8)
        else interiorMovement=Math.max(interiorMovement,error)
        if (i===0) {
          const normal=k.surfaceNormal(actual,u,v)
          maximumNormalError=Math.max(maximumNormalError,Math.hypot(normal.x,normal.y))
          expect(Math.abs(b.z-2)).toBeLessThan(1e-8)
        }
      }
    }
    expect(interiorMovement).toBeGreaterThan(.1)
    expect(maximumNormalError).toBeLessThan(1e-9)
    expect(result.globalG1Certified).toBe(false)
  } finally {for (const h of owned.reverse()) k.release(h);k[Symbol.dispose]()}
},60000)
