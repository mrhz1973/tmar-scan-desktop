// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { Vector3 } from 'three'
import { SurfaceEditorKernel } from '../editorKernel'
import { localFrame } from '../localFrame'
import type { Point } from '../brep'

describe('Local surface manipulator', () => {
  it('matches OCCT tangents on a rotated rational STEP, preserves protected edges and rejects degenerate frames', async () => {
    const editor = await SurfaceEditorKernel.load(), k = editor.kernel
    const original = k.importStep(readFileSync('plugins/tmar-edit-surface/evidence/refined-roundtrip/run-Zlk2YR/curved-rational.step', 'utf8'))
    const rotated = k.rotate(original, { point: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 2, z: 0 } }, 0.6)
    const step = k.exportStep(rotated)
    k.release(rotated); k.release(original)
    try {
      const opened = editor.open(step), face = opened.faces.find(f => f.enriched && !f.reason)!
      expect(face).toBeDefined()
      const net = editor.select(face.index), source = k.importStep(step), faces = k.getSubShapes(source, 'face')
      const greville = (values: number[], mult: number[], degree: number, i: number) => values.flatMap((x, j) => Array(mult[j]).fill(x)).slice(i + 1, i + degree + 1).reduce((s, x) => s + x, 0) / degree
      try {
        for (const index of [0, 6, 7, 12, 18, 24]) {
          const frame = localFrame(net, index)!
          const u = greville(net.ku, net.mu, net.du, Math.floor(index / net.nv)), v = greville(net.kv, net.mv, net.dv, index % net.nv)
          const normal = k.surfaceNormal(faces[face.index], u, v), n = new Vector3(normal.x, normal.y, normal.z)
          expect(Math.abs(new Vector3(...frame[2]).dot(n))).toBeCloseTo(1, 9)
          for (let i = 0; i < 3; i++) {
            expect(new Vector3(...frame[i]).length()).toBeCloseTo(1, 12)
            expect(new Vector3(...frame[i]).dot(new Vector3(...frame[(i + 1) % 3]))).toBeCloseTo(0, 12)
          }
          if (index === 12) {
            const eps = 1e-5, a = k.pointOnSurface(faces[face.index], u - eps, v), b = k.pointOnSurface(faces[face.index], u + eps, v)
            expect(new Vector3(b.x - a.x, b.y - a.y, b.z - a.z).normalize().dot(new Vector3(...frame[0]))).toBeCloseTo(1, 9)
          }
        }
      } finally { faces.forEach(f => k.release(f)); k.release(source) }
      const normal = localFrame(net, 12)![2]
      expect(normal.filter(x => Math.abs(x) > 0.1).length).toBeGreaterThan(1)
      const changed = structuredClone(net)
      changed.poles[12] = changed.poles[12].map((x, d) => x + normal[d] * 0.5) as Point
      const result = editor.evaluate(changed, 'G1', true)
      expect(result.valid).toBe(true)
      expect(result.maxBoundaryError).toBeLessThan(1e-6)
      const roundtrip = k.importStep(result.step!)
      try { expect(k.isValid(roundtrip)).toBe(true) } finally { k.release(roundtrip) }
      const collapsed = structuredClone(net); collapsed.poles = collapsed.poles.map(() => [0, 0, 0])
      expect(localFrame(collapsed, 12)).toBeNull()
      expect(localFrame(net, -1)).toBeNull()
    } finally { editor.dispose() }
  }, 60000)
})
