// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'vitest'
import { SurfaceEditorKernel } from '../editorKernel'
import { boundaryLocked, surfaceTable, encodeNet, replaceSurface, signature, type Net, type Point } from '../brep'

describe('Edit Surface — real STEP / OCCT', () => {
  it('enriches an imported curved rational 4x4 STEP face exactly before G1 editing', async () => {
    const editor = await SurfaceEditorKernel.load(), k = editor.kernel
    const box = k.makeBox(20, 30, 10), faces = k.getSubShapes(box, 'face')
    try {
      const top = faces.find(f => { const b = k.uvBounds(f); return Math.abs(k.pointOnSurface(f, (b.uMin + b.uMax) / 2, (b.vMin + b.vMax) / 2).z - 10) < 1e-8 })!
      const b = k.uvBounds(top), own = surfaceTable(k.toBREP(top)).find(r => r.kind === 1)!
      const text = k.toBREP(box), record = surfaceTable(text).find(r => signature(r) === signature(own))!
      const poles: Point[] = [], weights: number[] = []
      for (let u = 0; u < 4; u++) for (let v = 0; v < 4; v++) {
        const p = k.pointOnSurface(top, b.uMin + (b.uMax - b.uMin) * u / 3, b.vMin + (b.vMax - b.vMin) * v / 3)
        const interior = u > 0 && u < 3 && v > 0 && v < 3
        poles.push([p.x, p.y, p.z + (interior ? 0.2 * u + 0.1 * v : 0)])
        weights.push(interior ? 1 + 0.13 * u + 0.07 * v : 1)
      }
      const patch: Net = { nu: 4, nv: 4, du: 3, dv: 3, poles, weights, rational: [1, 1], ku: [b.uMin, b.uMax], kv: [b.vMin, b.vMax], mu: [4, 4], mv: [4, 4] }
      const raw = k.fromBREP(replaceSurface(text, record, patch)), fixture = k.fixShape(raw)
      let step: string
      try { expect(k.isValid(fixture)).toBe(true); step = k.exportStep(fixture) } finally { k.release(fixture); k.release(raw) }
      // The editor only receives STEP. Comparison uses independently imported
      // OCCT geometry, not the refinement formula as its own oracle.
      const baseline = k.importStep(step), baseFaces = k.getSubShapes(baseline, 'face')
      try {
        const opened = editor.open(step), info = opened.faces.find(f => f.enriched && !f.reason)!
        expect(info).toBeDefined()
        const net = editor.select(info.index)
        expect([net.nu, net.nv]).toEqual([5, 5])
        expect(net.poles.flatMap((_, i) => boundaryLocked(net, i, 'G1') ? [] : [i])).toEqual([12])
        expect(net.ku[0]).toBe(b.uMin); expect(net.ku.at(-1)).toBe(b.uMax)
        expect(net.kv[0]).toBe(b.vMin); expect(net.kv.at(-1)).toBe(b.vMax)
        const unchanged = editor.evaluate(net, 'G1', true), same = k.importStep(unchanged.step!), sameFaces = k.getSubShapes(same, 'face')
        try {
          expect(sameFaces.length).toBe(baseFaces.length)
          // Volume uses numerical quadrature, whose subdivision changes after
          // knot insertion. Geometry/normal checks below remain at CAD precision.
          expect(Math.abs(k.getVolume(same) - k.getVolume(baseline))).toBeLessThan(k.getVolume(baseline) * 1e-8)
          for (let f = 0; f < baseFaces.length; f++) {
            const bounds = k.uvBounds(baseFaces[f])
            for (let i = 0; i <= 12; i++) for (let j = 0; j <= 12; j++) {
              const u = bounds.uMin + (bounds.uMax - bounds.uMin) * i / 12, v = bounds.vMin + (bounds.vMax - bounds.vMin) * j / 12
              const a = k.pointOnSurface(baseFaces[f], u, v), c = k.pointOnSurface(sameFaces[f], u, v)
              expect(Math.hypot(a.x - c.x, a.y - c.y, a.z - c.z)).toBeLessThan(1e-8)
              const na = k.surfaceNormal(baseFaces[f], u, v), nc = k.surfaceNormal(sameFaces[f], u, v)
              expect(na.x * nc.x + na.y * nc.y + na.z * nc.z).toBeGreaterThan(1 - 1e-10)
            }
          }
        } finally { sameFaces.forEach(f => k.release(f)); k.release(same) }
        const moved = structuredClone(net); moved.poles[12][2] += 0.5
        const result = editor.evaluate(moved, 'G1', true)
        expect(result.valid).toBe(true); expect(result.volume).toBeGreaterThan(unchanged.volume + 1)
        expect(result.maxBoundaryError).toBeLessThan(1e-8)
        const roundtrip = k.importStep(result.step!)
        try { expect(k.isValid(roundtrip)).toBe(true); expect(k.getVolume(roundtrip)).toBeCloseTo(result.volume, 5) } finally { k.release(roundtrip) }
      } finally { baseFaces.forEach(f => k.release(f)); k.release(baseline) }
    } finally { faces.forEach(f => k.release(f)); k.release(box); editor.dispose() }
  }, 60000)
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
