// SPDX-License-Identifier: AGPL-3.0-only
import {it, expect} from 'vitest'
import {SurfaceEditorKernel} from '../editorKernel'

it('duplicates a free STEP edge as a sewn strip and rejects an overlapping result',async()=>{
  const editor=await SurfaceEditorKernel.load(), k=editor.kernel
  const box=k.makeBox(20,30,10), fs=k.getSubShapes(box,'face')
  try {
    const step=k.exportStep(fs[5]), opened=editor.open(step)
    expect(opened.faces[0].singleSheet).toBe(true)
    const net=editor.select(0), p=editor.evaluate(net,'G0'), rev=p.previewRevision
    const paths=editor.sheetEdges(rev), index=paths.findIndex(path=>path.every(q=>Math.abs(q[0]-20)<1e-7))
    expect(index).toBeGreaterThan(-1)
    expect(()=>editor.duplicateSheetEdge(rev,index,[-5,0,0])).toThrow(/sovrappone/)
    expect(()=>editor.duplicateSheetEdge(rev,index,[0,0,0])).toThrow()
    const result=editor.duplicateSheetEdge(rev,index,[5,0,0])
    expect(result.addedArea).toBeCloseTo(150,8)
    const reloaded=k.importStep(result.step), faces=k.getSubShapes(reloaded,'face')
    try {
      expect(k.isValid(reloaded)).toBe(true)
      expect(faces.map(f=>k.getSurfaceArea(f)).sort((a,b)=>a-b)).toEqual([expect.closeTo(150,7),expect.closeTo(600,7)])
      const left=k.getSubShapes(faces[0],'edge'), right=k.getSubShapes(faces[1],'edge')
      try {expect(left.filter(a=>right.some(b=>k.isSame(a,b)))).toHaveLength(1)}
      finally {[...left,...right].forEach(h=>k.release(h))}
    } finally {faces.forEach(h=>k.release(h)); k.release(reloaded)}
    editor.open(k.exportStep(box))
    const solidPreview=editor.evaluate(editor.select(5),'G0')
    expect(()=>editor.duplicateSheetEdge(solidPreview.previewRevision,index,[5,0,0])).toThrow(/aperta/)
  } finally {fs.forEach(h=>k.release(h));k.release(box);editor.dispose()}
})
