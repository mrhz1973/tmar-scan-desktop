// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { ShapeHandle } from 'occt-wasm'
import { SurfaceEditorKernel } from '../editorKernel'
import { encodeNet, replaceSurface, signature, surfaceTable } from '../brep'
import {rebuildFreeBoundary} from '../freeBoundary'

it('preserves the reversed GUI fixture orientation when enabling unchanged free boundaries',async()=>{
  const editor=await SurfaceEditorKernel.load(),k=editor.kernel,box=k.makeBox(20,30,10),faces=k.getSubShapes(box,'face')
  let source:ShapeHandle|undefined,sourceFaces:ShapeHandle[]=[],rebuilt:ShapeHandle|undefined
  try{
    const chosen=faces.find(f=>Math.abs(k.getSurfaceArea(f)-600)<1e-7)!
    const step=k.exportStep(chosen);source=k.importStep(step);sourceFaces=k.getSubShapes(source,'face')
    const opened=editor.open(step),net=editor.select(0)
    expect(opened.faces[0].freeBoundary).toBe(true)
    expect(editor.evaluate(net,'G1').valid).toBe(true)
    const bounds=k.uvBounds(sourceFaces[0]),u=(bounds.uMin+bounds.uMax)/2,v=(bounds.vMin+bounds.vMax)/2
    const support=k.fromBREP(replaceSurface(k.toBREP(sourceFaces[0]),surfaceTable(k.toBREP(sourceFaces[0]))[0],net))
    try{rebuilt=rebuildFreeBoundary(k,support,net)}finally{k.release(support)}
    const originalNormal=k.surfaceNormal(sourceFaces[0],u,v),rebuiltNormal=k.surfaceNormal(rebuilt,u,v)
    console.log(JSON.stringify({case:'gui-first-area600',sourceOrientation:k.shapeOrientation(sourceFaces[0]),rebuiltOrientation:k.shapeOrientation(rebuilt),originalNormal,rebuiltNormal}))
    const result=editor.evaluate(net,'G1',true,true)
    expect(result.valid).toBe(true);expect(result.minimumNormalDot).toBeCloseTo(1,10)
    const output=k.importStep(result.step!),outFaces=k.getSubShapes(output,'face')
    try{expect(k.isValid(output)).toBe(true);expect(outFaces).toHaveLength(1);expect(k.shapeOrientation(outFaces[0])).toBe(k.shapeOrientation(sourceFaces[0]))}
    finally{outFaces.forEach(f=>k.release(f));k.release(output)}
  }finally{if(rebuilt)k.release(rebuilt);sourceFaces.forEach(f=>k.release(f));if(source)k.release(source);faces.forEach(f=>k.release(f));k.release(box);editor.dispose()}
},60000)

it('reconstructs a free NURBS boundary without refitting its support surface',async()=>{
  const editor=await SurfaceEditorKernel.load(), k=editor.kernel
  const box=k.makeBox(20,30,10), boxFaces=k.getSubShapes(box,'face')
  const step=k.exportStep(boxFaces[5])
  boxFaces.forEach(f=>k.release(f));k.release(box)
  const source=k.importStep(step), sourceFaces=k.getSubShapes(source,'face')
  const made:ShapeHandle[]=[]
  const keep=(shape:ShapeHandle)=>{made.push(shape);return shape}
  try{
    editor.open(step)
    const net=editor.select(0), changed=structuredClone(net)
    // Move one corner, testing both incident curved boundary edges.
    changed.poles[0]=changed.poles[0].map((n,d)=>n+(d===2?2:0)) as [number,number,number]
    const brep=k.toBREP(sourceFaces[0]), records=surfaceTable(brep)
    expect(records).toHaveLength(1)
    const support=keep(k.fromBREP(replaceSurface(brep,records[0],changed)))
    const v0=Array.from({length:net.nv},(_,j)=>j)
    const u1=Array.from({length:net.nu},(_,i)=>i*net.nv+net.nv-1)
    const v1=Array.from({length:net.nv},(_,j)=>(net.nu-1)*net.nv+j)
    const u0=Array.from({length:net.nu},(_,i)=>i*net.nv)
    const edge=(indices:number[],along:'u'|'v')=>keep(k.makeBSplineEdge(indices.flatMap(i=>changed.poles[i]),indices.map(i=>changed.weights[i]),along==='u'?changed.ku:changed.kv,along==='u'?changed.mu:changed.mv,along==='u'?changed.du:changed.dv))
    const wire=keep(k.makeWire([edge(v0,'v'),edge(u1,'u'),edge(v1,'v'),edge(u0,'u')]))
    const raw=keep(k.makeFaceOnSurface(support,wire))
    const face=keep(k.fixShape(raw))
    expect(k.isValid(face)).toBe(true)
    const expected=encodeNet(changed).trim().split(/\s+/).map(Number).join(' ')
    expect(surfaceTable(k.toBREP(face)).filter(r=>signature(r)===expected)).toHaveLength(1)
    const surface=k.getSubShapes(face,'face')
    try {
      expect(surface).toHaveLength(1)
      const originalBounds=k.uvBounds(sourceFaces[0]), actualBounds=k.uvBounds(surface[0])
      for(let i=0;i<=12;i++)for(let j=0;j<=12;j++){
        const u=originalBounds.uMin+(originalBounds.uMax-originalBounds.uMin)*i/12
        const v=originalBounds.vMin+(originalBounds.vMax-originalBounds.vMin)*j/12
        const a=k.pointOnSurface(support,u,v),b=k.pointOnSurface(surface[0],u,v)
        expect(Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)).toBeLessThan(1e-7)
        expect(['in','on']).toContain(k.classifyPointOnFace(surface[0],u,v))
      }
      expect(actualBounds.uMin).toBeCloseTo(originalBounds.uMin,6)
      expect(actualBounds.vMin).toBeCloseTo(originalBounds.vMin,6)
      const imported=k.importStep(k.exportStep(face)), importedFaces=k.getSubShapes(imported,'face')
      try{expect(k.isValid(imported)).toBe(true);expect(importedFaces).toHaveLength(1)}
      finally{importedFaces.forEach(f=>k.release(f));k.release(imported)}
    }finally{surface.forEach(f=>k.release(f))}
  }finally{made.reverse().forEach(h=>k.release(h));sourceFaces.forEach(f=>k.release(f));k.release(source);editor.dispose()}
},60000)

it('moves an open-sheet corner through the editor and rejects free edges on solids',async()=>{
  const editor=await SurfaceEditorKernel.load(), k=editor.kernel
  const box=k.makeBox(20,30,10), boxFaces=k.getSubShapes(box,'face')
  try{
    const opened=editor.open(k.exportStep(boxFaces[5]))
    expect(opened.faces[0].freeBoundary).toBe(true)
    const original=editor.select(0), changed=structuredClone(original)
    changed.poles[0][2]+=2
    expect(()=>editor.evaluate(changed,'G0')).toThrow(/protetto/)
    const result=editor.evaluate(changed,'G0',true,true)
    expect(result.valid).toBe(true)
    expect(result.maxBoundaryError).toBeCloseTo(2,7)
    const restored=k.importStep(result.step!), faces=k.getSubShapes(restored,'face')
    try{
      expect(k.isValid(restored)).toBe(true);expect(faces).toHaveLength(1)
      const b=k.uvBounds(faces[0]), point=k.pointOnSurface(faces[0],b.uMin,b.vMin)
      expect(point.z).toBeCloseTo(original.poles[0][2]+2,7)
    }finally{faces.forEach(f=>k.release(f));k.release(restored)}
    const solid=editor.open(k.exportStep(box))
    expect(solid.faces.every(face=>!face.freeBoundary)).toBe(true)
    expect(()=>editor.evaluate(editor.select(0),'G0',false,true)).toThrow(/sola faccia aperta/)
  }finally{boxFaces.forEach(f=>k.release(f));k.release(box);editor.dispose()}
},60000)

it('rejects free-edge mode for a single open STEP face with a hole',async()=>{
  const editor=await SurfaceEditorKernel.load(), k=editor.kernel
  const block=k.makeBox(48,48,10), tool=k.makeCylinder(3,14)
  const positioned=k.translate(tool,12,12,-2), drilled=k.cut(block,positioned)
  const faces=k.getSubShapes(drilled,'face')
  try{
    const top=faces.find(face=>{
      const bounds=k.uvBounds(face), wires=k.getSubShapes(face,'wire')
      try {return wires.length===2 && Math.abs(k.pointOnSurface(face,(bounds.uMin+bounds.uMax)/2,(bounds.vMin+bounds.vMax)/2).z-10)<1e-7}
      finally {wires.forEach(w=>k.release(w))}
    })
    expect(top).toBeDefined()
    const opened=editor.open(k.exportStep(top!))
    expect(opened.faces).toHaveLength(1)
    expect(opened.faces[0].openSheet).toBe(true)
    expect(opened.faces[0].freeBoundary).toBe(false)
    expect(()=>editor.evaluate(editor.select(0),'G0',false,true)).toThrow(/sola faccia aperta/)
  }finally{faces.forEach(f=>k.release(f));[drilled,positioned,tool,block].forEach(h=>k.release(h));editor.dispose()}
},60000)
