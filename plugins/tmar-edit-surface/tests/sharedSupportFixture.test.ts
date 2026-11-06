// SPDX-License-Identifier: AGPL-3.0-only
// Isolated CAD fixture; no workspace, scan, or host project is changed.
import { expect, it } from 'vitest'
import type { ShapeHandle } from 'occt-wasm'
import { SurfaceEditorKernel } from '../editorKernel'

it('characterizes a STEP solid whose top is split into coplanar faces', async () => {
  const editor=await SurfaceEditorKernel.load(), k=editor.kernel, owned:ShapeHandle[]=[]
  const own=(shape:ShapeHandle)=>{owned.push(shape);return shape}
  try {
    const box=own(k.makeBox(20,20,10)), faces=k.getSubShapes(box,'face');owned.push(...faces)
    const top=faces.find(face=>{
      const b=k.uvBounds(face),p=k.pointOnSurface(face,(b.uMin+b.uMax)/2,(b.vMin+b.vMax)/2)
      return Math.abs(p.z-10)<1e-8
    })!
    expect(top).toBeDefined()
    const line=own(k.makeLineEdge({x:10,y:0,z:10},{x:10,y:20,z:10}))
    const divided=own(k.split(top,[line])), parts=k.getSubShapes(divided,'face');owned.push(...parts)
    expect(parts).toHaveLength(2)
    const solid=own(k.sewAndSolidify([...faces.filter(face=>face!==top),...parts],1e-7))
    expect(k.isValid(solid)).toBe(true)
    const imported=own(k.importStep(k.exportStep(solid))), importedFaces=k.getSubShapes(imported,'face');owned.push(...importedFaces)
    expect(k.isValid(imported)).toBe(true)
    expect(importedFaces).toHaveLength(7)
    const step=k.exportStep(imported), before=k.toBREP(imported)
    const result=editor.open(step)
    const topIndices=importedFaces.flatMap((face,index)=>{
      const b=k.uvBounds(face),p=k.pointOnSurface(face,(b.uMin+b.uMax)/2,(b.vMin+b.vMax)/2)
      return Math.abs(p.z-10)<1e-8?[index]:[]
    })
    expect(topIndices).toHaveLength(2)
    expect(topIndices.some(index=>/ambigua|condivisa/i.test(result.faces[index].reason??''))).toBe(true)
    const target=topIndices.find(index=>/ambigua|condivisa/i.test(result.faces[index].reason??''))!
    expect(()=>editor.select(target)).toThrow(/ambigua|condivisa/i)
    expect(k.toBREP(imported)).toBe(before)
    // Research only: edit an isolated STEP face, then attempt to sew a copy.
    // The production path still refuses this case until all topology checks exist.
    const isolated=new SurfaceEditorKernel(k)
    try {
      const one=isolated.open(k.exportStep(importedFaces[target]))
      expect(one.faces).toHaveLength(1)
      const net=isolated.select(0), changed=structuredClone(net)
      const pole=Math.floor(net.nu/2)*net.nv+Math.floor(net.nv/2)
      changed.poles[pole][2]+=.02
      const output=isolated.evaluate(changed,'G1',true)
      const edited=own(k.importStep(output.step!)), editedFaces=k.getSubShapes(edited,'face');owned.push(...editedFaces)
      expect(editedFaces).toHaveLength(1)
      const bounds=k.uvBounds(importedFaces[target]), center=k.pointOnSurface(importedFaces[target],(bounds.uMin+bounds.uMax)/2,(bounds.vMin+bounds.vMax)/2)
      const centerVertex=own(k.makeVertex(center.x,center.y,center.z))
      expect(k.distanceBetween(centerVertex,editedFaces[0])).toBeGreaterThan(1e-4)
      const combined=own(k.sewAndSolidify([...importedFaces.filter((_,index)=>index!==target),editedFaces[0]],1e-7))
      expect(k.isValid(combined)).toBe(true)
      const round=own(k.importStep(k.exportStep(combined))), roundFaces=k.getSubShapes(round,'face');owned.push(...roundFaces)
      expect(k.isValid(round)).toBe(true)
      expect(roundFaces).toHaveLength(7)
      const solids=k.getSubShapes(round,'solid');owned.push(...solids)
      expect(solids).toHaveLength(1)
      for(const face of importedFaces.filter((_,index)=>index!==target)) {
        const b=k.uvBounds(face), p=k.pointOnSurface(face,(b.uMin+b.uMax)/2,(b.vMin+b.vMax)/2)
        const witness=own(k.makeVertex(p.x,p.y,p.z))
        expect(Math.min(...roundFaces.map(candidate=>k.distanceBetween(witness,candidate)))).toBeLessThan(1e-6)
      }
      expect(k.toBREP(imported)).toBe(before)
    } finally {isolated.dispose()}
  } finally {owned.reverse().forEach(shape=>k.release(shape));editor.dispose()}
},60000)
