// SPDX-License-Identifier: AGPL-3.0-only
// Exact polynomial fixture for future variable-normal support work; no GUI.
import {describe,expect,it} from 'vitest'
import {sha256} from '../recipe'
import type {G1SourceStamp} from '../g1SupportTopology'
import type {ShapeHandle} from 'occt-wasm'
import {SurfaceEditorKernel} from '../editorKernel'
import {replaceSurface,surfaceTable,type Net,type Point} from '../brep'

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

async function sourceStamp(brep:string,faceIndex=0):Promise<G1SourceStamp>{
  return {sourceId:'brep-sha256:'+await sha256(brep),sourceRevision:1,selectionRevision:2,faceIndex}
}
const rectangleWire=(k:Awaited<ReturnType<typeof SurfaceEditorKernel.load>>['kernel'],points:Point[],owned:ShapeHandle[])=>{
  const edges=points.map((a,i)=>{const b=points[(i+1)%points.length];return k.makeLineEdge({x:a[0],y:a[1],z:a[2]},{x:b[0],y:b[1],z:b[2]})})
  owned.push(...edges);const wire=k.makeWire(edges);owned.push(wire);return wire
}

describe('frozen BREP identification of compatible curved G1 supports',()=>{
  it('identifies the actual shared straight edge and opposite curved support, resolves plain data and fences stale choices without mutating source',async()=>{
    const {listCompatibleCurvedSupportCandidates:list,resolveCompatibleCurvedSupportCandidate:resolve}=await import('../compatibleCurvedSupportTopology')
    const f=await fixture(),{k}=f
    try{
      const brep=k.toBREP(f.shell),stamp=await sourceStamp(brep),savedStamp=structuredClone(stamp)
      const candidates=await list(k,brep,stamp)
      expect(candidates).toHaveLength(1)
      const choice=candidates[0]
      expect(choice).toMatchObject({kind:'compatible-bspline',stamp,supportFaceIndex:1,side:'uMax',supportSide:'uMin',reverseSupport:false})
      expect(choice.lengthMm).toBeCloseTo(10,8)
      const savedChoice=structuredClone(choice),resolved=await resolve(k,brep,stamp,choice)
      expect(resolved.candidate).toEqual(choice)
      expect(resolved.selectedNet).toEqual(f.selected.net)
      expect(resolved.supportNet).toEqual(f.support.net)
      expect(resolved.selectedWitness).toBeDefined();expect(resolved.supportWitness).toBeDefined()
      // The resolved snapshot contains no OCCT handles or host revision aliases.
      expect(structuredClone(resolved)).toEqual(resolved)
      expect(JSON.stringify(resolved)).toBeTruthy()
      resolved.supportNet.poles[0][2]+=99
      const again=await resolve(k,brep,stamp,choice)
      expect(again.supportNet).toEqual(f.support.net)
      for(const current of [{...stamp,sourceRevision:2},{...stamp,selectionRevision:3},{...stamp,faceIndex:1}])
        await expect(resolve(k,brep,current,choice)).rejects.toThrow()
      await expect(resolve(k,brep,stamp,{...choice,supportFaceIndex:0})).rejects.toThrow()
      await expect(resolve(k,brep,stamp,{...choice,side:'uMin'})).rejects.toThrow()
      await expect(list(k,brep,{...stamp,sourceId:'brep-sha256:'+'0'.repeat(64)})).rejects.toThrow()
      expect(stamp).toEqual(savedStamp);expect(choice).toEqual(savedChoice)
      expect(k.toBREP(f.shell)).toBe(brep);expect(k.isValid(f.shell)).toBe(true)
    }finally{f.dispose()}
  },60000)

  it('does not infer adjacency from coincident but unsewn boundaries',async()=>{
    const {listCompatibleCurvedSupportCandidates:list}=await import('../compatibleCurvedSupportTopology')
    const f=await fixture(),{k}=f
    const compound=k.makeCompound([f.selected.face,f.support.face])
    try{
      const brep=k.toBREP(compound),stamp=await sourceStamp(brep)
      const candidates=await list(k,brep,stamp)
      expect(candidates).toHaveLength(0);expect(k.toBREP(compound)).toBe(brep)
    }finally{k.release(compound);f.dispose()}
  },60000)

  it('refuses selected outer trims and real holes despite an unchanged shared seam',async()=>{
    const {listCompatibleCurvedSupportCandidates:list}=await import('../compatibleCurvedSupportTopology')
    const f=await fixture(),{k}=f,owned:ShapeHandle[]=[]
    try{
      const wire=rectangleWire(k,[[2,0,0],[10,0,0],[10,10,0],[2,10,0]],owned)
      const raw=k.makeFaceOnSurface(f.selected.face,wire);owned.push(raw)
      const trimmed=k.fixShape(raw);owned.push(trimmed)
      // Cut an exact rectangular through-hole; addHolesInFace does not
      // support this trimmed B-spline fixture in the installed OCCT wrapper.
      const box=k.makeBox(4,4,2);owned.push(box)
      const tool=k.translate(box,3,3,-1);owned.push(tool)
      const holeRaw=k.cut(f.selected.face,tool);owned.push(holeRaw)
      const holeFaces=k.getSubShapes(holeRaw,'face');owned.push(...holeFaces)
      expect(holeFaces).toHaveLength(1)
      const holed=holeFaces[0]
      expect(k.getSurfaceArea(trimmed)).toBeCloseTo(80,6)
      expect(k.getSurfaceArea(holed)).toBeCloseTo(84,6)
      const holeWires=k.getSubShapes(holed,'wire');owned.push(...holeWires)
      expect(holeWires).toHaveLength(2)
      for(const face of [trimmed,holed]){
        expect(k.isValid(face)).toBe(true)
        const shell=k.sew([face,f.support.face],1e-7);owned.push(shell)
        expect(k.isValid(shell)).toBe(true)
        const brep=k.toBREP(shell),stamp=await sourceStamp(brep)
        const unavailable=await list(k,brep,stamp).then(candidates=>candidates.length===0,()=>true)
        expect(unavailable).toBe(true);expect(k.toBREP(shell)).toBe(brep)
      }
    }finally{owned.reverse().forEach(h=>k.release(h));f.dispose()}
  },60000)

  it('refuses injected duplicate face occurrences and releases imported snapshot handles after rejection',async()=>{
    const {listCompatibleCurvedSupportCandidates:list}=await import('../compatibleCurvedSupportTopology')
    const f=await fixture(),{k}=f,acquired:ShapeHandle[]=[],released:ShapeHandle[]=[]
    const wrapped=new Proxy(k,{get(target,key){
      if(key==='importStep')throw Error('Topology must use the supplied BREP snapshot')
      if(key==='fromBREP')return(text:string)=>{const h=k.fromBREP(text);acquired.push(h);return h}
      if(key==='getSubShapes')return(shape:ShapeHandle,type:Parameters<typeof k.getSubShapes>[1])=>{
        const values=k.getSubShapes(shape,type);acquired.push(...values)
        if(type==='face'){
          const extra=k.getSubShapes(shape,type);acquired.push(...extra)
          // Each extra handle is an independently acquired reference. Append
          // an exact duplicate occurrence; there is no proximity oracle.
          if(extra.length){const duplicate=extra.pop()!;extra.forEach(h=>{released.push(h);k.release(h)});return [...values,duplicate]}
        }
        return values
      }
      if(key==='release')return(h:ShapeHandle)=>{released.push(h);k.release(h)}
      const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value
    }})
    try{
      const brep=k.toBREP(f.shell),stamp=await sourceStamp(brep)
      await expect(list(wrapped,brep,stamp)).rejects.toThrow()
      expect([...released].sort((a,b)=>Number(a)-Number(b))).toEqual([...acquired].sort((a,b)=>Number(a)-Number(b)))
      expect(k.toBREP(f.shell)).toBe(brep)
    }finally{f.dispose()}
  },60000)
})
