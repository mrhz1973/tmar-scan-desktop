// SPDX-License-Identifier: AGPL-3.0-only
import { OcctKernel, type ShapeHandle } from 'occt-wasm'
import { expect, it } from 'vitest'
import { replaceSurface, surfaceTable, type Net, type Point } from '../brep'
import { refineExperimentalPeriodicSurfaceU } from '../experimentalPeriodicSurfaceRefinement'
import { refineLinearPeriodicV } from '../periodic'

it('builds a common periodic U basis and replays it on two CAD cylinder supports', async () => {
  const k = await OcctKernel.init()
  const owned: ShapeHandle[] = []
  const own = (h: ShapeHandle) => { owned.push(h); return h }
  const children = (h: ShapeHandle, kind: 'face' | 'wire') => k.getSubShapes(h, kind).map(own)
  const readNet = (h: ShapeHandle) => surfaceTable(k.toBREP(h)).find(r => r.periodicNet)?.periodicNet
  const fixtures = (z: number, height: number, rows: 5 | 6) => {
    const cylinder = own(k.makeCylinder(10, height))
    const body = own(k.generalTransform(cylinder, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, z]))
    const brep = k.toBREP(body)
    const record = surfaceTable(brep).find(r => r.periodicNet)!
    const net = refineLinearPeriodicV(record.periodicNet!, rows)
    const replay = (candidate: Net) => {
      const solid = own(k.fromBREP(replaceSurface(brep, record, candidate)))
      expect(k.isValid(solid)).toBe(true)
      const faces = children(solid, 'face')
      const side = faces.find(face => readNet(face))!
      expect(faces).toHaveLength(3)
      expect(k.isValid(side)).toBe(true)
      expect(k.subShapeCount(side, 'edge')).toBe(3)
      const wires = children(side, 'wire')
      expect(wires).toHaveLength(1)
      const uses = k.iterShapes(wires[0]).map(own)
      expect(uses).toHaveLength(4)
      const seam = uses.filter(a => uses.filter(b => k.isSame(a, b)).length === 2)
      expect(seam.map(edge => k.shapeOrientation(edge)).sort()).toEqual(['forward', 'reversed'])
      return side
    }
    return { net, replay }
  }
  const curveInsertion = (net: Net, u: number, count: number): Net => {
    const rows = Array.from({ length: net.nv }, (_, v) => {
      const indices = Array.from({ length: net.nu }, (_, i) => i * net.nv + v)
      const edge = own(k.makeBSplineEdge(indices.flatMap(i => net.poles[i]),
        indices.map(i => net.weights[i]), net.ku, net.mu, net.du, true))
      return k.getNurbsCurveData(own(k.curveKnotInsert(edge, u, count)))
    })
    const { knots, multiplicities } = rows[0]
    const nu = rows[0].poles.length / 3
    return { ...net, nu, ku: knots, mu: multiplicities,
      poles: Array.from({ length: nu }, (_, u) => rows.map(row => row.poles.slice(3 * u, 3 * u + 3) as Point)).flat(),
      weights: Array.from({ length: nu }, (_, u) => rows.map(row => row.weights[u])).flat() }
  }
  try {
    const a = fixtures(0, 12, 5), b = fixtures(12, 15, 6)
    expect(a.net.periodic).toEqual([1, 0])
    expect(a.net.weights.some(w => w !== 1)).toBe(true)
    const x = (a.net.ku[0] + a.net.ku[1]) / 2
    const y = (a.net.ku[1] + a.net.ku[2]) / 2
    // Give the left a knot absent from the right so both refinement paths run.
    const z = (a.net.ku[2] + a.net.ku[3]) / 2
    const source = a.replay(curveInsertion(curveInsertion(a.net, x, 1), z, 1))
    const sourceRight = b.replay(curveInsertion(curveInsertion(b.net, x, 2), y, 1))
    const left = readNet(source)!, right = readNet(sourceRight)!
    expect(left.nv).not.toBe(right.nv)
    expect(left.kv.at(-1)).not.toBe(right.kv.at(-1))
    const snapshots = structuredClone([left, right])
    const originalBrep = [k.toBREP(source), k.toBREP(sourceRight)]
    const common = refineExperimentalPeriodicSurfaceU(k, left, right)
    expect(common.left.ku).toEqual(common.right.ku)
    expect(common.left.mu).toEqual(common.right.mu)
    expect(common.left.ku).toHaveLength(a.net.ku.length + 3)
    expect(common.left.mu[common.left.ku.indexOf(x)]).toBe(2)
    expect(common.left.mu[common.left.ku.indexOf(y)]).toBe(1)
    expect(common.left.mu[common.left.ku.indexOf(z)]).toBe(1)
    expect(common.left.nu).toBe(a.net.nu + 4)
    const rebuilt = [a.replay(common.left), b.replay(common.right)]
    let maxGap = 0, maxSeamGap = 0
    const uValues = common.left.ku.flatMap((u, i, knots) =>
      i === knots.length - 1 ? [u] : [u, ...[0.125, 0.5, 0.875].map(t => u + (knots[i + 1] - u) * t)])
    for (const [before, after, initial, refined] of [
      [source, rebuilt[0], left, common.left], [sourceRight, rebuilt[1], right, common.right],
    ] as const) {
      expect(refined).toMatchObject({ periodic: initial.periodic, rational: initial.rational, du: initial.du,
        dv: initial.dv, nv: initial.nv, kv: initial.kv, mv: initial.mv })
      const readback = readNet(after)!
      expect(readback).toMatchObject({ nu: refined.nu, nv: refined.nv, du: refined.du, dv: refined.dv,
        ku: refined.ku, mu: refined.mu, kv: refined.kv, mv: refined.mv,
        periodic: refined.periodic, rational: refined.rational })
      expect(readback.weights).toHaveLength(refined.weights.length)
      expect(readback.poles).toHaveLength(refined.poles.length)
      readback.weights.forEach((w, i) => expect(w).toBeCloseTo(refined.weights[i], 14))
      readback.poles.forEach((p, i) => p.forEach((x, d) => expect(x).toBeCloseTo(refined.poles[i][d], 12)))
      const bounds = k.uvBounds(before)
      expect(k.uvBounds(after)).toEqual(bounds)
      const { uMin, uMax, vMin, vMax } = bounds
      for (const f of [0, 0.125, 0.25, 0.5, 0.75, 0.875, 1]) {
        const v = vMin + (vMax - vMin) * f
        for (const u of uValues) {
          const p = k.pointOnSurface(before, u, v), q = k.pointOnSurface(after, u, v)
          maxGap = Math.max(maxGap, Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z))
        }
        const p = k.pointOnSurface(after, uMin, v), q = k.pointOnSurface(after, uMax, v)
        maxSeamGap = Math.max(maxSeamGap, Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z))
      }
    }
    expect(maxGap).toBeLessThan(1e-8)
    expect(maxSeamGap).toBeLessThan(1e-8)
    expect([left, right]).toEqual(snapshots)
    expect([k.toBREP(source), k.toBREP(sourceRight)]).toEqual(originalBrep)

    // Check coefficient bookkeeping only. A polynomial U curve can carry a
    // nonunit factor for its V row. This artificial net is not replayed as a
    // CAD face and provides no evidence about OCCT's surface rational flags.
    const withRowWeights = { ...left, weights: left.weights.map((_, i) => 1 + i % left.nv) }
    const constant = refineExperimentalPeriodicSurfaceU(k, withRowWeights, right).left
    expect(constant.weights).toEqual(Array.from({ length: constant.nu }, () =>
      Array.from({ length: constant.nv }, (_, v) => 1 + v)).flat())

    expect(() => refineExperimentalPeriodicSurfaceU(k, left, { ...right, ku: right.ku.map(u => u + 1) }))
      .toThrow('intervallo')
    const near = { ...right, ku: right.ku.map(u => u === x ? u + 1e-12 : u) }
    expect(() => refineExperimentalPeriodicSurfaceU(k, left, near)).toThrow('base richiesta')
  } finally {
    owned.reverse().forEach(h => k.release(h))
    k[Symbol.dispose]()
  }
}, 60_000)

const sparseInputs = ['periodic', 'rational', 'poles', 'weights', 'ku', 'kv', 'mu', 'mv', 'coordinate'] as const
it.each(sparseInputs)('rejects a hole in %s before calling OCCT', field => {
  const valid: Net = {
    nu: 4, nv: 3, du: 2, dv: 1, periodic: [1, 0], rational: [0, 0],
    ku: [0, 1, 2, 3, 4], mu: [1, 1, 1, 1, 1], kv: [0, 1, 2], mv: [2, 1, 2],
    poles: Array.from({ length: 12 }, (_, i) => [i, i % 3, 0]), weights: Array(12).fill(1),
  }
  const malformed = structuredClone(valid)
  Reflect.deleteProperty(field === 'coordinate' ? malformed.poles[0] : malformed[field]!, 1)
  const unusedKernel = {} as OcctKernel
  expect(() => refineExperimentalPeriodicSurfaceU(unusedKernel, valid, malformed))
    .toThrow('reticolo U periodico o V clamped non valido')
})

it('refuses short periodic U pole cycles even when OCCT reads the supports', async () => {
  const k = await OcctKernel.init()
  const owned: ShapeHandle[] = []
  const own = (h: ShapeHandle) => { owned.push(h); return h }
  try {
    const cylinder = own(k.makeCylinder(10, 12))
    const converted = own(k.generalTransform(cylinder, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]))
    const side = k.getSubShapes(converted, 'face').map(own).find(face =>
      surfaceTable(k.toBREP(face)).some(record => record.periodicNet))!
    const template = k.toBREP(side)
    const record = surfaceTable(template).find(record => record.periodicNet)!
    const readFixture = (ku: number[]) => {
      const base = record.periodicNet!
      const nu = ku.length - 1
      const candidate: Net = { ...base, du: 4, nu, ku, mu: ku.map(() => 1), rational: [0, 0],
        poles: Array.from({ length: nu * base.nv }, (_, i) => [Math.cos(i), Math.sin(i), i % 2]),
        weights: Array(nu * base.nv).fill(1) }
      // This replaces the support only. The template wire does not qualify
      // the two-pole surface as a valid trimmed face.
      const face = own(k.fromBREP(replaceSurface(template, record, candidate)))
      expect(k.isFace(face)).toBe(true)
      const net = surfaceTable(k.toBREP(face)).find(record => record.periodicNet)!.periodicNet!
      expect(net).toMatchObject({ periodic: [1, 0], du: 4, nu, ku, mu: candidate.mu })
      const point = k.pointOnSurface(face, 1, (net.kv[0] + net.kv.at(-1)!) / 2)
      expect([point.x, point.y, point.z].every(Number.isFinite)).toBe(true)
      return net
    }
    const left = readFixture([0, 3, 6])
    const right = readFixture([0, 0.5, 3, 6])
    expect(() => refineExperimentalPeriodicSurfaceU(k, left, right)).toThrow('il numero di poli U deve superare il grado U')
    const atDegree = readFixture([0, 0.5, 1.5, 3, 6])
    expect(() => refineExperimentalPeriodicSurfaceU(k, atDegree, atDegree)).toThrow('il numero di poli U deve superare il grado U')
  } finally {
    owned.reverse().forEach(h => k.release(h))
    k[Symbol.dispose]()
  }
}, 60_000)
