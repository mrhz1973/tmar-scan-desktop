// SPDX-License-Identifier: AGPL-3.0-only
// Synthetic STEP solid with a varying-normal B-spline support; no GUI.
import {expect,it} from 'vitest'
import type {ShapeHandle} from 'occt-wasm'
import {SurfaceEditorKernel} from '../editorKernel'
import {replaceSurface,surfaceTable,type Net,type Point} from '../brep'
import {refineClampedNet} from '../refineClampedNet'

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
    const seedNet:Net={nu:4,nv:5,du:3,dv:3,poles,weights:poles.map(()=>1),rational:[0,0],ku:[b.uMin,b.uMax],kv:[b.vMin,(b.vMin+b.vMax)/2,b.vMax],mu:[4,4],mv:[4,1,4]}
    const net=refineClampedNet(seedNet,[{axis:'U',value:(b.uMin+b.uMax)/2,count:1}])
    const support=own(k.fromBREP(replaceSurface(text,record,net)))
    const border=(ids:number[],axis:'u'|'v')=>{
      const points=ids.map(i=>net.poles[i]),a=points[0],z=points.at(-1)!,d=z.map((x,i)=>x-a[i]),length=Math.hypot(...d)
      const straight=points.every(p=>Math.hypot(...p.map((x,i)=>x-a[i]-(d[i]/length)*p.reduce((sum,y,j)=>sum+(y-a[j])*d[j]/length,0)))<1e-9)
      return straight?own(k.makeLineEdge({x:a[0],y:a[1],z:a[2]},{x:z[0],y:z[1],z:z[2]})):
        own(k.makeBSplineEdge(points.flat(),ids.map(i=>net.weights[i]),axis==='u'?net.ku:net.kv,axis==='u'?net.mu:net.mv,3))
    }
    const wire=own(k.makeWire([border([0,5,10,15,20],'u'),border([20,21,22,23,24],'v'),border([24,19,14,9,4],'u'),border([4,3,2,1,0],'v')]))
    const face=own(k.fixShape(own(k.makeFaceOnSurface(support,wire))))
    return {face,net}
  }
  try{
    const selected=build(0,false),support=build(10,true),third=build(-10,false),shell=own(k.sew([selected.face,support.face,third.face],1e-7)),step=k.exportStep(shell)
    return {editor,k,selected,support,shell,step,dispose:()=>{owned.reverse().forEach(h=>k.release(h));editor.dispose()}}
  }catch(error){owned.reverse().forEach(h=>k.release(h));editor.dispose();throw error}
}
it('publishes compatible curved G1 on an imported synthetic solid',async()=>{
  const f=await fixture(),{editor,k}=f
  let solid:ShapeHandle|null=null,copy:ShapeHandle|null=null; const extra:ShapeHandle[]=[]
  try {
    solid=k.extrude(f.shell,0,0,-5); extra.push(solid)
    expect(k.isValid(solid)).toBe(true)
    const sub=k.getSubShapes(solid,'solid'); extra.push(...sub); expect(sub).toHaveLength(3); const a=k.fuse(sub[0],sub[1]); extra.push(a); const joined=k.fuse(a,sub[2]); extra.push(joined); expect(k.isValid(joined)).toBe(true); solid=joined
    const step=k.exportStep(solid); copy=k.importStep(step)
    expect(k.isValid(copy)).toBe(true)
    expect(k.isSolid(copy)).toBe(true)
    const originalBrep=k.toBREP(copy)
    const opened=editor.open(step)
    let selected=-1,choice:Awaited<ReturnType<typeof editor.g1CurvedSupportCandidates>>['candidates'][number]|undefined
    for(const face of opened.faces){
      if(face.reason)continue
      const net=editor.select(face.index)
      if(!net.poles.every(p=>p[0]>=-1e-8&&p[0]<=10+1e-8&&Math.abs(p[2])<1e-8))continue
      const result=await editor.g1CurvedSupportCandidates()
      if(result.candidates.length){selected=face.index;choice=result.candidates[0];break}
    }
    expect(selected).toBeGreaterThanOrEqual(0);expect(choice).toBeDefined()
    const base=editor.select(selected), candidates=await editor.g1CurvedSupportCandidates()
    const selectedChoice=candidates.candidates.find(c=>c.supportFaceIndex===choice!.supportFaceIndex)
    expect(selectedChoice).toBeDefined()
    const side=selectedChoice!.side
    const u=side==='uMin'?1:side==='uMax'?base.nu-2:Math.floor(base.nu/2)
    const v=side==='vMin'?1:side==='vMax'?base.nv-2:Math.floor(base.nv/2)
    const defect=structuredClone(base); defect.poles[u*defect.nv+v][2]+=.2
    const preview=editor.evaluate(defect,'G0'); expect(preview.valid).toBe(true)
    const proposed=await editor.proposeG1CurvedTangency({net:defect,choice:selectedChoice!})
    expect(proposed.changedIndices).toContain(u*defect.nv+v)
    expect(Math.abs(proposed.net.poles[u*defect.nv+v][2]-defect.poles[u*defect.nv+v][2])).toBeGreaterThan(1e-6)
    const result=await editor.publishG1CurvedTangency({baseNet:defect,net:proposed.net,choice:selectedChoice!,exportStep:true})
    expect(result.validation.globalG1Certified).toBe(false)
    const exported=k.importStep(result.step!);extra.push(exported)
    expect(k.isValid(exported)).toBe(true);expect(k.isSolid(exported)).toBe(true);expect(k.getVolume(exported)).toBeGreaterThan(0)
    expect(k.isValid(copy)).toBe(true);expect(k.isSolid(copy)).toBe(true);expect(k.toBREP(copy)).toBe(originalBrep)
  }finally{if(copy!==null)k.release(copy);extra.reverse().forEach(h=>k.release(h));f.dispose()}
},60000)
