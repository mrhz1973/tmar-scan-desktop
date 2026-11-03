// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { ShapeHandle } from 'occt-wasm'
import { SurfaceEditorKernel } from '../editorKernel'
import { replaceSurface, surfaceTable, type Net, type Point } from '../brep'
import { rebuildFreeBoundary } from '../freeBoundary'

it('rebuilds a moved rational free boundary exactly on its modified NURBS support', async () => {
  const editor = await SurfaceEditorKernel.load(), k = editor.kernel
  const box = k.makeBox(20, 30, 10), boxFaces = k.getSubShapes(box, 'face')
  const owned: ShapeHandle[] = []
  const keep = (shape: ShapeHandle) => { owned.push(shape); return shape }
  try {
    const top = boxFaces.find(face => {
      const b = k.uvBounds(face)
      return Math.abs(k.pointOnSurface(face, (b.uMin + b.uMax) / 2, (b.vMin + b.vMax) / 2).z - 10) < 1e-8
    })!
    const bounds = k.uvBounds(top), sourceText = k.toBREP(top)
    const planar = surfaceTable(sourceText).find(r => r.kind === 1)!
    const at = (u: number, v: number): Point => {
      const p = k.pointOnSurface(top, u, v)
      return [p.x, p.y, p.z]
    }
    // A degree-2 rational Bezier patch over the original plane. All poles lie
    // on that plane and boundary rows are collinear, so its trimmed boundary
    // agrees with the original rectangular face while weights are nonuniform.
    const weights = [1, 1.7, 2.2, 1.3, 3.1, 2.6, 2.4, 1.9, 4.2]
    const poles = Array.from({ length: 3 }, (_, i) => Array.from({ length: 3 }, (_, j) =>
      at(bounds.uMin + (bounds.uMax - bounds.uMin) * i / 2,
        bounds.vMin + (bounds.vMax - bounds.vMin) * j / 2))).flat()
    const rational: Net = {
      nu: 3, nv: 3, du: 2, dv: 2, poles, weights, rational: [1, 1],
      ku: [bounds.uMin, bounds.uMax], kv: [bounds.vMin, bounds.vMax],
      mu: [3, 3], mv: [3, 3],
    }
    expect(new Set(weights).size).toBeGreaterThan(1)
    const rationalFace = keep(k.fixShape(keep(k.fromBREP(replaceSurface(sourceText, planar, rational)))))
    expect(k.isValid(rationalFace)).toBe(true)
    const rationalized = surfaceTable(k.toBREP(rationalFace)).find(r => r.net)?.net
    expect(rationalized?.weights).toEqual(weights)
    const rationalStep = k.exportStep(rationalFace)
    const imported = keep(k.importStep(rationalStep)), importedFaces = k.getSubShapes(imported, 'face')
    owned.push(...importedFaces)
    expect(k.isValid(imported)).toBe(true)
    expect(importedFaces).toHaveLength(1)
    const importedText = k.toBREP(importedFaces[0])
    const importedNet = surfaceTable(importedText).find(r => r.net)?.net
    expect(importedNet?.rational).toEqual([1, 1])
    expect(importedNet?.weights).toEqual(expect.arrayContaining(weights))

    const originalStep = k.exportStep(rationalFace)
    editor.open(originalStep)
    const edited = structuredClone(editor.select(0))
    // Move one corner off the plane: both incident free boundary curves must
    // change, and their common endpoint must still close the new wire.
    edited.poles[0] = [edited.poles[0][0], edited.poles[0][1], edited.poles[0][2] + 2]
    const supportText = replaceSurface(k.toBREP(importedFaces[0]), surfaceTable(k.toBREP(importedFaces[0])).find(r => r.net)!, edited)
    const support = keep(k.fromBREP(supportText))
    const originalSurface = k.getSubShapes(importedFaces[0], 'face')
    owned.push(...originalSurface)
    expect(originalSurface).toHaveLength(1)
    let movedInterior = 0, movedBoundary = 0
    for (let i = 0; i <= 20; i++) for (let j = 0; j <= 20; j++) {
      const u = bounds.uMin + (bounds.uMax - bounds.uMin) * i / 20
      const v = bounds.vMin + (bounds.vMax - bounds.vMin) * j / 20
      const before = k.pointOnSurface(originalSurface[0], u, v), after = k.pointOnSurface(support, u, v)
      if (Math.hypot(before.x - after.x, before.y - after.y, before.z - after.z) > 1e-4) {
        if (i === 0 || i === 20 || j === 0 || j === 20) movedBoundary++
        else movedInterior++
      }
    }
    expect(movedBoundary).toBeGreaterThan(0)
    expect(movedInterior).toBeGreaterThan(0)
    const edge = (indices: number[], axis: 'u' | 'v') => keep(k.makeBSplineEdge(
      indices.flatMap(i => edited.poles[i]), indices.map(i => edited.weights[i]),
      axis === 'u' ? edited.ku : edited.kv, axis === 'u' ? edited.mu : edited.mv,
      axis === 'u' ? edited.du : edited.dv,
    ))
    const u0 = Array.from({ length: edited.nu }, (_, i) => i * edited.nv)
    const v1 = Array.from({ length: edited.nv }, (_, j) => (edited.nu - 1) * edited.nv + j)
    const u1 = Array.from({ length: edited.nu }, (_, i) => i * edited.nv + edited.nv - 1).reverse()
    const v0 = Array.from({ length: edited.nv }, (_, j) => j).reverse()
    const wire = keep(k.makeWire([edge(u0, 'u'), edge(v1, 'v'), edge(u1, 'u'), edge(v0, 'v')]))
    const face = keep(k.fixShape(keep(k.makeFaceOnSurface(support, wire))))
    expect(k.isValid(face)).toBe(true)
    const faces = k.getSubShapes(face, 'face')
    owned.push(...faces)
    expect(faces).toHaveLength(1)
    expect(k.isValid(faces[0])).toBe(true)

    const compareSurface = (actual: ShapeHandle) => {
      const a = k.uvBounds(support), b = k.uvBounds(actual)
      expect(b.uMin).toBeCloseTo(a.uMin, 8); expect(b.uMax).toBeCloseTo(a.uMax, 8)
      expect(b.vMin).toBeCloseTo(a.vMin, 8); expect(b.vMax).toBeCloseTo(a.vMax, 8)
      let changedBoundary = 0, maxError = 0
      for (let i = 0; i <= 20; i++) for (let j = 0; j <= 20; j++) {
        const u = a.uMin + (a.uMax - a.uMin) * i / 20
        const v = a.vMin + (a.vMax - a.vMin) * j / 20
        const p = k.pointOnSurface(support, u, v), q = k.pointOnSurface(actual, u, v)
        const error = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z)
        maxError = Math.max(maxError, error)
        if (i === 0 || i === 20 || j === 0 || j === 20) changedBoundary++
      }
      expect(changedBoundary).toBeGreaterThan(0)
      expect(maxError).toBeLessThan(1e-7)
    }
    compareSurface(faces[0])

    // Exercise the production builder too, not only the independent oracle.
    const rebuilt = keep(rebuildFreeBoundary(k, support, edited))
    expect(k.isValid(rebuilt)).toBe(true)
    compareSurface(rebuilt)
    const rebuiltNet = surfaceTable(k.toBREP(rebuilt)).find(r => r.net)?.net
    expect(rebuiltNet?.weights).toEqual(edited.weights)

    const supportRecord = surfaceTable(supportText).find(r => r.net)!
    expect(supportRecord.net?.weights).toEqual(edited.weights)
    const resultStep = k.exportStep(face), roundtrip = keep(k.importStep(resultStep)), roundtripFaces = k.getSubShapes(roundtrip, 'face')
    owned.push(...roundtripFaces)
    expect(k.isValid(roundtrip)).toBe(true)
    expect(roundtripFaces).toHaveLength(1)
    compareSurface(roundtripFaces[0])
    const roundtripNet = surfaceTable(k.toBREP(roundtripFaces[0])).find(r => r.net)?.net
    expect(roundtripNet?.rational).toEqual([1, 1])
    expect(roundtripNet?.weights).toEqual(expect.arrayContaining(edited.weights))
  } finally {
    owned.reverse().forEach(shape => k.release(shape))
    boxFaces.forEach(face => k.release(face)); k.release(box); editor.dispose()
  }
}, 60000)
