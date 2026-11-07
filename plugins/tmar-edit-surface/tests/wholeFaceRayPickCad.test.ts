// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it, vi } from 'vitest'
import { queryWholeFaceRayPickCad } from '../wholeFaceRayPickCad'
import type { OcctKernel, ShapeHandle } from 'occt-wasm'
import { replaceSurface, surfaceTable, type Net, type Point } from '../brep'
import { SurfaceEditorKernel } from '../editorKernel'

function fakeKernel(hits: Point[]) {
  const section = {} as ShapeHandle
  const line = {} as ShapeHandle
  const vertices = hits.map(point => ({ point } as unknown as ShapeHandle))
  const kernel = {
    makeLineEdge: vi.fn(() => line),
    section: vi.fn(() => section),
    getSubShapes: vi.fn((_shape: ShapeHandle, type: 'edge' | 'vertex') => type === 'edge' ? [] : vertices),
    vertexPosition: vi.fn((vertex: ShapeHandle) => {
      const p = (vertex as unknown as { point: Point }).point
      return { x: p[0], y: p[1], z: p[2] }
    }),
    uvFromPoint: vi.fn((_face: ShapeHandle, p: { x: number; y: number; z: number }) => ({ u: p.x, v: p.y })),
    uvBounds: vi.fn(() => ({ uMin: -100, uMax: 100, vMin: -100, vMax: 100 })),
    classifyPointOnFace: vi.fn(() => 'in'),
    pointOnSurface: vi.fn((_face: ShapeHandle, u: number, v: number) => ({ x: u, y: v, z: 0 })),
    shapeOrientation: vi.fn(() => 'forward'),
    surfaceNormal: vi.fn(() => ({ x: 0, y: 0, z: 1 })),
    release: vi.fn(),
  }
  return { kernel: kernel as unknown as OcctKernel, line, section, vertices }
}

it('returns exact UV and normalized CAD normal for one transverse ray hit', () => {
  const hit: Point = [2, 3, 0], fake = fakeKernel([hit])
  const result = queryWholeFaceRayPickCad(fake.kernel, {} as ShapeHandle, {
    seed: [2, 3, .05], origin: [2, 3, 10], direction: [0, 0, -1],
  })
  expect(result).toMatchObject({ point: hit, u: 2, v: 3, normal: [0, 0, 1], intersectionCount: 1 })
  expect(result.seedDistanceMm).toBeCloseTo(.05)
  expect(fake.kernel.section).toHaveBeenCalledWith(expect.anything(), fake.line)
  expect(fake.kernel.release).toHaveBeenCalledWith(fake.section)
})

it('fails closed when the ray misses the face or intersects it more than once', () => {
  const base = { seed: [0, 0, .05] as Point, origin: [0, 0, 10] as Point, direction: [0, 0, -1] as Point }
  expect(() => queryWholeFaceRayPickCad(fakeKernel([]).kernel, {} as ShapeHandle, base)).toThrow(/un solo punto/)
  const fake = fakeKernel([[0, 0, 0], [0, 0, -.01]])
  expect(() => queryWholeFaceRayPickCad(fake.kernel, {} as ShapeHandle, base))
    .toThrow(/un solo punto/)
  for (const shape of [fake.line, fake.section, ...fake.vertices]) expect(fake.kernel.release).toHaveBeenCalledWith(shape)
})

it('rejects a grazing CAD normal even when the ray has one exact hit', () => {
  const direction: Point = [.998749217771909, 0, -.05]
  const depth = 20, hit: Point = [direction[0] * depth, 0, 0]
  const fake = fakeKernel([hit])
  expect(() => queryWholeFaceRayPickCad(fake.kernel, {} as ShapeHandle, {
    seed: hit, origin: [0, 0, 1], direction,
  })).toThrow(/radente/)
})

function foldedNurbsFace(k: Awaited<ReturnType<typeof SurfaceEditorKernel.load>>['kernel'], owned: ShapeHandle[]) {
  const own = (shape: ShapeHandle) => { owned.push(shape); return shape }
  const corners: Point[] = [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]]
  const seedEdges = corners.map((a, i) => own(k.makeLineEdge(
    { x: a[0], y: a[1], z: a[2] },
    { x: corners[(i + 1) % corners.length][0], y: corners[(i + 1) % corners.length][1], z: corners[(i + 1) % corners.length][2] },
  )))
  const seedWire = own(k.makeWire(seedEdges)), seed = own(k.makeFace(seedWire)), text = k.toBREP(seed)
  const record = surfaceTable(text).find(item => item.kind === 1)!, bounds = k.uvBounds(seed)
  const x = [0, 4, -4, 0], z = [0, 0, 10, 10], y = [0, 10 / 3, 20 / 3, 10]
  const poles: Point[] = []
  for (let u = 0; u < 4; u++) for (let v = 0; v < 4; v++) poles.push([x[u], y[v], z[u]])
  const net: Net = { nu: 4, nv: 4, du: 3, dv: 3, poles, weights: poles.map(() => 1), rational: [0, 0],
    ku: [bounds.uMin, bounds.uMax], mu: [4, 4], kv: [bounds.vMin, bounds.vMax], mv: [4, 4] }
  const support = own(k.fromBREP(replaceSurface(text, record, net)))
  const line = (a: Point, b: Point) => own(k.makeLineEdge({ x: a[0], y: a[1], z: a[2] }, { x: b[0], y: b[1], z: b[2] }))
  const u0 = line(poles[0], poles[3])
  const v1 = own(k.makeBSplineEdge([3, 7, 11, 15].flatMap(i => poles[i]), [1, 1, 1, 1], net.ku, net.mu, 3))
  const u1 = line(poles[15], poles[12])
  const v0 = own(k.makeBSplineEdge([12, 8, 4, 0].flatMap(i => poles[i]), [1, 1, 1, 1], net.ku, net.mu, 3))
  const wire = own(k.makeWire([u0, v1, u1, v0]))
  return own(k.fixShape(own(k.makeFaceOnSurface(support, wire))))
}

it('resolves a real curved NURBS face and rejects a real ray that misses it', async () => {
  const editor = await SurfaceEditorKernel.load(), k = editor.kernel, owned: ShapeHandle[] = []
  try {
    const face = foldedNurbsFace(k, owned)
    expect(k.isValid(face)).toBe(true)
    const bounds = k.uvBounds(face), u = bounds.uMin + .37 * (bounds.uMax - bounds.uMin), v = (bounds.vMin + bounds.vMax) / 2
    const p = k.pointOnSurface(face, u, v), raw = k.surfaceNormal(face, u, v), length = Math.hypot(raw.x, raw.y, raw.z)
    const direction: Point = [-raw.x / length, -raw.y / length, -raw.z / length]
    const origin: Point = [p.x - direction[0] * 20, p.y - direction[1] * 20, p.z - direction[2] * 20]
    const result = queryWholeFaceRayPickCad(k, face, { seed: [p.x, p.y, p.z], origin, direction })
    expect(result.u).toBeCloseTo(u, 7)
    expect(result.v).toBeCloseTo(v, 7)
    expect(result.point[0]).toBeCloseTo(p.x, 7)
    expect(result.point[1]).toBeCloseTo(p.y, 7)
    expect(result.point[2]).toBeCloseTo(p.z, 7)
    expect(Math.hypot(result.normal[0] - raw.x / length, result.normal[1] - raw.y / length,
      result.normal[2] - raw.z / length)).toBeLessThan(1e-7)

    expect(() => queryWholeFaceRayPickCad(k, face, {
      seed: [100, 5, 0], origin: [100, 5, 20], direction: [0, 0, -1],
    })).toThrow(/un solo punto/)
  } finally {
    owned.reverse().forEach(shape => k.release(shape))
    editor.dispose()
  }
}, 30000)

it('rejects a ray that crosses one folded natural face twice', async () => {
  const editor = await SurfaceEditorKernel.load(), k = editor.kernel, owned: ShapeHandle[] = []
  try {
    const face = foldedNurbsFace(k, owned)
    expect(k.isValid(face)).toBe(true)
    const rayX = 1, rayY = 5, origin: Point = [rayX, rayY, 20], direction: Point = [0, 0, -1]
    // Cubic x(t)=12t(1-t)(1-2t) has two roots for x=1 before t=.5.
    // Use the nearer branch as the visible tessellation seed.
    const xAt = (t: number) => 12 * t * (1 - t) * (1 - 2 * t)
    let lo = 0, hi = .2
    for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (xAt(mid) < rayX) lo = mid; else hi = mid }
    const u = (lo + hi) / 2, b = k.uvBounds(face), v = (b.vMin + b.vMax) / 2
    const seed = k.pointOnSurface(face, b.uMin + (b.uMax - b.uMin) * u, v)
    expect(seed.x).toBeCloseTo(rayX, 7)
    expect(seed.y).toBeCloseTo(rayY, 7)
    expect(() => queryWholeFaceRayPickCad(k, face, { seed: [seed.x, seed.y, seed.z], origin, direction }))
      .toThrow(/un solo punto/)
  } finally {
    owned.reverse().forEach(shape => k.release(shape))
    editor.dispose()
  }
}, 30000)

it('binds a native pick to the current validated face and rejects an obsolete preview revision', async () => {
  const editor = await SurfaceEditorKernel.load(), k = editor.kernel
  const owned: ShapeHandle[] = []
  const keep = (shape: ShapeHandle) => { owned.push(shape); return shape }
  try {
    const box = keep(k.makeBox(12, 10, 8)), sourceFaces = k.getSubShapes(box, 'face')
    owned.push(...sourceFaces)
    editor.open(k.exportStep(sourceFaces[5]))
    const net = editor.select(0), first = editor.evaluate(net, 'G1', false, true)
    const b = k.uvBounds(sourceFaces[5]), u = (b.uMin + b.uMax) / 2, v = (b.vMin + b.vMax) / 2
    const p = k.pointOnSurface(sourceFaces[5], u, v), n = k.surfaceNormal(sourceFaces[5], u, v)
    const length = Math.hypot(n.x, n.y, n.z), direction: Point = [-n.x / length, -n.y / length, -n.z / length]
    const origin: Point = [p.x + direction[0] * -10, p.y + direction[1] * -10, p.z + direction[2] * -10]
    const firstPick = editor.pickWholeFaceFromRay(first.previewRevision!, {
      seed: [p.x, p.y, p.z], origin, direction,
    })
    expect(firstPick).toMatchObject({ face: 0, previewRevision: first.previewRevision })
    expect(firstPick.u).toBeCloseTo(u, 10)
    expect(firstPick.v).toBeCloseTo(v, 10)
    expect(firstPick.selectionRevision).toBeGreaterThan(0)
    expect(Math.hypot(firstPick.normal[0] - n.x / length, firstPick.normal[1] - n.y / length,
      firstPick.normal[2] - n.z / length)).toBeLessThan(1e-8)

    const next = editor.evaluate(net, 'G1', false, true)
    expect(next.previewRevision).toBeGreaterThan(first.previewRevision!)
    expect(() => editor.pickWholeFaceFromRay(first.previewRevision!, {
      seed: [p.x, p.y, p.z], origin, direction,
    })).toThrow(/Anteprima cambiata/)
  } finally {
    owned.reverse().forEach(shape => k.release(shape))
    editor.dispose()
  }
}, 30000)
