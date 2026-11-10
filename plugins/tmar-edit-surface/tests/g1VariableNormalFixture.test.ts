// SPDX-License-Identifier: AGPL-3.0-only
// Exact polynomial fixture for future variable-normal support work; no GUI.
import {describe,expect,it} from 'vitest'
import type {ShapeHandle} from 'occt-wasm'
import {SurfaceEditorKernel} from '../editorKernel'
import {replaceSurface,surfaceTable,type Net,type Point} from '../brep'
import {rebuildFreeBoundary} from '../freeBoundary'

async function fixture(){
  const editor=await SurfaceEditorKernel.load(),k=editor.kernel,owned:ShapeHandle[]=[]
  const own=(h:ShapeHandle)=>{owned.push(h);return h}
  const build=(start:number,curved:boolean)=>{
    const p=[{x:start,y:0,z:0},{x:start+10,y:0,z:0},{x:start+10,y:10,z:0},{x:start,y:10,z:0}]
    const seedWire=own(k.makeWire(p.map((a,i)=>own(k.makeLineEdge(a,p[(i+1)%4])))))
    const seed=own(k.makeFace(seedWire)),text=k.toBREP(seed),record=surfaceTable(text).find(r=>r.kind===1)!,b=k.uvBounds(seed)
    const poles:Point[]=[]
    // Cubic V basis with one midpoint knot; q and dq vanish at both ends.
    const q=[0,0,.2,0,0],greville=[0,1/6,.5,5/6,1]
    for(let u=0;u<4;u++)for(let v=0;v<5;v++)poles.push([start+10*u/3,10*greville[v],curved?(10*u/3)*q[v]:0])
    const net:Net={nu:4,nv:5,du:3,dv:3,poles,weights:poles.map(()=>1),rational:[0,0],ku:[b.uMin,b.uMax],kv:[b.vMin,(b.vMin+b.vMax)/2,b.vMax],mu:[4,4],mv:[4,1,4]}
    const support=own(k.fromBREP(replaceSurface(text,record,net)))
    const border=(ids:number[],axis:'u'|'v')=>{
      const points=ids.map(i=>net.poles[i]),a=points[0],z=points.at(-1)!,d=z.map((x,i)=>x-a[i]),length=Math.hypot(...d)
      const straight=points.every(p=>Math.hypot(...p.map((x,i)=>x-a[i]-(d[i]/length)*p.reduce((sum,y,j)=>sum+(y-a[j])*d[j]/length,0)))<1e-9)
      return straight?own(k.makeLineEdge({x:a[0],y:a[1],z:a[2]},{x:z[0],y:z[1],z:z[2]})):
        own(k.makeBSplineEdge(points.flat(),ids.map(i=>net.weights[i]),axis==='u'?net.ku:net.kv,axis==='u'?net.mu:net.mv,3))
    }
    const wire=own(k.makeWire([border([0,5,10,15],'u'),border([15,16,17,18,19],'v'),border([19,14,9,4],'u'),border([4,3,2,1,0],'v')]))
    const face=own(k.fixShape(own(k.makeFaceOnSurface(support,wire))))
    return {face,net}
  }
  try{
    const selected=build(0,false),support=build(10,true),shell=own(k.sew([selected.face,support.face],1e-7)),step=k.exportStep(shell)
    return {editor,k,selected,support,shell,step,dispose:()=>{owned.reverse().forEach(h=>k.release(h));editor.dispose()}}
  }catch(error){owned.reverse().forEach(h=>k.release(h));editor.dispose();throw error}
}

describe('OCCT variable-normal natural straight-edge fixture',()=>{
  it('contains two bicubic faces, one actual straight shared edge and an independently measured G1 defect',async()=>{
    const f=await fixture(),{k}=f
    try{
      expect(k.isValid(f.shell)).toBe(true)
      const faces=k.getSubShapes(f.shell,'face'),solids=k.getSubShapes(f.shell,'solid'),shared=k.sharedEdges(faces[0],faces[1])
      try{
        expect(faces).toHaveLength(2);expect(solids).toHaveLength(0);expect(shared).toHaveLength(1)
        expect(k.curveType(shared[0])).toBe('line');expect(k.curveLength(shared[0])).toBeCloseTo(10,8)
        for(const face of faces){
          expect(k.surfaceType(face)).toBe('bspline')
          const text=k.toBREP(face),header=[...text.matchAll(/^Fa\s*\n\s*([01])\s+([\deE+.-]+)\s+(\d+)\s+(\d+)\s*$/gm)][0]
          expect(header).toBeDefined()
          const record=surfaceTable(text)[Number(header[3])-1]
          expect(record.net).toMatchObject({nu:4,nv:5,du:3,dv:3})
          const wires=k.getSubShapes(face,'wire'),edges=k.getSubShapes(face,'edge')
          expect(wires).toHaveLength(1);expect(edges).toHaveLength(4)
          wires.forEach(h=>k.release(h));edges.forEach(h=>k.release(h))
        }
        const b=k.uvBounds(f.support.face),left=k.uvBounds(f.selected.face),normals:Point[]=[],defects:number[]=[]
        for(const t of [0,.125,.25,.5,.75,.875,1]){
          const y=10*t,p=k.pointOnSurface(f.support.face,b.uMin,b.vMin+(b.vMax-b.vMin)*t)
          expect(Math.hypot(p.x-10,p.y-y,p.z)).toBeLessThan(1e-8)
          const raw=k.surfaceNormal(f.support.face,b.uMin,b.vMin+(b.vMax-b.vMin)*t),n:[number,number,number]=[raw.x,raw.y,raw.z]
          const r=Math.min(t,1-t),q=.2*(6*r*r-8*r*r*r),expected=[-q,0,1].map(x=>x/Math.hypot(q,1))
          expect(Math.abs(n.reduce((sum,x,i)=>sum+x*expected[i],0))).toBeGreaterThan(1-1e-10)
          normals.push(n)
          const s=k.surfaceNormal(f.selected.face,left.uMax,left.vMin+(left.vMax-left.vMin)*t)
          defects.push(Math.hypot(s.y*n[2]-s.z*n[1],s.z*n[0]-s.x*n[2],s.x*n[1]-s.y*n[0]))
        }
        expect(Math.abs(normals[0].reduce((sum,x,i)=>sum+x*normals[3][i],0))).toBeLessThan(.999)
        expect(defects[0]).toBeLessThan(1e-9);expect(defects.at(-1)).toBeLessThan(1e-9)
        expect(defects[3]).toBeCloseTo(.1/Math.sqrt(1.01),9)
        const reopened=k.importStep(f.step),again=k.getSubShapes(reopened,'face')
        try{expect(k.isValid(reopened)).toBe(true);expect(again).toHaveLength(2);expect(again.every(h=>k.surfaceType(h)==='bspline')).toBe(true)}
        finally{again.forEach(h=>k.release(h));k.release(reopened)}
      }finally{faces.forEach(h=>k.release(h));solids.forEach(h=>k.release(h));shared.forEach(h=>k.release(h))}
    }finally{f.dispose()}
  },60000)

  it('refuses to misrepresent the varying support as a plane and preserves the selected CAD witness',async()=>{
    const f=await fixture(),{editor}=f
    try{
      const opened=editor.open(f.step)
      const selected=opened.faces.findIndex(face=>!face.reason)
      const net=editor.select(selected),current=editor.evaluate(net,'G0'),witness=editor.finalFaceWitness(current.previewRevision)
      const choices=await editor.g1SupportCandidates()
      expect(choices.candidates).toHaveLength(0)
      const fake={id:'forged-plane',stamp:choices.stamp,supportFaceIndex:1-selected,edgeIndex:0,side:'uMax' as const,lengthMm:10,plane:{origin:[10,5,0] as Point,normal:[0,0,1] as Point}}
      await expect(editor.proposeG1PlaneTangency({net,choice:fake})).rejects.toThrow()
      expect(editor.finalFaceWitness(current.previewRevision)).toEqual(witness)
      expect(editor.resolveAnchor(editor.anchorFromPick(net.poles[12],current.previewRevision).anchor,current.previewRevision).at.every(Number.isFinite)).toBe(true)
    }finally{f.dispose()}
  },60000)

  it('corrects the compatible curved support and validates independent OCCT seam normals while refusing incompatible inputs',async()=>{
    const {proposeCompatibleCurvedTangency,validateCompatibleCurvedTangencyResult}=await import('../compatibleCurvedTangency')
    const f=await fixture(),{k}=f,owned:ShapeHandle[]=[]
    const own=(h:ShapeHandle)=>{owned.push(h);return h}
    try{
      const request={net:f.selected.net,supportNet:f.support.net,edge:'U1' as const,supportEdge:'U0' as const,distanceTolerance:1e-8}
      const saved=structuredClone(request),result=proposeCompatibleCurvedTangency(request)
      expect(request).toEqual(saved)
      expect(result.changedIndices).toHaveLength(1)
      expect(result.changedIndices).toEqual([2*f.selected.net.nv+2])
      expect(result.net.poles[12][2]).toBeLessThan(-.6)
      expect(validateCompatibleCurvedTangencyResult(request,result.net)).toEqual(result.validation)
      for(let id=0;id<result.net.poles.length;id++)if(!result.changedIndices.includes(id))expect(result.net.poles[id]).toEqual(f.selected.net.poles[id])
      expect({...result.net,poles:[]}).toEqual({...f.selected.net,poles:[]})
      const text=k.toBREP(f.selected.face),header=[...text.matchAll(/^Fa\s*\n\s*([01])\s+([\deE+.-]+)\s+(\d+)\s+(\d+)\s*$/gm)][0]
      const record=surfaceTable(text)[Number(header[3])-1],raw=own(k.fromBREP(replaceSurface(text,record,result.net)))
      const corrected=own(rebuildFreeBoundary(k,raw,result.net)),shell=own(k.sew([corrected,f.support.face],1e-7))
      expect(k.isValid(corrected)).toBe(true);expect(k.isValid(shell)).toBe(true)
      const faces=k.getSubShapes(shell,'face');owned.push(...faces)
      expect(faces).toHaveLength(2)
      const shared=k.sharedEdges(faces[0],faces[1]);owned.push(...shared);expect(shared).toHaveLength(1)
      const a=k.uvBounds(corrected),b=k.uvBounds(f.support.face)
      let initialMax=0,correctedMax=0
      for(let i=0;i<=32;i++){
        const t=i/32,na=k.surfaceNormal(corrected,a.uMax,a.vMin+(a.vMax-a.vMin)*t)
        const nb=k.surfaceNormal(f.support.face,b.uMin,b.vMin+(b.vMax-b.vMin)*t)
        const before=k.surfaceNormal(f.selected.face,a.uMax,a.vMin+(a.vMax-a.vMin)*t)
        const sin=(x:typeof na,y:typeof nb)=>Math.hypot(x.y*y.z-x.z*y.y,x.z*y.x-x.x*y.z,x.x*y.y-x.y*y.x)
        correctedMax=Math.max(correctedMax,sin(na,nb));initialMax=Math.max(initialMax,sin(before,nb))
        const p=k.pointOnSurface(corrected,a.uMax,a.vMin+(a.vMax-a.vMin)*t),q=k.pointOnSurface(f.support.face,b.uMin,b.vMin+(b.vMax-b.vMin)*t)
        expect(Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z)).toBeLessThan(1e-8)
      }
      expect(initialMax).toBeGreaterThan(.09);expect(correctedMax).toBeLessThan(1e-9)
      const round=own(k.importStep(k.exportStep(shell)));expect(k.isValid(round)).toBe(true)
      const locked={...request,lockIndices:[12]}
      expect(()=>proposeCompatibleCurvedTangency(locked)).toThrow()
      const off=structuredClone(request);off.supportNet.poles[2][2]+=.01
      expect(()=>proposeCompatibleCurvedTangency(off)).toThrow()
      const incompatible=structuredClone(request);incompatible.supportNet.kv[1]+=.1
      expect(()=>proposeCompatibleCurvedTangency(incompatible)).toThrow()
      const wrong=structuredClone(result.net);wrong.poles[12][2]+=.01
      expect(()=>validateCompatibleCurvedTangencyResult(request,wrong)).toThrow()
      expect(request).toEqual(saved);expect(k.isValid(f.shell)).toBe(true)
    }finally{owned.reverse().forEach(h=>k.release(h));f.dispose()}
  },60000)

})

