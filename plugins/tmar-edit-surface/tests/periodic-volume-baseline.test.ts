// SPDX-License-Identifier: AGPL-3.0-only
import type { OcctKernel, ShapeHandle } from 'occt-wasm'
import { expect, it } from 'vitest'
import { replaceSurface } from '../brep'
import { assertToleranceDistribution, prepareCylinder } from '../cylinderPreparation'
import { auditCylinderSeam } from '../cylinderSeam'
import { assertMatchedCylinderTolerances } from '../cylinderTolerance'
import { SurfaceEditorKernel } from '../editorKernel'
import { exclusiveFaceSurface } from '../exclusiveSurface'
import { refineLinearPeriodicV } from '../periodic'

function topology(k: OcctKernel, shape: ShapeHandle) {
  const kinds = ['solid', 'shell', 'face', 'wire', 'edge', 'vertex'] as const
  return Object.fromEntries(kinds.map(kind => {
    const handles = k.getSubShapes(shape, kind)
    try { return [kind, handles.length] }
    finally { handles.forEach(handle => k.release(handle)) }
  }))
}

it('isolates OCCT volume readings for an unchanged BREP replay and periodic V refinement', async () => {
  const editor = await SurfaceEditorKernel.load()
  const k = editor.kernel
  const radius = 10, height = 20
  const analytic = Math.PI * radius ** 2 * height
  const handles: ShapeHandle[] = []
  const keep = (shape: ShapeHandle) => { handles.push(shape); return shape }
  try {
    const primitive = keep(k.makeCylinder(radius, height))
    const source = keep(k.importStep(k.exportStep(primitive)))
    const sourceFaces = k.getSubShapes(source, 'face').map(keep)
    const index = sourceFaces.findIndex(face => k.surfaceType(face) === 'cylinder')
    expect(index).toBeGreaterThanOrEqual(0)
    const sourceBrep = k.toBREP(source)
    const prepared = prepareCylinder(k, source, index)

    const converted = keep(k.generalTransform(source, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]))
    const convertedFaces = k.getSubShapes(converted, 'face').map(keep)
    const side = convertedFaces[index]
    const brep = k.toBREP(converted)
    const record = exclusiveFaceSurface(brep, k.toBREP(side), convertedFaces.length)
    expect(record.periodicNet?.periodic).toEqual([1, 0])
    const net = record.periodicNet!
    expect(net.nv).toBe(2)
    const refinedBrep = replaceSurface(brep, record, refineLinearPeriodicV(net, 9))
    expect(refinedBrep).toBe(prepared.brep)

    const baseline = k.getVolume(converted)
    const sourceTopology = topology(k, source)
    expect(sourceTopology).toEqual({ solid: 1, shell: 1, face: 3, wire: 3, edge: 3, vertex: 2 })
    const bounds = k.uvBounds(side)
    const variants = [
      { name: 'converted', shape: converted },
      { name: 'unchanged BREP replay', shape: keep(k.fromBREP(brep)) },
      { name: 'refined to 5 V poles', shape: keep(k.fromBREP(replaceSurface(brep, record, refineLinearPeriodicV(net, 5)))) },
      { name: 'refined to 6 V poles', shape: keep(k.fromBREP(replaceSurface(brep, record, refineLinearPeriodicV(net, 6)))) },
      { name: 'refined to 9 V poles', shape: keep(k.fromBREP(refinedBrep)) },
    ]
    const report = variants.map(({ name, shape }) => {
      expect(k.isValid(shape), name).toBe(true)
      expect(topology(k, shape), name).toEqual(sourceTopology)
      assertToleranceDistribution(sourceBrep, k.toBREP(shape))
      assertMatchedCylinderTolerances(k, source, shape)
      const faces = k.getSubShapes(shape, 'face').map(keep)
      auditCylinderSeam(k, faces[index])
      expect(faces.map(face => k.shapeOrientation(face)), name).toEqual(sourceFaces.map(face => k.shapeOrientation(face)))

      let maxSupportGapMm = 0
      for (let i = 0; i <= 32; i++) for (let j = 0; j <= 16; j++) {
        const u = bounds.uMin + (bounds.uMax - bounds.uMin) * i / 32
        const v = bounds.vMin + (bounds.vMax - bounds.vMin) * j / 16
        const a = k.pointOnSurface(side, u, v), b = k.pointOnSurface(faces[index], u, v)
        maxSupportGapMm = Math.max(maxSupportGapMm, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z))
      }
      expect(maxSupportGapMm, name).toBeLessThan(1e-8)
      const volumeMm3 = k.getVolume(shape)
      expect(Number.isFinite(volumeMm3) && volumeMm3 > 0, name).toBe(true)
      return { name, volumeMm3, deltaFromConvertedMm3: volumeMm3 - baseline, deltaFromAnalyticMm3: volumeMm3 - analytic, maxSupportGapMm }
    })

    console.info(JSON.stringify({ analyticMm3: analytic, sourceMm3: prepared.sourceVolume, topology: sourceTopology, report }, null, 2))
    expect(prepared.sourceVolume).toBeCloseTo(analytic, 5)
    expect(Math.abs(report[1].deltaFromConvertedMm3)).toBeLessThan(baseline * 1e-8)
    expect(prepared.preparedVolume).toEqual(report[4].volumeMm3)
    expect(k.toBREP(source)).toBe(sourceBrep)
    expect(k.toBREP(converted)).toBe(brep)
  } finally {
    handles.reverse().forEach(handle => k.release(handle))
    editor.dispose()
  }
}, 60000)
