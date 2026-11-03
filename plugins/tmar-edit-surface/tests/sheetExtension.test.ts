// SPDX-License-Identifier: AGPL-3.0-only
import {it, expect} from 'vitest'
import {SurfaceEditorKernel} from '../editorKernel'

it('duplicates a free STEP edge as a sewn strip and rejects an overlapping result',async()=>{
  const editor=await SurfaceEditorKernel.load(), k=editor.kernel
  const box=k.makeBox(20,30,10), fs=k.getSubShapes(box,'face')
  try {
    const step=k.exportStep(fs[5]), opened=editor.open(step)
    expect(opened.faces[0].openSheet).toBe(true)
    const net=editor.select(0), p=editor.evaluate(net,'G0'), rev=p.previewRevision
    const paths=editor.sheetEdges(rev), index=paths.findIndex(path=>path.every(q=>Math.abs(q[0]-20)<1e-7))
    expect(index).toBeGreaterThan(-1)
    expect(()=>editor.duplicateSheetEdge(rev,index,[-5,0,0])).toThrow(/sovrappone/)
    expect(()=>editor.duplicateSheetEdge(rev,index,[0,0,0])).toThrow()
    const result=editor.duplicateSheetEdge(rev,index,[5,0,0])
    expect(result.addedArea).toBeCloseTo(150,8)
    const outer=result.paths.findIndex(path=>path.every(p=>Math.abs(p[0]-25)<1e-7))
    expect(outer).toBeGreaterThan(-1)
    expect(result.paths.some(path=>path.every(p=>Math.abs(p[0]-20)<1e-7))).toBe(false)
    expect(()=>editor.duplicateSheetEdge(rev,index,[3,0,0],result.moves,paths[index])).toThrow(/identificabile/)
    const second=editor.duplicateSheetEdge(rev,outer,[0,0,4],result.moves,result.paths[outer])
    expect(second.totalArea).toBeCloseTo(870,8)
    expect(second.preview.faceMeshes).toHaveLength(3)
    const imported=k.importStep(second.step), strips=k.getSubShapes(imported,'face')
    try {
      expect(k.isValid(imported)).toBe(true)
      expect(strips.map(f=>k.getSurfaceArea(f)).sort((a,b)=>a-b)).toEqual([expect.closeTo(120,7),expect.closeTo(150,7),expect.closeTo(600,7)])
    } finally {strips.forEach(f=>k.release(f));k.release(imported)}
    const reloaded=k.importStep(result.step), faces=k.getSubShapes(reloaded,'face')
    try {
      expect(k.isValid(reloaded)).toBe(true)
      expect(faces.map(f=>k.getSurfaceArea(f)).sort((a,b)=>a-b)).toEqual([expect.closeTo(150,7),expect.closeTo(600,7)])
      const left=k.getSubShapes(faces[0],'edge'), right=k.getSubShapes(faces[1],'edge')
      try {expect(left.filter(a=>right.some(b=>k.isSame(a,b)))).toHaveLength(1)}
      finally {[...left,...right].forEach(h=>k.release(h))}
    } finally {faces.forEach(h=>k.release(h)); k.release(reloaded)}
    const reopened=editor.open(second.step)
    const editable=reopened.faces.find(f=>!f.reason && f.openSheet)
    expect(editable).toBeDefined()
    expect(reopened.faces.every(f=>!f.freeBoundary)).toBe(true)
    const selected=editor.select(editable!.index)
    expect(()=>editor.evaluate(selected,'G0',false,true)).toThrow(/sola faccia aperta/)
    const restored=editor.evaluate(selected,'G0')
    const bounds=editor.sheetEdges(restored.previewRevision)
    const nextEdge=bounds.findIndex(path=>path.every(p=>Math.abs(p[2]-14)<1e-7))
    expect(nextEdge).toBeGreaterThan(-1)
    const third=editor.duplicateSheetEdge(restored.previewRevision,nextEdge,[2,0,0])
    expect(third.preview.faceMeshes).toHaveLength(4)
    expect(third.totalArea).toBeCloseTo(930,7)
    editor.open(k.exportStep(box))
    const solidPreview=editor.evaluate(editor.select(5),'G0')
    expect(()=>editor.duplicateSheetEdge(solidPreview.previewRevision,index,[5,0,0])).toThrow(/aperta/)
  } finally {fs.forEach(h=>k.release(h));k.release(box);editor.dispose()}
})
