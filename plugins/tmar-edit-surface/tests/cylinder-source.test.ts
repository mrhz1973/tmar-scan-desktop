// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it, vi } from 'vitest'
import { SurfaceEditorKernel } from '../editorKernel'
import { assertSimpleCylinderSource } from '../cylinderSource'
import type { OcctKernel, ShapeHandle } from 'occt-wasm'

it('releases already acquired handles when a later topology read fails', () => {
  const release = vi.fn(), handle = {} as ShapeHandle
  const k = { isValid: () => true, getSubShapes: vi.fn().mockReturnValueOnce([handle]).mockImplementationOnce(() => { throw new Error('read failed') }), release } as unknown as OcctKernel
  expect(() => assertSimpleCylinderSource(k, handle, handle)).toThrow('read failed')
  expect(release).toHaveBeenCalledExactlyOnceWith(handle)
})

it.each([false, true])('accepts only the side of a simple STEP cylinder (transformed: %s)', async transformed => {
  const e = await SurfaceEditorKernel.load(), k = e.kernel, cylinder = k.makeCylinder(10, 20)
  const rotated = transformed ? k.rotate(cylinder, { point: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 1, z: 0 } }, .73) : null
  const positioned = rotated ? k.translate(rotated, 7, -11, 4) : null
  const step = k.exportStep(positioned ?? cylinder), source = k.importStep(step), faces = k.getSubShapes(source, 'face')
  try {
    const before = k.toBREP(source), side = faces.find(f => k.surfaceType(f) === 'cylinder')!
    expect(side).toBeDefined()
    expect(() => assertSimpleCylinderSource(k, source, side)).not.toThrow()
    expect(() => assertSimpleCylinderSource(k, source, faces.find(f => k.surfaceType(f) === 'plane')!)).toThrow()
    expect(k.toBREP(source)).toBe(before)
  } finally { faces.forEach(f => k.release(f)); k.release(source); if (positioned) k.release(positioned); if (rotated) k.release(rotated); k.release(cylinder); e.dispose() }
}, 60000)

it('rejects a box and a cylinder trimmed by a cut', async () => {
  const e = await SurfaceEditorKernel.load(), k = e.kernel
  const cylinder = k.makeCylinder(10, 20), tool = k.makeBox(12, 30, 30), moved = k.translate(tool, 0, -15, -5)
  const cut = k.cut(cylinder, moved), cutStep = k.importStep(k.exportStep(cut))
  const box = k.makeBox(5, 5, 5), boxFaces = k.getSubShapes(box, 'face'), faces = k.getSubShapes(cutStep, 'face')
  try {
    expect(k.isValid(cutStep)).toBe(true)
    const side = faces.find(f => k.surfaceType(f) === 'cylinder')!
    expect(side).toBeDefined()
    expect(() => assertSimpleCylinderSource(k, cutStep, side)).toThrow()
    expect(() => assertSimpleCylinderSource(k, box, boxFaces[0])).toThrow()
  } finally { [...faces, ...boxFaces].forEach(f => k.release(f)); [box, cutStep, cut, moved, tool, cylinder].forEach(h => k.release(h)); e.dispose() }
}, 60000)
