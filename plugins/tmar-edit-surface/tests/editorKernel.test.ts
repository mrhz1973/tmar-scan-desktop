// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'vitest'
import { SurfaceEditorKernel } from '../editorKernel'
import { boundaryLocked, surfaceTable, encodeNet } from '../brep'

describe('Edit Surface — real STEP / OCCT', () => {
  it('edits a STEP solid, preserves G1 boundaries and reopens the CAD result', async () => {
    const editor = await SurfaceEditorKernel.load(), k = editor.kernel
    const box = k.makeBox(20, 30, 10), step = k.exportStep(box)
    k.release(box)
    try {
      const opened = editor.open(step)
      expect(opened.faces).toHaveLength(6)
      expect(opened.faces.map(f => f.reason)).toEqual(Array(6).fill(null))
      // Find the horizontal top using its pole grid; face order is NOT assumed.
      const top = opened.faces.find(f => editor.select(f.index).poles.every(p => Math.abs(p[2] - 10) < 1e-6))!
      expect(top).toBeDefined()
      const original = editor.select(top.index), changed = structuredClone(original)
      changed.poles[12][2] += 3
      const result = editor.evaluate(changed, 'G1', true)
      expect(result.valid).toBe(true)
      expect(result.volume).toBeGreaterThan(6000)
      expect(result.maxBoundaryError).toBeLessThan(1e-8)
      // Kernel evaluates a different surface (not a display-only mesh).
      const imported = k.importStep(result.step!)
      try {
        expect(k.isValid(imported)).toBe(true)
        expect(k.getVolume(imported)).toBeCloseTo(result.volume, 4)
        expect(surfaceTable(k.toBREP(imported)).some(r => r.net)).toBe(true)
      } finally { k.release(imported) }
      // Undo uses the original immutable net; it really restores volume.
      expect(editor.evaluate(original, 'G1').volume).toBeCloseTo(6000, 6)
      const crossing = structuredClone(original)
      crossing.poles[12][2] -= 50
      expect(() => editor.evaluate(crossing, 'G1')).toThrow(/interseca|attraversa/)
      // Reopen the modified STEP and edit existing NURBS poles directly.
      const second = editor.open(result.step!)
      const nurbs = second.faces.find(f => !f.converted && !f.reason)!
      expect(nurbs).toBeDefined()
      const net = editor.select(nurbs.index), newer = structuredClone(net)
      const unlocked = net.poles.findIndex((_, i) => !boundaryLocked(net, i, 'G1'))
      newer.poles[unlocked][2] += 1
      expect(editor.evaluate(newer, 'G1', true).valid).toBe(true)
      expect(encodeNet(net)).not.toEqual(encodeNet(newer))
      newer.poles[0][2] += 1
      expect(() => editor.evaluate(newer, 'G1')).toThrow(/protetto/)
    } finally { editor.dispose() }
  }, 60000)
})
