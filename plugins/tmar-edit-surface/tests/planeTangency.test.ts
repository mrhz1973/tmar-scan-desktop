// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { OcctKernel } from 'occt-wasm'
import { replaceSurface, surfaceTable, type Net, type Point } from '../brep'
import { proposePlaneTangency, validatePlaneTangencyResult, validatePlaneTangencyConstraint, type NaturalEdge, type PlaneTangencyRequest } from '../planeTangency'
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

  it('rejects unsupported structures, non-normalized plane, invalid locks and insufficient knot continuity',()=> {
    const n=fixture()
    for (const normal of [[0,0,0],[0,0,2],[0,NaN,1]] as Point[])
      expect(()=>proposePlaneTangency({...request(n),plane:{point:[0,0,0],normal}})).toThrow()
    for (const lockIndices of [[-1],[16],[.5],[NaN]]) expect(()=>proposePlaneTangency({...request(n),lockIndices})).toThrow()
    for (const distanceTolerance of [0,-1,NaN,1]) expect(()=>proposePlaneTangency({...request(n),distanceTolerance})).toThrow()
    for (const broken of [{...n,periodic:[1,0] as [number,number]}, {...n,weights:n.weights.map(()=>0)},
      {...n,mu:[3,4]}, {...n,poles:n.poles.map(()=>[Infinity,0,0] as Point)}])
      expect(()=>proposePlaneTangency(request(broken))).toThrow()
    const crossMulti=refineClampedNet(n,[{axis:'U',value:1,count:3}])
    expect(()=>proposePlaneTangency(request(crossMulti))).toThrow(/continuità C1/)
    const alongMulti=refineClampedNet(n,[{axis:'V',value:6,count:3}])
    expect(()=>proposePlaneTangency(request(alongMulti))).toThrow(/continuità C1/)
  })

  it.each(['U0','U1','V0','V1'] as const)('proves every multi-span closed interval on %s, including C1 repeated knots',edge=> {
    for (const rational of [false,true]) {
      const along=edge[0]==='U'?'V':'U', across=along==='U'?'V':'U'
      const n=refineClampedNet(fixture(edge,rational),[
        {axis:along,value:along==='V'?6:0,count:2},
        {axis:along,value:along==='V'?8:3,count:1},
        {axis:across,value:across==='V'?7:1,count:2},
      ]), saved=structuredClone(n)
      const result=proposePlaneTangency(request(n,edge))
      expect(result.proofLeaves).toBeGreaterThanOrEqual(3)
      expect(result.edgeRegularity).toBe('outward-rounded-interval-proof')
      expect(result.changedIndices.length).toBeGreaterThan(0)
      expect(result.sampledMaxBoundaryNormalSin).toBeLessThan(1e-12)
      expect(n).toEqual(saved)
      expect({...result.net,poles:[]}).toEqual({...n,poles:[]})
      n.poles.forEach((p,id)=> {
        if (isPerimeter(id,n)||!result.changedIndices.includes(id)) expect(result.net.poles[id]).toEqual(p)
      })
    }
  })

  it('handles quadratic C1 spans and nonuniform knot intervals without changing structure',()=> {
    const n:Net={nu:3,nv:3,du:2,dv:2,ku:[-8,3],kv:[2,17],mu:[3,3],mv:[3,3],
      poles:Array.from({length:9},(_,id)=>[Math.floor(id/3),id%3,id===4?1:0]),weights:Array(9).fill(1),rational:[0,0]}
    const multi=refineClampedNet(n,[{axis:'V',value:2.25,count:1},{axis:'V',value:13,count:1},{axis:'U',value:1,count:1}])
    const result=proposePlaneTangency(request(multi))
    expect(result.proofLeaves).toBeGreaterThanOrEqual(3)
    expect(result.net.kv).toEqual([2,2.25,13,17])
    expect(result.sampledMaxBoundaryNormalSin).toBe(0)
  })

  it.each([.5,.65625])('fails closed for a multi-span singularity at t=%s (junction or between grid points)',root=> {
    const n=fixture('U0',false)
    // Cubic (t-root)^3 represented in Bernstein form on [0,1].
    const y=[-(root**3),root**2-root**3,-root+2*root**2-root**3,(1-root)**3]
    for(let i=0;i<4;i++) for(let j=0;j<4;j++) n.poles[i*4+j]=[i,y[j],0]
    n.kv=[0,1]
    const multi=refineClampedNet(n,[{axis:'V',value:.5,count:2}]), saved=structuredClone(multi)
    expect(()=>proposePlaneTangency(request(multi))).toThrow(/comprovabile|degenere|inversione/)
    expect(multi).toEqual(saved)
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

describe('pure validation of the actual final net',()=> {
  it.each(['U0','U1','V0','V1'] as const)('validates %s without reprojection or mutation, including multiple spans',edge=> {
    const along=edge[0]==='U'?'V':'U'
    const net=refineClampedNet(fixture(edge),[{axis:along,value:along==='U'?1:7,count:2}])
    const input=request(net,edge), result=proposePlaneTangency(input), saved=structuredClone({input,result})
    const validation=validatePlaneTangencyResult(input,result.net)
    expect(validation.edgeRegularity).toBe('outward-rounded-interval-proof')
    expect(validation.proofLeaves).toBeGreaterThanOrEqual(2)
    expect(validation.globalG1Certified).toBe(false)
    expect(validation.protectedPoleCount).toBeGreaterThan(0)
    expect({input,result}).toEqual(saved)
    // A valid in-plane change need not equal the projection regenerated from
    // the base. The validator checks invariants and geometry of this actual net.
    const alternate=structuredClone(result.net)
    alternate.poles[result.changedIndices[0]][edge[0]==='U'?1:0]+=.01
    expect(()=>validatePlaneTangencyResult(input,alternate)).not.toThrow()
  })

  it('rejects even one-bit changes to the perimeter, other rows, explicit locks and protected tangent rows',()=> {
    const net=fixture(); net.poles[5][2]=0
    const input={...request(net),lockIndices:[5],preserveTangentEdges:['V0'] as NaturalEdge[]}
    const final=proposePlaneTangency(input).net
    for (const id of [0,1,5,9,10,15]) {
      const forged=structuredClone(final), saved=structuredClone(input)
      forged.poles[id][0]=forged.poles[id][0]===0?Number.MIN_VALUE:forged.poles[id][0]+Number.EPSILON*forged.poles[id][0]
      expect(()=>validatePlaneTangencyResult(input,forged)).toThrow(/punto protetto/)
      expect(input).toEqual(saved)
    }
    const signedZero=structuredClone(final); signedZero.poles[0][0]=-0
    expect(()=>validatePlaneTangencyResult(input,signedZero)).toThrow(/punto protetto/)
    for (const constraints of [{lockIndices:[5]},{lockIndices:[],preserveTangentEdges:['V0'] as NaturalEdge[]}]) {
      const isolated={...request(net),...constraints}, forged=structuredClone(final)
      forged.poles[5][0]+=.01
      expect(()=>validatePlaneTangencyResult(isolated,forged)).toThrow(/punto protetto/)
    }
  })

  it('rejects changed weights, knots, multiplicities, degrees, layout and invalid request parameters',()=> {
    const input=request(), final=proposePlaneTangency(input).net
    const weights=structuredClone(final); weights.weights[5]+=Number.EPSILON*weights.weights[5]
    const knots=structuredClone(final); knots.kv[0]+=Number.EPSILON*knots.kv[0]
    const degree=structuredClone(final); degree.dv=2; degree.mv=[3,4]
    const refined=refineClampedNet(final,[{axis:'V',value:6,count:1}])
    for (const forged of [weights,knots,degree,refined]) expect(()=>validatePlaneTangencyResult(input,forged)).toThrow()
    for (const invalid of [{...input,distanceTolerance:NaN},{...input,lockIndices:[16]},
      {...input,plane:{point:[0,0,0] as Point,normal:[0,0,2] as Point}}])
      expect(()=>validatePlaneTangencyResult(invalid,final)).toThrow()
  })

  it('checks plane residual and the continuous proof on the supplied net itself',()=> {
    const net=fixture('U0',false)
    net.poles=net.poles.map((p,id)=>[Math.floor(id/4)*3,p[1],p[2]])
    const input=request(net), final=proposePlaneTangency(input).net
    const offPlane=structuredClone(final); offPlane.poles[5][2]=.001
    expect(()=>validatePlaneTangencyResult(input,offPlane)).toThrow(/residuo del piano/)
    // Transverse derivative collapses at the midpoint of the selected edge;
    // the protected endpoints remain unchanged. These are exact dyadic values.
    const singular=structuredClone(final); singular.poles[5][0]=-1; singular.poles[6][0]=-1
    expect(()=>validatePlaneTangencyResult(input,singular)).toThrow(/comprovabile|degenere|inversione/)
    const interior=fixture('U0',false)
    interior.poles=interior.poles.map((_,id)=>[[0,2,0,2][Math.floor(id/4)],id%4,0])
    expect(()=>validatePlaneTangencyResult(request(interior),interior)).toThrow(/superficie degenere nei campioni/)
  })

  it('accepts floating-point residuals on an oblique plane without a second projection',()=> {
    const net=fixture(), c=Math.SQRT1_2
    net.poles=net.poles.map(([x,y,z])=>[c*x+c*z+7,y-3,-c*x+c*z+11])
    const input={...request(net),plane:{point:[7,-3,11] as Point,normal:[c,0,c] as Point}}
    const result=proposePlaneTangency(input), saved=structuredClone(result.net)
    expect(validatePlaneTangencyResult(input,result.net).maxPlaneCoefficientResidual).toBeLessThan(1e-12)
    expect(result.net).toEqual(saved)
  })

  it('fails closed on nonfinite inputs, overflowing and underflowing proof arithmetic',()=> {
    const flat=fixture(); flat.poles=flat.poles.map(([x,y])=>[x,y,0])
    const nonfinite=structuredClone(flat); nonfinite.poles[5][0]=Infinity
    const huge=structuredClone(flat); huge.weights=huge.weights.map(()=>1e308)
    const tiny=structuredClone(flat); tiny.weights=tiny.weights.map(()=>1e-300)
    const multi=refineClampedNet(flat,[{axis:'V',value:6,count:2}])
    const hugeKnots=structuredClone(multi); hugeKnots.kv=[-Number.MAX_VALUE,0,Number.MAX_VALUE]
    const tinyKnots=structuredClone(multi); tinyKnots.kv=[-Number.MIN_VALUE,0,Number.MIN_VALUE]
    for(const net of [nonfinite,huge,tiny,hugeKnots,tinyKnots]) {
      const saved=structuredClone(net)
      expect(()=>validatePlaneTangencyResult(request(net),net)).toThrow()
      expect(net).toEqual(saved)
    }
  })
})

describe('pure reassessment of a persistent plane condition',()=> {
  it.each(['U0','U1','V0','V1'] as const)('accepts later unconstrained interior edits for %s while the initial before/after validator remains strict',edge=> {
    const net=refineClampedNet(fixture(edge),[{axis:edge[0]==='U'?'V':'U',value:edge[0]==='U'?7:1,count:2}])
    const input=request(net,edge), current=proposePlaneTangency(input).net
    // Choose an interior pole outside the first interior row of this edge.
    const i=edge[0]==='U'?(edge==='U0'?2:1):2
    const j=edge[0]==='V'?(edge==='V0'?2:1):2
    const id=i*current.nv+j
    current.poles[id][2]+=.125
    const saved=structuredClone({input,current})
    const check=validatePlaneTangencyConstraint(input,current)
    expect(check.edgeRegularity).toBe('outward-rounded-interval-proof')
    expect(check.proofLeaves).toBeGreaterThanOrEqual(2)
    expect(check.sampledMaxBoundaryNormalSin).toBeLessThan(1e-12)
    expect(check.globalG1Certified).toBe(false)
    expect('protectedPoleCount' in check).toBe(false)
    expect(()=>validatePlaneTangencyResult(input,current)).toThrow(/punto protetto/)
    expect({input,current}).toEqual(saved)
  })

  it('checks current coefficient residuals, continuous edge regularity and observed interior regularity without repairing',()=> {
    const input=request(fixture('U0',false)), final=proposePlaneTangency(input).net
    const offPlane=structuredClone(final); offPlane.poles[5][2]=.001
    const collapsed=structuredClone(final)
    for(let j=0;j<4;j++) collapsed.poles[4+j]=[...collapsed.poles[j]]
    const interior=structuredClone(final)
    interior.poles=interior.poles.map((_,id)=>[[0,2,0,2][Math.floor(id/4)],id%4,0])
    for(const [net,reason] of [[offPlane,/residuo del piano/],[collapsed,/comprovabile|degenere/],
      [interior,/superficie degenere nei campioni/]] as const) {
      const saved=structuredClone(net)
      expect(()=>validatePlaneTangencyConstraint(input,net)).toThrow(reason)
      expect(net).toEqual(saved)
    }
  })

  it('rejects structural changes and malformed current nets or constraint parameters',()=> {
    const input=request(), final=proposePlaneTangency(input).net
    const weights=structuredClone(final); weights.weights[9]+=.01
    const knots=structuredClone(final); knots.ku[0]-=.01
    const rational=structuredClone(final); rational.rational=[0,1]
    const nonfinite=structuredClone(final); nonfinite.poles[9][2]=NaN
    const refined=refineClampedNet(final,[{axis:'U',value:0,count:1}])
    for(const net of [weights,knots,rational,nonfinite,refined])
      expect(()=>validatePlaneTangencyConstraint(input,net)).toThrow()
    for(const invalid of [{...input,distanceTolerance:Infinity},{...input,distanceTolerance:1e-5},
      {...input,edge:'U2' as NaturalEdge},{...input,lockIndices:[16]},
      {...input,preserveTangentEdges:['U0'] as NaturalEdge[]},
      {...input,plane:{point:[0,0,0] as Point,normal:[0,0,2] as Point}}])
      expect(()=>validatePlaneTangencyConstraint(invalid,final)).toThrow()
  })

  it('leaves lock and perimeter comparisons explicitly to the caller',()=> {
    const net=fixture(); net.poles[5][2]=0
    const input={...request(net),lockIndices:[9]}
    const current=proposePlaneTangency(input).net
    current.poles[9][2]+=.1 // The condition is intact; the edit violates the caller lock.
    expect(()=>validatePlaneTangencyConstraint(input,current)).not.toThrow()
    expect(()=>validatePlaneTangencyResult(input,current)).toThrow(/punto protetto/)
    // A tangent-plane-compatible perimeter move is likewise outside this API's guarantee.
    current.poles[0][1]-=.01
    expect(()=>validatePlaneTangencyConstraint(input,current)).not.toThrow()
  })
})

it.each([{rational:false,multi:false},{rational:true,multi:false},{rational:false,multi:true},{rational:true,multi:true}])('OCCT verifies plane normals, changed interior and unchanged full boundary; STEP roundtrip (%j)',async ({rational,multi})=> {
  const k=await OcctKernel.init(), owned:ReturnType<typeof k.makeBox>[]=[]
  const own=<T extends ReturnType<typeof k.makeBox>>(h:T):T=>{owned.push(h);return h}
  try {
    const box=own(k.makeBox(6,9,2)), faces=k.getSubShapes(box,'face'); owned.push(...faces)
    const plane=faces.find(f=>{const b=k.uvBounds(f);return Math.abs(k.pointOnSurface(f,(b.uMin+b.uMax)/2,(b.vMin+b.vMax)/2).z-2)<1e-9})!
    const text=k.toBREP(plane), record=surfaceTable(text).find(r=>r.kind===1)!, bounds=k.uvBounds(plane)
    let n=fixture('U0',rational)
    n.ku=[bounds.uMin,bounds.uMax]; n.kv=[bounds.vMin,bounds.vMax]
    // Use the kernel's plane frame so trim and UV coordinates agree with its BREP.
    n.poles=n.poles.map((p,id)=> {
      const i=Math.floor(id/4),j=id%4, base=k.pointOnSurface(plane,bounds.uMin+(bounds.uMax-bounds.uMin)*i/3,bounds.vMin+(bounds.vMax-bounds.vMin)*j/3)
      return [base.x,base.y,base.z+p[2]]
    })
    if (multi) n=refineClampedNet(n,[
      {axis:'V',value:bounds.vMin+(bounds.vMax-bounds.vMin)*.37,count:2},
      {axis:'V',value:bounds.vMin+(bounds.vMax-bounds.vMin)*.71,count:1},
    ])
    const input={...request(n),plane:{point:[0,0,2] as Point,normal:[0,0,1] as Point}}
    const result=proposePlaneTangency(input)
    expect(validatePlaneTangencyResult(input,result.net).proofLeaves).toBeGreaterThanOrEqual(multi?3:1)
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
    const later=structuredClone(result.net), laterId=2*later.nv+Math.floor(later.nv/2)
    later.poles[laterId][2]+=.25
    const savedLater=structuredClone(later)
    expect(validatePlaneTangencyConstraint(input,later).globalG1Certified).toBe(false)
    expect(()=>validatePlaneTangencyResult(input,later)).toThrow(/punto protetto/)
    const laterFace=build(own(k.fromBREP(replaceSurface(text,record,later))),later)
    expect(k.isValid(laterFace)).toBe(true)
    const laterRound=own(k.importStep(k.exportStep(laterFace)))
    const laterReopened=k.getSubShapes(laterRound,'face'); owned.push(...laterReopened)
    expect(k.isValid(laterRound)).toBe(true); expect(laterReopened).toHaveLength(1)
    const midpointU=(bounds.uMin+bounds.uMax)/2, midpointV=(bounds.vMin+bounds.vMax)/2
    expect(Math.abs(k.pointOnSurface(laterFace,midpointU,midpointV).z-k.pointOnSurface(afterFace,midpointU,midpointV).z)).toBeGreaterThan(.001)
    expect(later).toEqual(savedLater)
    const readback=surfaceTable(k.toBREP(beforeFace)).find(r=>r.net)!.net!, savedReadback=structuredClone(readback)
    const nativeProposal=proposePlaneTangency({...input,net:readback})
    expect(nativeProposal.proofLeaves).toBeGreaterThanOrEqual(multi?3:1)
    expect(nativeProposal.net.ku).toEqual(readback.ku)
    expect(nativeProposal.net.kv).toEqual(readback.kv)
    // Refusal checks on the actual OCCT serialization, not only the original
    // JavaScript fixture; rejected proposals never change the kernel shape.
    expect(()=>proposePlaneTangency({...input,net:readback,lockIndices:[n.nv+1]})).toThrow(/incompatibile/)
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
    for (const actual of [afterFace,reopened[0],laterFace,laterReopened[0]]) {
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
      // Explicitly query both C1 repeated-knot joins and both sides. The usual
      // uniform grid does not land on .37/.71, so it cannot serve as this oracle.
      if (multi) for (const v0 of n.kv.slice(1,-1)) for (const side of [-1,0,1]) {
        const v=v0+side*(bounds.vMax-bounds.vMin)*1e-9
        const normal=k.surfaceNormal(actual,bounds.uMin,v)
        expect(Math.hypot(normal.x,normal.y)).toBeLessThan(1e-9)
        const a=k.pointOnSurface(beforeFace,bounds.uMin,v),b=k.pointOnSurface(actual,bounds.uMin,v)
        expect(Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)).toBeLessThan(1e-8)
      }
    }
    expect(interiorMovement).toBeGreaterThan(.1)
    expect(maximumNormalError).toBeLessThan(1e-9)
    expect(result.globalG1Certified).toBe(false)
  } finally {for (const h of owned.reverse()) k.release(h);k[Symbol.dispose]()}
},60000)
