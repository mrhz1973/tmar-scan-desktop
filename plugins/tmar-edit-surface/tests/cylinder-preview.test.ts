// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it, vi } from 'vitest'
import { SurfaceEditorKernel } from '../editorKernel'
import { prepareCylinder } from '../cylinderPreparation'
import { evaluatePreparedCylinder } from '../cylinderEvaluation'
import { previewPreparedCylinder } from '../cylinderPreview'
import { moveSmoothCylinderPole } from '../periodic'

it('keeps a provisional drag preview separate from validated CAD output',async()=>{
  const editor=await SurfaceEditorKernel.load(),k=editor.kernel,primitive=k.makeCylinder(10,20)
  const source=k.importStep(k.exportStep(primitive)),faces=k.getSubShapes(source,'face')
  try {
    const before=k.toBREP(source),index=faces.findIndex(f=>k.surfaceType(f)==='cylinder')
    const prepared=prepareCylinder(k,source,index),candidate=moveSmoothCylinderPole(prepared.net,[.2,-.1,.15])
    const exported=vi.spyOn(k,'exportStep')
    const start=performance.now(),preview=previewPreparedCylinder(k,prepared,candidate),previewMs=performance.now()-start
    expect(preview.kind).toBe('provisional')
    expect(preview.mesh.triangleCount).toBeGreaterThan(0)
    expect(preview.faceMeshes).toHaveLength(3)
    expect(exported).not.toHaveBeenCalled()
    expect('step' in preview).toBe(false)
    const finalStart=performance.now(),final=evaluatePreparedCylinder(k,prepared,index,candidate),finalMs=performance.now()-finalStart
    expect(final.mesh.triangleCount).toBeGreaterThan(0)
    expect(exported).toHaveBeenCalledOnce()
    const round=k.importStep(final.step)
    try { expect(k.isValid(round)).toBe(true) } finally { k.release(round) }
    const invalid=structuredClone(candidate);invalid.poles[0][0]+=1
    expect(()=>previewPreparedCylinder(k,prepared,invalid)).toThrow()
    expect(k.toBREP(source)).toBe(before)
    console.info(`Cylinder synthetic STEP: provisional ${previewMs.toFixed(1)} ms; full evaluation ${finalMs.toFixed(1)} ms`)
    exported.mockRestore()
  } finally {faces.forEach(f=>k.release(f));k.release(source);k.release(primitive);editor.dispose()}
},60000)
