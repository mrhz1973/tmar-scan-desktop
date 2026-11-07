// SPDX-License-Identifier: AGPL-3.0-only
import { OcctKernel, type ShapeHandle, type Vec3 } from 'occt-wasm'
import { expect, it } from 'vitest'
import { replaceSurface, surfaceTable, type Net, type Point } from '../brep'
import {
  proposeExperimentalPeriodicTangency,
  validateExperimentalPeriodicTangency,
  type ExperimentalPeriodicTangencyRequest,
} from '../experimentalPeriodicTangency'

function fixture(rational = true, repeatedKnots = false): ExperimentalPeriodicTangencyRequest {
  const nu = 16, nv = 4
  const mult = repeatedKnots ? 2 : 1
  const ku = Array.from({ length: nu / mult + 1 }, (_, i) => i + (i % 2) / 4)
  const make = (selected: boolean): Net => {
    const poles: Point[] = [], weights: number[] = []
    for (let u = 0; u < nu; u++) {
      const angle = u / nu * 2 * Math.PI, x = Math.cos(angle), y = Math.sin(angle)
      for (let v = 0; v < nv; v++) {
        const distance = selected ? 3 - v : v
        const radial = selected ? 10 : 10 + distance * (0.25 + 0.125 * x)
        poles.push([radial * x, radial * y, (selected ? -1 : 1) * distance * (1 + y / 8)])
        weights.push(rational ? 1 + 0.125 * x : 1)
      }
    }
    return { nu, nv, du: mult + 1, dv: 3, ku: [...ku], mu: ku.map(() => mult), kv: selected ? [0, 4] : [7, 9], mv: [4, 4],
      poles, weights, periodic: [1, 0], rational: rational ? [1, 0] : [0, 0] }
  }
  const net = make(true), supportNet = make(false)
  // Use byte-identical coefficients for the complete natural boundary.
  for (let u = 0; u < nu; u++) net.poles[u * nv + nv - 1] = [...supportNet.poles[u * nv]]
  return { net, supportNet, edge: 'V1', supportEdge: 'V0', scale: 0.5 }
}

it.each([false, true])('proposes the seam correction on periodic polynomial/rational nets (%s)', rational => {
  const request = fixture(rational), before = structuredClone(request)
  const { net, validation } = proposeExperimentalPeriodicTangency(request)
  expect(request).toEqual(before)
  expect(net.weights).toEqual(before.net.weights)
  expect(validation.changedIndices).toEqual(Array.from({ length: net.nu }, (_, u) => u * net.nv + 2))
  expect(validation).toMatchObject({ checkedSpans: net.ku.length - 1,
    evidenceScope: 'input-coefficients-only', cadRoundTripVerified: false, globalG1Certified: false })
  expect(validation.maxNormalSinBound).toBeLessThan(1e-10)
  expect(validation.maxDerivativeResidualBound).toBeLessThan(1e-10)
  expect(validateExperimentalPeriodicTangency(request, net)).toEqual(validation)
  expect(net.poles[2]).toEqual([9.625, 0, -1])
  for (const [i, point] of net.poles.entries()) if (i % net.nv !== 2) expect(point).toEqual(before.net.poles[i])
})

it('refuses mismatched basis, changed G0, incompatible weights, locks and degenerate sides', () => {
  const request = fixture()
  const { net, validation } = proposeExperimentalPeriodicTangency(request)
  expect(() => proposeExperimentalPeriodicTangency({ ...request, scale: -1 })).toThrow(/scala/)
  expect(() => proposeExperimentalPeriodicTangency({ ...request, lockIndices: [validation.changedIndices[0]] })).toThrow(/derivate/)
  const a = structuredClone(request)
  a.supportNet.ku[1] += 0.01
  expect(() => proposeExperimentalPeriodicTangency(a)).toThrow(/basi U diverse/)
  const b = structuredClone(request)
  b.supportNet.poles[0][0] += 1e-12
  expect(() => proposeExperimentalPeriodicTangency(b)).toThrow(/bordo comune/)
  const c = structuredClone(request)
  c.supportNet.weights[1] += 1e-12
  expect(() => proposeExperimentalPeriodicTangency(c)).toThrow(/pesi variabili/)
  const d = structuredClone(request)
  for (let u = 0; u < d.net.nu; u++) d.supportNet.poles[u * d.net.nv + 1] = [...d.supportNet.poles[u * d.net.nv]]
  expect(() => proposeExperimentalPeriodicTangency(d)).toThrow(/regolarità/)
  const e = structuredClone(request)
  for (let u = 0; u < e.net.nu; u++) e.net.poles[u * e.net.nv + 2][2] *= -1
  expect(() => proposeExperimentalPeriodicTangency(e)).toThrow(/verso/)
  const tampered = structuredClone(net)
  tampered.poles[1][0] += 0.1
  expect(() => validateExperimentalPeriodicTangency(request, tampered)).toThrow(/polo protetto/)
  expect(() => validateExperimentalPeriodicTangency(request, request.net)).toThrow(/derivate/)
})

it('refuses sparse flags and coefficients in both the inputs and the result', () => {
  const request = fixture(), { net } = proposeExperimentalPeriodicTangency(request)
  const periodic = new Array<number>(2) as Net['periodic']
  expect(() => proposeExperimentalPeriodicTangency({ ...request, net: { ...request.net, periodic } })).toThrow(/reticolo/)
  expect(() => validateExperimentalPeriodicTangency(request, { ...net, periodic })).toThrow(/reticolo/)
  for (const key of ['rational', 'ku', 'kv', 'mu', 'mv', 'poles', 'weights'] as const) {
    const sparse = [...net[key]]
    delete sparse[Math.floor(sparse.length / 2)]
    expect(() => validateExperimentalPeriodicTangency(request, { ...net, [key]: sparse })).toThrow()
  }
})

it('keeps pure coefficient evidence separate from OCCT weight normalization', async () => {
  const request = fixture()
  for (const net of [request.net, request.supportNet]) {
    net.weights = net.weights.map((_, i) => 1 + Math.floor(i / net.nv) % 2 * Number.EPSILON)
  }
  const result = proposeExperimentalPeriodicTangency(request)
  expect(result.validation.cadRoundTripVerified).toBe(false)
  expect(result.net.weights).toEqual(request.net.weights)
  const k = await OcctKernel.init(), seed = k.makeCylinder(10, 5), faces = k.getSubShapes(seed, 'face')
  let replay: ShapeHandle | undefined
  try {
    const brep = k.toBREP(faces.find(h => k.surfaceType(h) === 'cylinder')!)
    replay = k.fromBREP(replaceSurface(brep, surfaceTable(brep)[0], result.net))
    const actual = surfaceTable(k.toBREP(replay)).find(record => record.periodicNet)?.periodicNet
    expect(actual?.rational).toEqual([0, 0])
    expect(actual?.weights).not.toEqual(result.net.weights)
  } finally {
    if (replay !== undefined) k.release(replay)
    faces.forEach(face => k.release(face))
    k.release(seed)
  }
}, 30000)

it.each([false, true])('independently samples OCCT at knots and across the periodic wrap (repeated knots: %s)', async repeatedKnots => {
  const k = await OcctKernel.init(), request = fixture(true, repeatedKnots), result = proposeExperimentalPeriodicTangency(request)
  const owned: ShapeHandle[] = []
  const own = (h: ShapeHandle) => { owned.push(h); return h }
  const unit = (n: Vec3) => {
    const norm = Math.hypot(n.x, n.y, n.z)
    expect(norm).toBeGreaterThan(0)
    return [n.x / norm, n.y / norm, n.z / norm]
  }
  const gap = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
  const sin = (a: number[], b: number[]) => Math.hypot(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
  const dot = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + value * b[i], 0)
  try {
    const seed = own(k.makeCylinder(10, 5)), faces = k.getSubShapes(seed, 'face').map(own)
    const brep = k.toBREP(faces.find(h => k.surfaceType(h) === 'cylinder')!), record = surfaceTable(brep)[0]
    // The seed contributes a disposable face wrapper only. We evaluate its
    // replacement supports directly, without reusing its trims as evidence.
    const build = (net: Net) => own(k.fromBREP(replaceSurface(brep, record, net)))
    const before = build(request.net), after = build(result.net), support = build(request.supportNet)
    const { ku } = request.net
    const parameters = ku.slice(0, -1).flatMap((u, i) => [u, u + 1e-7, (u + ku[i + 1]) / 2, ku[i + 1] - 1e-7])
    parameters.push(ku.at(-1)!)
    let beforeMaxSin = 0
    for (const u of parameters) {
      const supportNormal = unit(k.surfaceNormal(support, u, 7))
      const selectedNormal = unit(k.surfaceNormal(after, u, 4))
      beforeMaxSin = Math.max(beforeMaxSin, sin(unit(k.surfaceNormal(before, u, 4)), supportNormal))
      expect(sin(selectedNormal, supportNormal)).toBeLessThan(1e-10)
      expect(dot(selectedNormal, supportNormal)).toBeGreaterThan(1 - 1e-10)
      expect(gap(k.pointOnSurface(after, u, 4), k.pointOnSurface(support, u, 7))).toBeLessThan(1e-10)
      expect(gap(k.pointOnSurface(after, u, 0), k.pointOnSurface(before, u, 0))).toBeLessThan(1e-10)
      expect(gap(k.surfaceNormal(after, u, 0), k.surfaceNormal(before, u, 0))).toBeLessThan(1e-10)
    }
    for (const [face, v] of [[after, 4], [after, 0], [support, 7]] as const) {
      expect(gap(k.pointOnSurface(face, ku[0], v), k.pointOnSurface(face, ku.at(-1)!, v))).toBeLessThan(1e-10)
      expect(gap(k.surfaceNormal(face, ku[0], v), k.surfaceNormal(face, ku.at(-1)!, v))).toBeLessThan(1e-10)
    }
    expect(beforeMaxSin).toBeGreaterThan(0.25)
  } finally {
    owned.reverse().forEach(h => k.release(h))
  }
}, 30000)
