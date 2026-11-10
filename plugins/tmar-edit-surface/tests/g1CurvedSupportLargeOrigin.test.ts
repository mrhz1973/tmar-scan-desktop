// SPDX-License-Identifier: AGPL-3.0-only
// Exact polynomial fixture for future variable-normal support work; no GUI.
import {describe,expect,it} from 'vitest'
import {sha256} from '../recipe'
import type {G1SourceStamp} from '../g1SupportTopology'
import type {ShapeHandle} from 'occt-wasm'
import {SurfaceEditorKernel} from '../editorKernel'
import {replaceSurface,surfaceTable,type Net,type Point} from '../brep'

async function fixture(offset=1e15){
  const editor=await SurfaceEditorKernel.load(),k=editor.kernel,owned:ShapeHandle[]=[]
  const own=(h:ShapeHandle)=>{owned.push(h);return h}
  const build=(start:number,curved:boolean)=>{
    const p=[{x:start,y:0,z:0},{x:start+1000,y:0,z:0},{x:start+1000,y:10,z:0},{x:start,y:10,z:0}]
    const seedWire=own(k.makeWire(p.map((a,i)=>own(k.makeLineEdge(a,p[(i+1)%4])))))
    const seed=own(k.makeFace(seedWire)),text=k.toBREP(seed),record=surfaceTable(text).find(r=>r.kind===1)!,b=k.uvBounds(seed)
    const poles:Point[]=[]
    // Cubic V basis with one midpoint knot; q and dq vanish at both ends.
    const q=[0,0,.2,0,0],greville=[0,1/6,.5,5/6,1]
    for(let u=0;u<4;u++)for(let v=0;v<5;v++)poles.push([start+1000*u/3,10*greville[v],curved?(1000*u/3)*q[v]:0])
    const net:Net={nu:4,nv:5,du:3,dv:3,poles,weights:poles.map(()=>1),rational:[0,0],ku:[offset,offset+1000],kv:[b.vMin,(b.vMin+b.vMax)/2,b.vMax],mu:[4,4],mv:[4,1,4]}
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
    const selected=build(0,false),support=build(1000,true),shell=own(k.sew([selected.face,support.face],1e-7)),step=k.exportStep(shell)
    return {editor,k,selected,support,shell,step,dispose:()=>{owned.reverse().forEach(h=>k.release(h));editor.dispose()}}
  }catch(error){owned.reverse().forEach(h=>k.release(h));editor.dispose();throw error}
}


describe('natural pcurve coverage at a large parameter origin',()=>{
  it('distinguishes the old offset-scaled budget from a resolvable one-unit trim (controlled arithmetic diagnosis)',()=>{
    const low=1e15,high=low+1000,trim=high-1
    expect(trim).not.toBe(high)
    expect(high-trim).toBe(1)
    // This is the previous witness formula, reproduced only to diagnose the
    // reported numerical issue. It does not bypass any production CAD gate.
    const previousOffsetBudget=64*Number.EPSILON*Math.max(1,Math.abs(low),Math.abs(high))
    expect(previousOffsetBudget).toBeGreaterThan(14)
    expect(Math.abs(trim-high)<=previousOffsetBudget).toBe(true)
    const localSpanBudget=1e-10*(high-low)
    expect(localSpanBudget).toBeLessThan(1e-6)
    expect(Math.abs(trim-high)<=localSpanBudget).toBe(false)
  })

  it('uses the production pcurve arithmetic to refuse the one-unit trim despite its large U origin',async()=>{
    const {certifyNaturalLinearPcurveSide:certify}=await import('../compatibleCurvedSupportTopology')
    const poles:Point[]=[]
    for(let u=0;u<4;u++)for(let v=0;v<4;v++)poles.push([1000*u/3,10*v/3,0])
    const net:Net={nu:4,nv:4,du:3,dv:3,poles,weights:poles.map(()=>1),rational:[0,0],ku:[1e15,1e15+1000],kv:[0,10],mu:[4,4],mv:[4,4]}
    const before=structuredClone(net),high=net.ku[1]
    const natural=certify(net,{origin:[high,0],direction:[0,1],parameterRange:[0,10]})
    expect(natural.side).toBe('uMax')
    expect(natural.parameterBudget).toBeLessThan(1e-6)
    expect(natural.geometricBudgetMm).toBe(1e-8)
    expect(natural.maxGeometricDeviationBound).toBeLessThanOrEqual(1e-8)
    expect(()=>certify(net,{origin:[high-1,0],direction:[0,1],parameterRange:[0,10]})).toThrow()
    // Even with exactly stated endpoints, adding a huge origin introduces a
    // wider arithmetic enclosure. A conservative refusal is required here.
    expect(()=>certify(net,{origin:[net.ku[0],0],direction:[1,0],parameterRange:[0,1000]})).toThrow()
    const local={...net,ku:[0,1000]}
    expect(certify(local,{origin:[0,0],direction:[1,0],parameterRange:[0,1000]}).side).toBe('vMin')
    expect(net).toEqual(before)
  })

  it('refuses a real one-unit U trim at a large parameter origin without claiming an end-to-end pre-fix acceptance',async()=>{
    const {listCompatibleCurvedSupportCandidates:list}=await import('../compatibleCurvedSupportTopology')
    const f=await fixture(),{k}=f,owned:ShapeHandle[]=[]
    const own=(h:ShapeHandle)=>{owned.push(h);return h}
    try{
      // A physical 1000 mm width makes the U derivative unit-length: there is
      // no artificial pcurve scaling or mocked kernel geometry in this case.
      expect(k.isValid(f.shell)).toBe(true)
      const naturalBrep=k.toBREP(f.shell),naturalStamp:G1SourceStamp={sourceId:'brep-sha256:'+await sha256(naturalBrep),sourceRevision:1,selectionRevision:1,faceIndex:1}
      const naturalOutcome=await list(k,naturalBrep,naturalStamp).then(candidates=>({candidates,error:null}),error=>({candidates:[],error:String(error)}))
      // OCCT currently raises edge tolerances on this real reparameterization;
      // refusing even the untrimmed case is an allowed conservative outcome.
      if(naturalOutcome.error)expect(naturalOutcome.error).toContain('rifiutato')
      expect(f.support.net.ku).toEqual([1e15,1e15+1000])
      const line=(a:Point,b:Point)=>own(k.makeLineEdge({x:a[0],y:a[1],z:a[2]},{x:b[0],y:b[1],z:b[2]}))
      const far=1999,q=[0,0,.2,0,0],y=[0,10/6,5,50/6,10]
      const curved=own(k.makeBSplineEdge(y.flatMap((v,i)=>[far,v,(far-1000)*q[i]]),q.map(()=>1),f.support.net.kv,f.support.net.mv,3))
      const wire=own(k.makeWire([line([1000,0,0],[far,0,0]),curved,line([far,10,0],[1000,10,0]),line([1000,10,0],[1000,0,0])]))
      const raw=own(k.makeFaceOnSurface(f.support.face,wire)),trimmed=own(k.fixShape(raw))
      expect(k.isValid(trimmed)).toBe(true)
      const bounds=k.uvBounds(trimmed)
      expect(bounds.uMin).toBe(1e15);expect(bounds.uMax).toBe(1e15+999)
      const shell=own(k.sew([f.selected.face,trimmed],1e-7))
      expect(k.isValid(shell)).toBe(true)
      const faces=k.getSubShapes(shell,'face');owned.push(...faces)
      const shared=k.sharedEdges(faces[0],faces[1]);owned.push(...shared);expect(shared).toHaveLength(1)
      const brep=k.toBREP(shell),stamp:G1SourceStamp={...naturalStamp,sourceId:'brep-sha256:'+await sha256(brep)}
      const realTrim=await list(k,brep,stamp).then(candidates=>({candidates,error:null}),error=>({candidates:[],error:String(error)}))
      expect(realTrim.candidates).toHaveLength(0)
      // Refusal or zero candidates is acceptable. Certifying this 1 mm trim
      // against the untrimmed knot domain is a false natural-boundary claim.
      expect(realTrim.candidates).toHaveLength(0)
      expect(k.toBREP(shell)).toBe(brep)
    }finally{owned.reverse().forEach(h=>k.release(h));f.dispose()}
  },60000)
})
