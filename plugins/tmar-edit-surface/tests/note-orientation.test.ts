// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { ShapeHandle } from 'occt-wasm'
import { SurfaceEditorKernel, orientedSurfaceNormal } from '../editorKernel'

const dot = (a: readonly number[], b: readonly number[]) => a.reduce((sum, value, i) => sum + value * b[i], 0)
const unit = (v: readonly number[]) => {
  const length = Math.hypot(...v)
  return v.map(value => value / length)
}

it('returns unit, face-oriented note normals on forward, reversed and curved STEP faces without changing anchors', async () => {
  const editor = await SurfaceEditorKernel.load(), k = editor.kernel
  const box = k.makeBox(20, 30, 10)
  let faces: ShapeHandle[] = [], stepBox: ShapeHandle | null = null, stepBoxFaces: ShapeHandle[] = []
  let reversedFace: ShapeHandle | null = null, torus: ShapeHandle | null = null, torusFaces: ShapeHandle[] = []
  try {
    faces = k.getSubShapes(box, 'face')
    stepBox = k.importStep(k.exportStep(box))
    stepBoxFaces = k.getSubShapes(stepBox, 'face')
    expect(stepBoxFaces).toHaveLength(6)
    const orientations = stepBoxFaces.map(face => k.shapeOrientation(face))
    expect(orientations).toContain('forward')
    expect(orientations).toContain('reversed')
    for (const face of stepBoxFaces) {
      const bounds = k.uvBounds(face), u = (bounds.uMin + bounds.uMax) / 2, v = (bounds.vMin + bounds.vMax) / 2
      const p = k.pointOnSurface(face, u, v), outward = unit([p.x - 10, p.y - 15, p.z - 5])
      const normal = orientedSurfaceNormal(k, face, u, v)
      expect(Math.hypot(...normal)).toBeCloseTo(1, 12)
      expect(dot(normal, outward)).toBeGreaterThan(1 - 1e-12)
    }
    const top = faces.find(face => {
      const bounds = k.getBoundingBox(face)
      return Math.abs(bounds.zmin - 10) < 1e-8 && Math.abs(bounds.zmax - 10) < 1e-8
    })!
    expect(top).toBeDefined()
    const topPoint = [10, 15, 10] as const
    const forwardOrientation = k.shapeOrientation(top)
    expect(forwardOrientation).toBe('forward')
    const sourceUv = k.uvFromPoint(top, { x: topPoint[0], y: topPoint[1], z: topPoint[2] })
    expect(orientedSurfaceNormal(k, top, sourceUv.u, sourceUv.v)).toEqual([0, 0, 1])
    const forwardStep = k.exportStep(top)
    reversedFace = k.reverseShape(top)
    expect(k.shapeOrientation(reversedFace)).toBe('reversed')
    const reversedStep = k.exportStep(reversedFace)

    const verifyNote = (step: string, expectedNormal: readonly number[]) => {
      const opened = editor.open(step)
      expect(opened.faces).toHaveLength(1)
      const net = editor.select(0), initial = editor.evaluate(net, 'G1')
      const picked = editor.anchorFromPick([...topPoint], initial.previewRevision!)
      const anchorBefore = { ...picked.anchor }, pointBefore = [...picked.at]
      const final = editor.evaluate(net, 'G1', true)
      const resolved = editor.resolveAnchor(picked.anchor, final.previewRevision!)
      expect(resolved.at).toEqual(pointBefore)
      resolved.at.forEach((value, i) => expect(value).toBeCloseTo(topPoint[i], 12))
      expect(picked.anchor).toEqual(anchorBefore)
      expect(Math.hypot(...resolved.normal)).toBeCloseTo(1, 12)
      expect(dot(resolved.normal, expectedNormal)).toBeGreaterThan(1 - 1e-12)
      return resolved.normal
    }
    // The solid's centre gives an independent outward reference for its top face.
    const outwardTop = unit(topPoint.map((value, i) => value - [10, 15, 5][i]))
    const forward = verifyNote(forwardStep, outwardTop)
    const reversed = verifyNote(reversedStep, outwardTop.map(value => -value))
    expect(dot(forward, reversed)).toBeLessThan(-1 + 1e-12)

    // A torus STEP face supplies a curved-surface oracle: radial from the
    // torus tube centreline is the independent solid-outward direction.
    torus = k.makeTorus(10, 2)
    const torusStep = k.exportStep(torus), importedTorus = k.importStep(torusStep)
    torusFaces = k.getSubShapes(importedTorus, 'face')
    try {
      expect(torusFaces).toHaveLength(1)
      const face = torusFaces[0], bounds = k.uvBounds(face)
      const u = bounds.uMin + (bounds.uMax - bounds.uMin) * 0.29
      const v = bounds.vMin + (bounds.vMax - bounds.vMin) * 0.37
      const p = k.pointOnSurface(face, u, v), rho = Math.hypot(p.x, p.y)
      const centreline = [10 * p.x / rho, 10 * p.y / rho, 0]
      const outward = unit([p.x - centreline[0], p.y - centreline[1], p.z - centreline[2]])
      const normal = orientedSurfaceNormal(k, face, u, v)
      expect(Math.hypot(...normal)).toBeCloseTo(1, 12)
      expect(dot(normal, outward)).toBeGreaterThan(1 - 1e-10)
    } finally {
      torusFaces.forEach(face => k.release(face)); torusFaces = []
      k.release(importedTorus)
    }
  } finally {
    torusFaces.forEach(face => k.release(face))
    stepBoxFaces.forEach(face => k.release(face))
    if (stepBox !== null) k.release(stepBox)
    if (reversedFace !== null) k.release(reversedFace)
    faces.forEach(face => k.release(face))
    k.release(box)
    if (torus !== null) k.release(torus)
    editor.dispose()
  }
}, 60000)

it('refuses unsupported face orientation and degenerate or non-finite normals', () => {
  const face = 0 as ShapeHandle
  const fake = (orientation: string, normal: { x: number; y: number; z: number }) => ({
    shapeOrientation: () => orientation,
    surfaceNormal: () => normal,
  }) as unknown as Parameters<typeof orientedSurfaceNormal>[0]
  expect(() => orientedSurfaceNormal(fake('internal', { x: 0, y: 0, z: 1 }), face, 0, 0)).toThrow(/orientamento/i)
  expect(() => orientedSurfaceNormal(fake('forward', { x: 0, y: 0, z: 0 }), face, 0, 0)).toThrow(/normale/i)
  expect(() => orientedSurfaceNormal(fake('forward', { x: Number.NaN, y: 0, z: 1 }), face, 0, 0)).toThrow(/normale/i)
})
