// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { SurfaceEditorKernel } from '../editorKernel'
import { readRecipe } from '../recipe'
import { readFileSync } from 'node:fs'

describe('Surface Edit persistent CAD recipe', () => {
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
      expect(recipe.edits).toEqual([{ index: 12, point: net.poles[12] }])
      expect(recipe.preparation).toBe('plane-to-bicubic')
      editor.clear()
      const reopened = await editor.restoreRecipe(step, recipe, 'body-qa')
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
      expect(() => readRecipe({ ...recipe, version: 2 })).toThrow(/non supportata/)
      expect(() => readRecipe({ ...recipe, edits: [...recipe.edits, ...recipe.edits] })).toThrow(/Poli/)
      expect(() => readRecipe({ ...recipe, lockedPoles: [12, 12] })).toThrow(/Poli/)
      expect(() => readRecipe({ ...recipe, edits: [{ index: 12, point: [NaN, 0, 0] }] })).toThrow(/Poli/)
      expect(() => readRecipe({ ...recipe, source: { ...recipe.source, bodyId: '' } })).toThrow(/non supportata/)
    } finally { editor.dispose() }
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
