// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { Vector3 } from 'three'
import { orientedSurfaceNormal, SurfaceEditorKernel } from '../editorKernel'
import { localFrame, localFrameAtUv } from '../localFrame'
import type { Net, Point } from '../brep'

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
        expect(new Set(net.weights).size).toBeGreaterThan(1)
        const nativeFace = faces[face.index], uv = k.uvBounds(nativeFace)
        const offCorner: number[] = []
        for (const [fu,fv] of [[.27,.38], [.73,.62], [.5,.5]]) {
          const u = uv.uMin + (uv.uMax - uv.uMin) * fu, v = uv.vMin + (uv.vMax - uv.vMin) * fv
          const nativeNormal = orientedSurfaceNormal(k, nativeFace, u, v)
          const frame = localFrameAtUv(net, u, v, nativeNormal)!
          expect(frame).not.toBeNull()
          const nativeDu = (uv.uMax - uv.uMin) * 1e-5
          const a = k.pointOnSurface(nativeFace, u - nativeDu, v), b = k.pointOnSurface(nativeFace, u + nativeDu, v)
          const expectedU = new Vector3(b.x-a.x, b.y-a.y, b.z-a.z).normalize()
          const [U,V,N] = frame.map(axis => new Vector3(...axis))
          const expectedN = new Vector3(...nativeNormal)
          expect(U.dot(expectedU)).toBeGreaterThan(1-1e-8)
          expect(N.dot(expectedN)).toBeGreaterThan(1-1e-8)
          expect(V.dot(expectedN.clone().cross(expectedU))).toBeGreaterThan(1-1e-8)
          expect(U.clone().cross(V).dot(N)).toBeCloseTo(1, 12)
          offCorner.push(1 - Math.abs(N.dot(new Vector3(...localFrame(net, 0)![2]))))

          const reversed = localFrameAtUv(net, u, v, nativeNormal.map(x => -x) as Point)!
          expect(reversed[0]).toEqual(frame[0])
          expect(new Vector3(...reversed[1]).dot(V)).toBeCloseTo(-1, 12)
          expect(new Vector3(...reversed[2]).dot(expectedN)).toBeCloseTo(-1, 12)
          expect(localFrameAtUv(net, u, v, frame[0])).toBeNull()
        }
        expect(Math.max(...offCorner)).toBeGreaterThan(1e-5)
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

  it('rejects C0 knots, invalid domains, normals and degenerate or invalid control nets', () => {
    const net: Net = {
      nu:3, nv:2, du:1, dv:1, ku:[0,.5,1], kv:[0,1], mu:[2,1,2], mv:[2,2],
      poles:[[0,0,0],[0,1,0],[1,0,0],[1,1,0],[2,0,1],[2,1,1]], weights:Array(6).fill(1), rational:[0,0],
    }
    const normal: Point = [0,0,1]
    expect(localFrameAtUv(net, .25, .5, normal)?.[2]).toEqual(normal)
    expect(localFrameAtUv(net, .75, .5, [-Math.SQRT1_2,0,Math.SQRT1_2])).not.toBeNull()
    for (const u of [NaN, -.1, .5, .5+Number.EPSILON, 1.1])
      expect(localFrameAtUv(net, u, .5, normal)).toBeNull()
    expect(localFrameAtUv(net, .25, .5, [0,0,0])).toBeNull()
    expect(localFrameAtUv(net, .25, .5, [0,0,Infinity])).toBeNull()
    expect(localFrameAtUv({...net, poles:net.poles.map(() => [0,0,0])}, .25, .5, normal)).toBeNull()
    expect(localFrameAtUv({...net, weights:[1,1,0,1,1,1]}, .25, .5, normal)).toBeNull()
    expect(localFrameAtUv({...net, periodic:[1,0]}, .25, .5, normal)).toBeNull()
  })
})
