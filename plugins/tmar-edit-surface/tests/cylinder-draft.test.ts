// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it, vi } from 'vitest'
import { SurfaceEditorKernel } from '../editorKernel'
import { prepareCylinder } from '../cylinderPreparation'
import { CylinderDraft } from '../cylinderDraft'

it('retains validated cylinder geometry across move, locks, Undo and Redo',async()=>{
  const editor=await SurfaceEditorKernel.load(),k=editor.kernel,primitive=k.makeCylinder(10,20)
  const source=k.importStep(k.exportStep(primitive)),faces=k.getSubShapes(source,'face')
  try {
    const original=k.toBREP(source),index=faces.findIndex(f=>k.surfaceType(f)==='cylinder')
    const prepared=prepareCylinder(k,source,index),draft=new CylinderDraft(k,prepared,index),initial=draft.snapshot()
    prepared.net.poles[0][0]+=123 // caller cannot mutate the owned base
    draft.move([.2,-.1,.15])
    const changed=draft.snapshot()
    expect(changed.net.poles).not.toEqual(initial.net.poles)
    expect(changed.canUndo).toBe(true)
    const round=k.importStep(changed.step)
    try {expect(k.isValid(round)).toBe(true)} finally {k.release(round)}
    expect(()=>draft.move([100,0,0])).toThrow()
    expect(draft.snapshot().net).toEqual(changed.net)
    draft.setLocks([2*changed.net.nv+2])
    expect(()=>draft.move([.1,0,0])).toThrow(/bloccato/)
    const tessellate=vi.spyOn(k,'tessellate')
    expect(draft.step(-1)).toBe(true) // undo lock
    expect(tessellate).not.toHaveBeenCalled()
    tessellate.mockRestore()
    expect(draft.snapshot().locks).toEqual([])
    expect(draft.snapshot().canRedo).toBe(true)
    expect(draft.step(-1)).toBe(true) // undo move
    expect(draft.snapshot().net).toEqual(initial.net)
    expect(draft.step(1)).toBe(true)
    expect(draft.snapshot().net).toEqual(changed.net)
    expect(draft.snapshot().canUndo).toBe(true)
    const external=draft.snapshot();external.net.poles[0][0]+=10
    expect(draft.snapshot().net).toEqual(changed.net)
    expect(k.toBREP(source)).toBe(original)
  } finally {faces.forEach(h=>k.release(h));k.release(source);k.release(primitive);editor.dispose()}
},60000)
