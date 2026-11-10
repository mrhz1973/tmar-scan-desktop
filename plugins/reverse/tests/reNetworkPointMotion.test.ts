// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../../../src/core/types'
import { ScanPaths } from '../../../src/core/geometry/scanPath'
import { NominalSurface } from '../../../src/core/deviation/surface'
import { readNetwork } from '../core/network'
import { patchPoint } from '../core/networkSpline'
import { offsetFromDelta, offsetDelta, pointProtected, validatePointOffsets, parsePointKey, pointKey } from '../core/networkPointMotion'
import { createCentreOffset } from '../core/networkNormalMotion'
import { networkDraftOf, setPointOffset, undoNetwork, redoNetwork, cloneData, moveNode, moveGrip, insertGrip, removeGrip, splitAtGrip, splitCurve } from '../state/reNetworkDraft'
import { validateReversePart } from '../app/projectSection'
import { gridScan, gridNetwork } from './networkMeshes'
import { ReKernel } from '../core/kernel'
import { Builder } from '../core/build'
import { build } from './reKit'

const mesh=gridScan(40,40,(u,v)=>[40*u,40*v,0])
const scan=new ScanPaths(mesh.positions,mesh.indices)
const make=()=>gridNetwork(1,2,2,(u,v)=>[40*u,40*v,0],1,[.125,.875,.125,.875])
const part=(f:unknown)=>JSON.parse(JSON.stringify({version:3,nextFeatureId:2,nextOfKind:{},features:[f]}))
const near=(a:readonly number[],b:readonly number[])=>Math.hypot(...a.map((v,i)=>v-b[i]))

describe('network nodes and curve grips: topology anchors versus 3D targets',()=>{
  it('keeps every scan array and cell while lifting the node shared by four patches',()=>{
    const f=make(),base=readNetwork(scan,f),before=JSON.stringify(f),positions=mesh.positions.slice()
    const d=setPointOffset(networkDraftOf(f),{kind:'node',id:5},offsetFromDelta([20,20,0],[.15,-.1,.6]))
    const r=readNetwork(scan,{...f,...cloneData(d)})
    expect(JSON.stringify(f)).toBe(before);expect(mesh.positions).toEqual(positions)
    expect(r.outcomes).toEqual(base.outcomes);expect(r.fit!.patches).toHaveLength(4)
    expect(r.traced.nodes.map(n=>n.at)).toEqual(base.traced.nodes.map(n=>n.at))
    const coordinates=[[0,0],[1,0],[1,1],[0,1]]
    for(const p of r.fit!.patches){const corner=p.corners.indexOf(5);expect(corner).toBeGreaterThanOrEqual(0)
      const q:Vec3=[0,0,0];patchPoint(p.net,coordinates[corner][0],coordinates[corner][1],q)
      expect(near(q,base.traced.nodes.find(n=>n.id===5)!.at.map((v,i)=>v+[.15,-.1,.6][i]))).toBeLessThan(1e-4)
    }
    expect(r.fit!.shared.every(s=>s.gap<1e-8)).toBe(true)
    expect(r.fit!.shared.every(s=>Number.isFinite(s.angle))).toBe(true)
  })
  it('moves an interior curve grip without changing its scan route or treating it as an exact interpolated pole',()=>{
    const f=make(),c=f.curves.find(c=>c.from===2&&c.to===5)!,original=readNetwork(scan,f)
    const d=setPointOffset(networkDraftOf(f),{kind:'grip',curve:c.id,index:0},offsetFromDelta(c.via[0],[0,0,.7]))
    const r=readNetwork(scan,{...f,...cloneData(d)})
    expect(r.traced.curves.find(x=>x.id===c.id)!.trace.points).toEqual(original.traced.curves.find(x=>x.id===c.id)!.trace.points)
    expect(r.traced.curves.find(x=>x.id===c.id)!.fitPoints!.points.some((v,i)=>i%3===2&&v>.65)).toBe(true)
    expect(r.fit!.shared.every(s=>s.gap<1e-8)).toBe(true)
    expect(r.fit!.patches.some(p=>p.net.poles.some((v,i)=>i%3===2&&Math.abs(v)>.05))).toBe(true)
  })
  it('handles a true tilted normal, not only world Z',()=>{
    const at=(u:number,v:number):Vec3=>[40*u,32*v,10*v]
    const m=gridScan(40,40,at),s=new ScanPaths(m.positions,m.indices),f=gridNetwork(1,2,2,at,0,[.125,.875,.125,.875])
    const n=f.nodes.find(n=>n.id===5)!,normal:Vec3=[0,-10,32],length=Math.hypot(...normal)
    const baseline=readNetwork(s,f);n.offset=createCentreOffset(n.at,normal,-.4)
    const r=readNetwork(s,f),coords=[[0,0],[1,0],[1,1],[0,1]],expected=baseline.traced.nodes.find(n=>n.id===5)!.at.map((v,i)=>v-normal[i]/length*.4)
    for(const p of r.fit!.patches){const i=p.corners.indexOf(5),q:Vec3=[0,0,0];patchPoint(p.net,coords[i][0],coords[i][1],q);expect(near(q,expected)).toBeLessThan(1e-4)}
  })
  it('stores one local action, restores Undo/Redo and rejects a stale/malformed saved offset',()=>{
    const f=make(),d=networkDraftOf(f),p={kind:'node' as const,id:5},o=offsetFromDelta([20,20,0],[.1,.2,.3])
    const next=setPointOffset(d,p,o)
    expect(next.history).toHaveLength(1);expect(undoNetwork(next).nodes).toEqual(d.nodes)
    expect(redoNetwork(undoNetwork(next)).nodes).toEqual(next.nodes)
    expect(setPointOffset(undoNetwork(next),p,offsetFromDelta([20,20,0],[0,0,-.2])).future).toEqual([])
    const saved=part({...f,...cloneData(next)}),opened=validateReversePart(saved).features[0]
    expect(opened.kind).toBe('network');if(opened.kind!=='network')throw Error('type')
    expect(opened.nodes.find(n=>n.id===5)!.offset).toEqual(o)
    saved.features[0].nodes.find((n:{id:number})=>n.id===5).offset.anchor[0]+=1
    expect(()=>validateReversePart(saved)).toThrow()
    expect(()=>setPointOffset(d,p,{...o,units:'cm'} as never)).toThrow()
  })
  it('reanchors on-scan movement without dropping the accumulated vector',()=>{
    const f=make(),c=f.curves[0]
    let d=setPointOffset(networkDraftOf(f),{kind:'node',id:5},offsetFromDelta([20,20,0],[.1,.2,.3]))
    d=moveNode(d,5,[21,20,0]);expect(d.nodes.find(n=>n.id===5)!.offset!.anchor).toEqual([21,20,0])
    expect(near(offsetDelta(d.nodes.find(n=>n.id===5)!.offset),[.1,.2,.3])).toBeLessThan(1e-12)
    d=setPointOffset(d,{kind:'grip',curve:c.id,index:0},offsetFromDelta(c.via[0],[0,0,.5]))
    d=moveGrip(d,c.id,0,[13,5,0]);expect(d.curves[0].viaOffsets![0]!.anchor).toEqual([13,5,0])
    validatePointOffsets(d)
  })
  it('does not silently erase a displaced grip when removing or promoting it',()=>{
    const f=make(),c=f.curves[0],d=setPointOffset(networkDraftOf(f),{kind:'grip',curve:c.id,index:0},offsetFromDelta(c.via[0],[0,0,.5]))
    expect(removeGrip(d,c.id,0).curves[0].viaOffsets).toEqual([])
    const split=splitAtGrip(d,c.id,0)!
    expect(split.draft.nodes.find(n=>n.id===split.node)!.offset).toEqual(d.curves[0].viaOffsets![0])
    validatePointOffsets(split.draft)
    expect(()=>insertGrip(d,c.id,0,[10,5,0])).toThrow('Azzera')
    expect(()=>splitCurve(d,c.id,0,[10,5,0])).toThrow('azzera')
    expect(d.curves[0].viaOffsets![0]!.distance).toBe(.5)
  })
  it('protects body-constrained points and rejects mismatched grip arrays',()=>{
    const f=make();f.curves[0].along={body:4,edge:{} as never}
    expect(pointProtected(f,{kind:'node',id:f.curves[0].from})).toBe(true)
    expect(()=>setPointOffset(networkDraftOf(f),{kind:'grip',curve:1,index:0},offsetFromDelta(f.curves[0].via[0],[0,0,1]))).toThrow('vincolato')
    const g=make();g.curves[0].viaOffsets=[];expect(()=>validatePointOffsets(g)).toThrow('lunghezze')
  })
  it('has exact unambiguous UI point identifiers',()=>{
    for(const p of [{kind:'node' as const,id:5},{kind:'grip' as const,curve:7,index:0},{kind:'centre' as const,cell:0}])expect(parsePointKey(pointKey(p))).toEqual(p)
    for(const s of ['node:2:3','grip:1','node:NaN','grip:1:-1'])expect(parsePointKey(s)).toBeNull()
  })
  it('builds sewn CAD and reopens node and grip offsets without flattening them',async()=>{
    const f=make(),c=f.curves.find(c=>c.from===2&&c.to===5)!
    let d=setPointOffset(networkDraftOf(f),{kind:'node',id:5},offsetFromDelta([20,20,0],[0,0,.6]))
    d=setPointOffset(d,{kind:'grip',curve:c.id,index:0},offsetFromDelta(c.via[0],[0,0,.25]))
    const feature={...f,...cloneData(d)},k=await ReKernel.load(),b=new Builder(k)
    b.setScan(new NominalSurface(mesh.positions,mesh.indices),mesh.positions)
    const out=await build(b,[feature]);expect(out.results[0].status).toBe('ok')
    expect(out.bodies[0].faces).toBe(4);expect(out.results[0].network!.worstGap).toBeLessThan(.005)
    expect(b.verifyStep([1],b.exportStep([1])).ok).toBe(true)
    const reopened=validateReversePart(part(feature)).features[0],again=new Builder(k)
    again.setScan(new NominalSurface(mesh.positions,mesh.indices),mesh.positions)
    if(reopened.kind!=='network')throw Error('Reopened wrong feature');const out2=await build(again,[reopened]);expect(out2.results[0].status).toBe('ok')
    expect(again.verifyStep([1],again.exportStep([1])).ok).toBe(true)
    expect(out2.results[0].network!.patches.map(p=>Array.from(p.grid))).toEqual(out.results[0].network!.patches.map(p=>Array.from(p.grid)))
  },120000)
})

// Stale preview must not authorize a new displaced draft synchronously.
it('invalidates old geometry immediately but not for selection or direction alone',async()=>{
 const {useReverse}=await import('../state/reStore')
 const previous=useReverse.getState()
 try{
  useReverse.setState({featureDraft:{kind:'network',...networkDraftOf(make())},preview:{status:'ok'} as never})
  useReverse.getState().editNetwork(d=>({...d,pointMotion:'normal',pointPicked:{kind:'node',id:5}}))
  expect(useReverse.getState().preview.status).toBe('ok')
  useReverse.getState().editNetwork(d=>setPointOffset(d,{kind:'node',id:5},offsetFromDelta([20,20,0],[0,0,.5])))
  expect(useReverse.getState().preview.status).toBe('idle')
  expect(useReverse.getState().commitFeature()).toBeNull()
 }finally{useReverse.setState(previous,true)}
})


it('keeps active-drag data and local history intact until release or cancellation',()=>{
 const initial=networkDraftOf(make()),ref={kind:'node' as const,id:5}
 const first=setPointOffset(initial,ref,offsetFromDelta([20,20,0],[0,0,.5]))
 const active={...setPointOffset(first,ref,offsetFromDelta([20,20,0],[0,0,.8]),false),motionActive:true}
 expect(undoNetwork(active)).toBe(active)
 expect(redoNetwork({...undoNetwork(first),motionActive:true})).toEqual({...undoNetwork(first),motionActive:true})
 expect(undoNetwork({...active,motionActive:false}).nodes).toEqual(initial.nodes)
})
