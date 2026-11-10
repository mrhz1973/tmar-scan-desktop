// SPDX-License-Identifier: AGPL-3.0-only
import {expect,it} from 'vitest'
import type {ShapeHandle} from 'occt-wasm'
import {SurfaceEditorKernel} from '../editorKernel'

it('publishes local plane G1 on a synthetic seven-face STEP solid with a split planar top',async()=>{
  const editor=await SurfaceEditorKernel.load(),k=editor.kernel,owned:ShapeHandle[]=[]
  const face=(points:number[][])=>{
    const p=points.map(([x,y,z])=>({x,y,z})),edges=p.map((a,i)=>k.makeLineEdge(a,p[(i+1)%p.length]));owned.push(...edges)
    const wire=k.makeWire(edges);owned.push(wire)
    const result=k.makeFace(wire);owned.push(result);return result
  }
  try{
    const faces=[
      face([[0,0,0],[10,0,0],[10,10,0],[0,10,0]]),
      face([[10,0,0],[20,0,0],[20,10,0],[10,10,0]]),
      face([[0,0,-5],[0,10,-5],[20,10,-5],[20,0,-5]]),
      face([[0,0,-5],[20,0,-5],[20,0,0],[0,0,0]]),
      face([[20,0,-5],[20,10,-5],[20,10,0],[20,0,0]]),
      face([[20,10,-5],[0,10,-5],[0,10,0],[20,10,0]]),
      face([[0,10,-5],[0,0,-5],[0,0,0],[0,10,0]]),
    ]
    const solid=k.sewAndSolidify(faces,1e-7);owned.push(solid)
    expect(k.isValid(solid)).toBe(true);expect(k.isSolid(solid)).toBe(true);expect(k.getVolume(solid)).toBeCloseTo(1000,7)
    const step=k.exportStep(solid),opened=editor.open(step)
    expect(opened.faces).toHaveLength(7)
    let selected:number|undefined,base:ReturnType<typeof editor.select>|undefined,choice
    for(const f of opened.faces){
      if(f.reason)continue
      const candidateNet=editor.select(f.index)
      if(!candidateNet.poles.every(p=>Math.abs(p[2])<1e-8))continue
      const supports=await editor.g1SupportCandidates()
      const support=supports.candidates.find(c=>Math.abs(c.plane.normal[2])>1-1e-8&&Math.abs(c.plane.origin[2])<1e-8)
      if(support&&candidateNet.poles.every(p=>Math.abs(p[2])<1e-8)){selected=f.index;base=candidateNet;choice=support;break}
    }
    expect(selected).not.toBeUndefined();expect(base).toBeDefined();expect(choice).toBeDefined()
    const changed=structuredClone(base!)
    const u=choice!.side==='uMin'?1:choice!.side==='uMax'?changed.nu-2:Math.floor(changed.nu/2)
    const v=choice!.side==='vMin'?1:choice!.side==='vMax'?changed.nv-2:Math.floor(changed.nv/2)
    const inner=u*changed.nv+v;changed.poles[inner][2]+=.2
    const before=editor.evaluate(changed,'G0');expect(before.valid).toBe(true)
    const proposal=await editor.proposeG1PlaneTangency({net:changed,choice:choice!})
    const applied=await editor.publishG1PlaneTangency({baseNet:changed,net:proposal.net,choice:choice!,exportStep:true})
    expect(applied.net.poles[inner][2]).toBeCloseTo(0,8);expect(applied.validation.globalG1Certified).toBe(false)
    const copy=k.importStep(applied.step!);owned.push(copy)
    expect(k.isValid(copy)).toBe(true);expect(k.isSolid(copy)).toBe(true);expect(k.getVolume(copy)).toBeCloseTo(1000,6)
    // Original handle is still intact after the editor's separate STEP round trip.
    expect(k.isValid(solid)).toBe(true);expect(k.getVolume(solid)).toBeCloseTo(1000,7)
  }finally{owned.forEach(h=>k.release(h));editor.dispose()}
},60000)

