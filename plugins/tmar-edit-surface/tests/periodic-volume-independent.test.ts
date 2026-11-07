// SPDX-License-Identifier: AGPL-3.0-only
import { OcctKernel, type Mesh, type ShapeHandle } from 'occt-wasm'
import { expect, it } from 'vitest'
import { replaceSurface } from '../brep'
import { exclusiveFaceSurface } from '../exclusiveSurface'
import { refineLinearPeriodicV } from '../periodic'

function meshVolume(mesh: Mesh, centerZ: number) {
  const { positions, indices } = mesh
  const vertices = new Map<string, number>()
  const vertexIds = Array.from({ length: mesh.vertexCount }, (_, i) => {
    // BRepMesh returns per-face Float32 positions. Identify duplicate rim
    // and seam vertices on a 10 nm grid for the incidence check only.
    const offset = i * 3
    const key = [0, 1, 2].map(j => Math.round(positions[offset + j] * 1e5)).join(',')
    const existing = vertices.get(key)
    if (existing !== undefined) return existing
    const id = vertices.size
    vertices.set(key, id)
    return id
  })
  const edges = new Map<string, { count: number; orientation: number }>()
  const recordEdge = (a: number, b: number) => {
    const key = `${Math.min(a, b)},${Math.max(a, b)}`
    const edge = edges.get(key) ?? { count: 0, orientation: 0 }
    edge.count++
    edge.orientation += a < b ? 1 : -1
    edges.set(key, edge)
  }

  let sixTimesVolume = 0
  let degenerateTriangles = 0
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]]
    const [va, vb, vc] = [vertexIds[a], vertexIds[b], vertexIds[c]]
    if (va === vb || vb === vc || vc === va) degenerateTriangles++
    recordEdge(va, vb)
    recordEdge(vb, vc)
    recordEdge(vc, va)
    const [ax, ay, az] = [positions[3 * a], positions[3 * a + 1], positions[3 * a + 2] - centerZ]
    const [bx, by, bz] = [positions[3 * b], positions[3 * b + 1], positions[3 * b + 2] - centerZ]
    const [cx, cy, cz] = [positions[3 * c], positions[3 * c + 1], positions[3 * c + 2] - centerZ]
    // Signed tetrahedron with its fourth vertex at the cylinder center.
    sixTimesVolume += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)
  }
  return {
    volumeMm3: sixTimesVolume / 6,
    triangles: mesh.triangleCount,
    degenerateTriangles,
    unpairedEdges: Array.from(edges.values()).filter(edge => edge.count !== 2 || edge.orientation !== 0).length,
  }
}

it('checks periodic cylinder volume against converging triangle sums and the analytic cylinder', async () => {
  const k = await OcctKernel.init()
  const radius = 10, height = 20
  const analyticMm3 = Math.PI * radius ** 2 * height
  const handles: ShapeHandle[] = []
  const keep = (shape: ShapeHandle) => { handles.push(shape); return shape }
  try {
    const primitive = keep(k.makeCylinder(radius, height))
    const source = keep(k.importStep(k.exportStep(primitive)))
    const sourceFaces = k.getSubShapes(source, 'face').map(keep)
    const index = sourceFaces.findIndex(face => k.surfaceType(face) === 'cylinder')
    expect(index).toBeGreaterThanOrEqual(0)
    const converted = keep(k.generalTransform(source, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]))
    const convertedFaces = k.getSubShapes(converted, 'face').map(keep)
    const brep = k.toBREP(converted)
    const record = exclusiveFaceSurface(brep, k.toBREP(convertedFaces[index]), convertedFaces.length)
    const net = record.periodicNet
    if (!net) throw new Error('Expected a periodic cylindrical side')
    expect(net.periodic).toEqual([1, 0])
    expect(net.nv).toBe(2)

    const variants = [
      { name: 'STEP source', shape: source },
      { name: 'converted', shape: converted },
      { name: 'unchanged BREP replay', shape: keep(k.fromBREP(brep)) },
      ...([5, 6, 9] as const).map(poles => ({
        name: `refined to ${poles} V poles`,
        shape: keep(k.fromBREP(replaceSurface(brep, record, refineLinearPeriodicV(net, poles)))),
      })),
    ]
    const report = variants.map(({ name, shape }) => {
      expect(k.isValid(shape), name).toBe(true)
      const occtVolumeMm3 = k.getVolume(shape)
      const serialized = k.toBREP(shape)
      const samples = [0.1, 0.025, 0.00625, 0.0015625].map(linearDeflection => {
        const angularDeflection = 0.2 * Math.sqrt(linearDeflection / 0.1)
        // Each resolution starts with a fresh shape so the tessellator cannot
        // reuse a mesh generated at a different deflection.
        const copy = k.fromBREP(serialized)
        try {
          const measured = meshVolume(k.tessellate(copy, { linearDeflection, angularDeflection }), height / 2)
          return { linearDeflection, angularDeflection, ...measured, absoluteErrorMm3: Math.abs(measured.volumeMm3 - analyticMm3) }
        } finally { k.release(copy) }
      })
      return { name, occtVolumeMm3, occtErrorMm3: occtVolumeMm3 - analyticMm3, samples }
    })

    console.info({ analyticMm3 })
    console.table(report.flatMap(({ name, occtVolumeMm3, occtErrorMm3, samples }) =>
      samples.map(sample => ({ name, occtVolumeMm3, occtErrorMm3, ...sample }))))
    for (const { name, samples } of report) {
      for (const [i, sample] of samples.entries()) {
        expect(sample.degenerateTriangles, name).toBe(0)
        expect(sample.unpairedEdges, name).toBe(0)
        expect(sample.volumeMm3, name).toBeGreaterThan(0)
        if (i > 0) {
          expect(sample.triangles, name).toBeGreaterThan(samples[i - 1].triangles)
          expect(sample.absoluteErrorMm3, name).toBeLessThan(samples[i - 1].absoluteErrorMm3 / 2)
        }
      }
      // Fixture-level diagnostic bound (0.008% of the analytic volume).
      expect(samples.at(-1)!.absoluteErrorMm3, name).toBeLessThan(0.5)
    }
  } finally {
    handles.reverse().forEach(handle => k.release(handle))
    k[Symbol.dispose]()
  }
}, 60000)
