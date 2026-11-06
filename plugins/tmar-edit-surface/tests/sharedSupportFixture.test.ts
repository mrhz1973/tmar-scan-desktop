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
  } finally {owned.reverse().forEach(shape=>k.release(shape));editor.dispose()}
},60000)
