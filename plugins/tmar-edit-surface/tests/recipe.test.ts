// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest'
import { SurfaceEditorKernel } from '../editorKernel'
import { readRecipe } from '../recipe'
import { readFileSync } from 'node:fs'

describe('Surface Edit persistent CAD recipe', () => {
  it('does not overwrite a newer preview when hashing a recipe is delayed', async () => {
    const editor=await SurfaceEditorKernel.load(),k=editor.kernel,box=k.makeBox(20,30,10),step=k.exportStep(box)
    k.release(box)
    let release!:()=>void
    const gate=new Promise<void>(resolve=>{release=resolve}),digest=crypto.subtle.digest.bind(crypto.subtle)
    try {
      const opened=editor.open(step),net=editor.select(opened.faces.find(f=>!f.reason)!.index)
      const spy=vi.spyOn(crypto.subtle,'digest').mockImplementation(async (...args)=>{await gate;return digest(...args)})
      try {
        const pending=editor.createRecipe(net,'G0',[],'race-qa')
        editor.evaluate(net,'G0')
        release()
        await expect(pending).rejects.toThrow(/anteprima cambiata/)
      } finally {release();spy.mockRestore()}
    } finally {editor.dispose()}
  })
  const schemaBase = {
    schema: 'tmar.surface-edit', version: 2, engine: 'occt-wasm-5.7.1/brep-v3',
    units: 'mm', coordinateFrame: 'imported-step',
    source: { bodyId: 'schema-fixture', brepSha256: 'a'.repeat(64), faceCount: 1, solidCount: 0 },
    faceIndex: 0, preparation: 'native-nurbs', baseNetSha256: 'b'.repeat(64), continuity: 'G0',
    edits: [{ index: 12, point: [1, 2, 3] }], lockedPoles: [12],
  }
  it('validates ordered v4 refinement recipes without changing legacy recipes', () => {
    const legacy = [schemaBase, { ...schemaBase, version: 3, boundaryMode: 'free-natural' }]
    for (const recipe of legacy) {
      expect(readRecipe(recipe)).toEqual(recipe)
      for (const refinements of [undefined, [], [{ axis: 'U', value: 0.5, count: 1 }]])
        expect(() => readRecipe({ ...recipe, refinements })).toThrow(/non supportata/)
    }
    for (const boundaryMode of ['locked', 'free-natural']) {
      const recipe = { ...schemaBase, version: 4, boundaryMode,
        refinements: [{ axis: 'V', value: -10, count: 2 }, { axis: 'U', value: 0.5, count: 1 }, { axis: 'V', value: -10, count: 1 }] }
      const parsed = readRecipe(JSON.parse(JSON.stringify(recipe)))
      expect(parsed).toEqual(recipe)
      expect(parsed).not.toBe(recipe)
      if (parsed.version !== 4) throw new Error('Expected v4')
      parsed.refinements[0].value = 100
      parsed.edits[0].point[0] = 99
      expect(recipe.refinements[0].value).toBe(-10)
      expect(recipe.edits[0].point[0]).toBe(1)
    }
    // Free boundaries keep the single-open-face requirement, also in v4.
    for (const source of [{ ...schemaBase.source, faceCount: 2 }, { ...schemaBase.source, solidCount: 1 }]) {
      const recipe = { ...schemaBase, version: 4, source, refinements: [{ axis: 'U', value: 0.5, count: 1 }] }
      expect(() => readRecipe({ ...recipe, boundaryMode: 'free-natural' })).toThrow(/non supportata/)
      expect(readRecipe({ ...recipe, boundaryMode: 'locked' }).version).toBe(4)
    }
  })
  it('rejects malformed refinement plans before replay', () => {
    const recipe = { ...schemaBase, version: 4, boundaryMode: 'locked', refinements: [{ axis: 'U', value: 0.5, count: 1 }] }
    for (const refinements of [undefined, null, {}, [], new Array(1), Array(129).fill(recipe.refinements[0]),
      [null], [{ axis: 'u', value: 0.5, count: 1 }], [{ axis: 'X', value: 0.5, count: 1 }],
      ...[NaN, Infinity, -Infinity, '0.5', null, undefined].map(value => [{ axis: 'U', value, count: 1 }]),
      ...[0, -1, 1.5, 26, Infinity, '1', undefined].map(count => [{ axis: 'U', value: 0.5, count }]),
      [{ axis: 'U', value: 0.5, count: 1, automatic: true }],
    ]) expect(() => readRecipe({ ...recipe, refinements })).toThrow(/Raffinamenti/)
    for (const boundaryMode of [undefined, 'free', true])
      expect(() => readRecipe({ ...recipe, boundaryMode })).toThrow(/non supportata/)
    expect(() => readRecipe({ ...recipe, freeBoundary: false })).toThrow(/non supportata/)
    expect(() => readRecipe({ ...recipe, version: 5 })).toThrow(/non supportata/)
  })
  it('serializes, reopens and replays on upstream STEP; refuses changed sources and invalid edits', async () => {
    const editor = await SurfaceEditorKernel.load(), k = editor.kernel
    const box = k.makeBox(20, 30, 10), step = k.exportStep(box)
    k.release(box)
    try {
      const opened = editor.open(step)
      const top = opened.faces.find(f => editor.select(f.index).poles.every(p => Math.abs(p[2] - 10) < 1e-6))!
      const net = editor.select(top.index)
      net.poles[12][2] += 3
      const direct = editor.evaluate(net, 'G1', true)
      const recipe = JSON.parse(JSON.stringify(await editor.createRecipe(net, 'G1', [12], 'body-qa')))
      expect(recipe.version).toBe(2)
      expect(recipe).not.toHaveProperty('boundaryMode')
      expect(recipe.edits).toEqual([{ index: 12, point: net.poles[12] }])
      expect(recipe.preparation).toBe('plane-to-bicubic')
      expect(recipe.units).toBe('mm')
      expect(recipe.coordinateFrame).toBe('imported-step')
      editor.clear()
      const reopened = await editor.restoreRecipe(step, recipe, 'body-qa')
      expect(reopened.freeBoundary).toBe(false)
      expect(reopened.net).toEqual(net)
      expect(reopened.lockedPoles).toEqual([12])
      expect(reopened.preview.volume).toBeCloseTo(direct.volume, 8)
      const replay = await editor.replayRecipe(step, recipe, 'body-qa')
      const replayed = k.importStep(replay.step!), reference = k.importStep(direct.step!)
      const rf = k.getSubShapes(replayed, 'face'), df = k.getSubShapes(reference, 'face')
      try {
        expect(k.isValid(replayed)).toBe(true)
        expect(k.getVolume(replayed)).toBeCloseTo(k.getVolume(reference), 8)
        expect(rf.length).toBe(df.length)
        for (let face = 0; face < rf.length; face++) {
          const b = k.uvBounds(df[face])
          for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
            const u = b.uMin + (b.uMax - b.uMin) * i / 8, v = b.vMin + (b.vMax - b.vMin) * j / 8
            const a = k.pointOnSurface(rf[face], u, v), c = k.pointOnSurface(df[face], u, v)
            expect(Math.hypot(a.x - c.x, a.y - c.y, a.z - c.z)).toBeLessThan(1e-8)
          }
        }
      } finally { [...rf, ...df].forEach(f => k.release(f)); k.release(replayed); k.release(reference) }
      await expect(editor.replayRecipe(step, recipe, 'other-body')).rejects.toThrow(/Corpo sorgente/)
      const changed = k.makeBox(20, 30, 11)
      const changedStep = k.exportStep(changed); k.release(changed)
      await expect(editor.replayRecipe(changedStep, recipe, 'body-qa')).rejects.toThrow(/Geometria sorgente/)
      await expect(editor.restoreRecipe(changedStep, recipe, 'body-qa')).rejects.toThrow(/Geometria sorgente/)
      // Both rejected calls preserve the selected original face and its draft.
      expect(editor.evaluate(net, 'G1').volume).toBeCloseTo(direct.volume, 8)
      await expect(editor.replayRecipe(step, { ...recipe, baseNetSha256: '0'.repeat(64) }, 'body-qa')).rejects.toThrow(/Base NURBS/)
      await expect(editor.replayRecipe(step, { ...recipe, preparation: 'native-nurbs' }, 'body-qa')).rejects.toThrow(/Base NURBS/)
      await expect(editor.replayRecipe(step, { ...recipe, edits: [{ index: 0, point: [0, 0, 99] }] }, 'body-qa')).rejects.toThrow(/protetto/)
      await expect(editor.replayRecipe(step, { ...recipe, lockedPoles: [1599] }, 'body-qa')).rejects.toThrow(/inesistente/)
      const crossing = structuredClone(recipe); crossing.edits[0].point[2] = -50
      await expect(editor.replayRecipe(step, crossing, 'body-qa')).rejects.toThrow(/interseca|attraversa/)
      expect(() => readRecipe({ ...recipe, version: 1 })).toThrow(/non supportata/)
      expect(() => readRecipe({ ...recipe, boundaryMode: 'free-natural' })).toThrow(/non supportata/)
      expect(() => readRecipe({ ...recipe, freeBoundary: true })).toThrow(/non supportata/)
      for (const units of ['m', 'inch', undefined]) expect(() => readRecipe({ ...recipe, units })).toThrow(/non supportata/)
      for (const coordinateFrame of ['world', 'screen', undefined]) expect(() => readRecipe({ ...recipe, coordinateFrame })).toThrow(/non supportata/)
      expect(() => readRecipe({ ...recipe, edits: [...recipe.edits, ...recipe.edits] })).toThrow(/Poli/)
      expect(() => readRecipe({ ...recipe, lockedPoles: [12, 12] })).toThrow(/Poli/)
      expect(() => readRecipe({ ...recipe, edits: [{ index: 12, point: [NaN, 0, 0] }] })).toThrow(/Poli/)
      expect(() => readRecipe({ ...recipe, source: { ...recipe.source, bodyId: '' } })).toThrow(/non supportata/)
    } finally { editor.dispose() }
  }, 60000)
  it('serializes and safely replays a free natural boundary without changing v2 recipes', async () => {
    const editor=await SurfaceEditorKernel.load(), k=editor.kernel
    const box=k.makeBox(20,30,10), faces=k.getSubShapes(box,'face')
    const step=k.exportStep(faces[5]);faces.forEach(f=>k.release(f))
    try {
      const opened=editor.open(step)
      expect(opened.faces[0].freeBoundary).toBe(true)
      const net=editor.select(0);net.poles[0][2]+=2;net.poles[12][2]+=0.5
      const expected=editor.evaluate(net,'G0',true,true)
      const recipe=JSON.parse(JSON.stringify(await editor.createRecipe(net,'G0',[0,12],'sheet-qa',true)))
      expect(recipe.version).toBe(3);expect(recipe.boundaryMode).toBe('free-natural')
      expect(recipe.lockedPoles).toEqual([0,12])
      const replay=await editor.replayRecipe(step,recipe,'sheet-qa')
      const actualShape=k.importStep(replay.step!), expectedShape=k.importStep(expected.step!)
      const actualFaces=k.getSubShapes(actualShape,'face'), expectedFaces=k.getSubShapes(expectedShape,'face')
      try {
        expect(k.isValid(actualShape)).toBe(true);expect(actualFaces).toHaveLength(1)
        const b=k.uvBounds(expectedFaces[0])
        for(let i=0;i<=12;i++)for(let j=0;j<=12;j++){
          const u=b.uMin+(b.uMax-b.uMin)*i/12, v=b.vMin+(b.vMax-b.vMin)*j/12
          const a=k.pointOnSurface(actualFaces[0],u,v), e=k.pointOnSurface(expectedFaces[0],u,v)
          expect(Math.hypot(a.x-e.x,a.y-e.y,a.z-e.z)).toBeLessThan(1e-8)
        }
      } finally {[...actualFaces,...expectedFaces,actualShape,expectedShape].forEach(f=>k.release(f))}
      const restored=await editor.restoreRecipe(step,recipe,'sheet-qa')
      expect(restored.net).toEqual(net);expect(restored.freeBoundary).toBe(true);expect(restored.lockedPoles).toEqual([0,12])
      await expect(editor.replayRecipe(step,recipe,'wrong-body')).rejects.toThrow(/Corpo sorgente/)
      const different=k.makeBox(21,30,10), differentFaces=k.getSubShapes(different,'face')
      const differentStep=k.exportStep(differentFaces[5]);differentFaces.forEach(f=>k.release(f));k.release(different)
      await expect(editor.restoreRecipe(differentStep,recipe,'sheet-qa')).rejects.toThrow(/Geometria sorgente/)
      expect(editor.evaluate(net,'G0',false,true).valid).toBe(true)
      for(const bad of [
        { ...recipe, boundaryMode: 'locked' },
        { ...recipe, boundaryMode: undefined },
        { ...recipe, freeBoundary: true },
        { ...recipe, source: { ...recipe.source, faceCount: 2 } },
        { ...recipe, source: { ...recipe.source, solidCount: 1 } },
      ]) expect(()=>readRecipe(bad)).toThrow(/non supportata/)
      expect(()=>editor.evaluate(net,'G0',false,'yes' as unknown as boolean)).toThrow(/Modalità bordo/)
      await expect(editor.createRecipe(net,'G0',[],'sheet-qa','yes' as unknown as boolean)).rejects.toThrow(/Modalità bordo/)
      editor.open(k.exportStep(box))
      await expect(editor.createRecipe(editor.select(0),'G0',[],'solid',true)).rejects.toThrow(/sola faccia aperta/)
    } finally { k.release(box);editor.dispose() }
  }, 60000)
  it('refuses forged free-boundary recipes on an open STEP face with a hole',async()=>{
    const editor=await SurfaceEditorKernel.load(), k=editor.kernel
    const block=k.makeBox(48,48,10), tool=k.makeCylinder(3,14)
    const positioned=k.translate(tool,12,12,-2), drilled=k.cut(block,positioned), faces=k.getSubShapes(drilled,'face')
    try {
      const top=faces.find(face=>{
        const b=k.uvBounds(face), wires=k.getSubShapes(face,'wire')
        try {return wires.length===2 && Math.abs(k.pointOnSurface(face,(b.uMin+b.uMax)/2,(b.vMin+b.vMax)/2).z-10)<1e-7}
        finally {wires.forEach(w=>k.release(w))}
      })!
      const step=k.exportStep(top), opened=editor.open(step)
      expect(opened.faces[0].freeBoundary).toBe(false)
      const net=editor.select(0), recipe=await editor.createRecipe(net,'G0',[],'holed')
      await expect(editor.createRecipe(net,'G0',[],'holed',true)).rejects.toThrow(/sola faccia aperta/)
      await expect(editor.replayRecipe(step,{...recipe,version:3,boundaryMode:'free-natural'},'holed')).rejects.toThrow(/sola faccia aperta/)
      expect(editor.evaluate(net,'G0').valid).toBe(true)
    } finally {faces.forEach(f=>k.release(f));[drilled,positioned,tool,block].forEach(h=>k.release(h));editor.dispose()}
  },60000)
  it('normalizes STEP metres to millimetres and preserves a caller-owned kernel on disposal', async () => {
    const owner = await SurfaceEditorKernel.load(), k = owner.kernel
    const box = k.makeBox(2, 3, 1), mmStep = k.exportStep(box)
    k.release(box)
    expect(mmStep).toContain('SI_UNIT(.MILLI.,.METRE.)')
    const metreStep = mmStep.replaceAll('SI_UNIT(.MILLI.,.METRE.)', 'SI_UNIT($,.METRE.)')
    const borrowed = new SurfaceEditorKernel(k)
    try {
      const imported = k.importStep(metreStep)
      try { expect(k.getVolume(imported)).toBeCloseTo(6000000000, 0) }
      finally { k.release(imported) }
      borrowed.open(mmStep)
      borrowed.dispose()
      const stillUsable = k.makeBox(2, 3, 1)
      try { expect(k.getVolume(stillUsable)).toBeCloseTo(6, 8) }
      finally { k.release(stillUsable) }
    } finally { borrowed.clear(); owner.dispose() }
  }, 60000)
  it('replays exact refinement of a rational STEP face and native NURBS on a second edit', async () => {
    const editor = await SurfaceEditorKernel.load()
    const step = readFileSync('plugins/tmar-edit-surface/evidence/refined-roundtrip/run-Zlk2YR/curved-rational.step', 'utf8')
    try {
      const opened = editor.open(step), face = opened.faces.find(f => f.enriched && !f.reason)!
      const net = editor.select(face.index); net.poles[12][2] += 0.5
      const recipe = await editor.createRecipe(net, 'G1', [12], 'curved')
      expect(recipe.preparation).toBe('bicubic-midpoint-refinement')
      const result = await editor.replayRecipe(step, JSON.parse(JSON.stringify(recipe)), 'curved')
      expect(result.volume).toBeCloseTo(editor.evaluate(net, 'G1').volume, 8)
      const restored = await editor.restoreRecipe(step, recipe, 'curved')
      expect(restored.net).toEqual(net)
      const second = editor.open(result.step!), nativeFace = second.faces.find(f => !f.converted && !f.enriched && !f.reason)!
      const nativeNet = editor.select(nativeFace.index); nativeNet.poles[12][2] += 0.25
      const nativeRecipe = await editor.createRecipe(nativeNet, 'G1', [], 'curved')
      expect(nativeRecipe.preparation).toBe('native-nurbs')
      const again = await editor.replayRecipe(result.step!, JSON.parse(JSON.stringify(nativeRecipe)), 'curved')
      expect(again.valid).toBe(true)
      expect(again.volume).toBeCloseTo(editor.evaluate(nativeNet, 'G1').volume, 8)
    } finally { editor.dispose() }
  }, 60000)
})
