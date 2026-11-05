// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { SurfaceEditorKernel } from '../editorKernel'

it('replays a refined STEP face with its protected boundary and source unchanged', async () => {
  const e=await SurfaceEditorKernel.load(),k=e.kernel,box=k.makeBox(20,30,10),step=k.exportStep(box)
  k.release(box)
  try {
    const opened=e.open(step)
    const top=opened.faces.find(f=>e.select(f.index).poles.every(p=>Math.abs(p[2]-10)<1e-6))!
    const original=e.select(top.index), insertions=[{axis:'U' as const,value:(original.ku[0]+original.ku[1])/2,count:1},
      {axis:'V' as const,value:(original.kv[0]+original.kv[1])/2,count:1}]
    const refined=e.select(top.index,insertions)
    expect(refined.nu).toBe(original.nu+1); expect(refined.nv).toBe(original.nv+1)
    const unchanged=e.evaluate(refined,'G1',true)
    const id=2*refined.nv+2; refined.poles[id][2]+=0.3
    const direct=e.evaluate(refined,'G1',true)
    const recipe=await e.createRecipe(refined,'G1',[id],'qa-refined')
    expect(recipe.version).toBe(4)
    if(recipe.version!==4) throw new Error('Expected v4 recipe')
    expect(recipe.refinements).toEqual(insertions)
    const restored=await e.restoreRecipe(step,JSON.parse(JSON.stringify(recipe)),'qa-refined')
    expect(restored.net).toEqual(refined); expect(restored.lockedPoles).toEqual([id])
    expect(restored.preview.volume).toBeCloseTo(direct.volume,7)
    expect(unchanged.volume).toBeCloseTo(6000,6)
    const replay=await e.replayRecipe(step,recipe,'qa-refined'), solid=k.importStep(replay.step!)
    try { expect(k.isValid(solid)).toBe(true) } finally { k.release(solid) }
    await expect(e.replayRecipe(step,{...recipe,baseNetSha256:'0'.repeat(64)},'qa-refined')).rejects.toThrow(/Base NURBS/)
    await expect(e.replayRecipe(step,{...recipe,refinements:[{axis:'U',value:1e100,count:1}]},'qa-refined')).rejects.toThrow(/Raffinamento/)
    expect(e.evaluate(refined,'G1').volume).toBeCloseTo(direct.volume,7)
  } finally {e.dispose()}
},60000)
