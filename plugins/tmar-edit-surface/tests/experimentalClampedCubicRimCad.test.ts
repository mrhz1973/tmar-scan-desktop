// SPDX-License-Identifier: AGPL-3.0-only
import { OcctKernel, type NurbsCurveData, type ShapeHandle } from 'occt-wasm'
import { expect, it } from 'vitest'
import { signature, surfaceTable, type Net, type Point } from '../brep'
import { exclusiveFaceSurface } from '../exclusiveSurface'
import { clampExperimentalPolynomialBSpline } from '../experimentalClampedBSplineTrim'
import { makeExperimentalNaturalPeriodicFixtureSide, type ExperimentalPreservedFixtureRim } from './experimentalPeriodicClosedSolid.fixture'

const ring: Point[] = [[10, 0, 0], [10, 5, 0], [5, 10, 0], [0, 10, 0], [-5, 10, 0], [-10, 5, 0],
  [-10, 0, 0], [-10, -5, 0], [-5, -10, 0], [0, -10, 0], [5, -10, 0], [10, -5, 0]]
const activeRange = [-2, 10] as const

function band(below: boolean): Net {
  const ku = [0, 1, 2, 3, 4].map(u => below ? -2 + 3 * u : u)
  const poles = ring.flatMap(([x, y]) => Array.from({ length: 6 }, (_, v): Point => [x, y, v - (below ? 5 : 0)]))
  return { du: 3, dv: 5, nu: 12, nv: 6, ku, mu: Array(5).fill(3), kv: below ? [-5, 0] : [0, 5], mv: [6, 6],
    poles, weights: poles.map(() => 1), rational: [0, 0], periodic: [1, 0] }
}

function inspectSharedRim(k: OcctKernel, shape: ShapeHandle, own: (shape: ShapeHandle) => ShapeHandle) {
  expect(k.isValid(shape)).toBe(true)
  const faces = k.getSubShapes(shape, 'face').map(own)
  expect(faces).toHaveLength(2)
  const above = faces.find(f => k.uvBounds(f).vMin === 0)!, below = faces.find(f => k.uvBounds(f).vMax === 0)!
  expect(k.uvBounds(above)).toEqual({ uMin: 0, uMax: 4, vMin: 0, vMax: 5 })
  expect(k.uvBounds(below)).toEqual({ uMin: -2, uMax: 10, vMin: -5, vMax: 0 })
  const shared = k.sharedEdges(above, below).map(own)
  expect(shared).toHaveLength(1)
  const edge = shared[0]
  expect(k.curveIsClosed(edge)).toBe(true)
  expect(k.curveParameters(edge)).toEqual({ first: -2, last: 10 })
  const uses = [above, below].map(f => k.getSubShapes(f, 'wire').map(own)
    .flatMap(w => k.iterShapes(w).map(own)).filter(e => k.isSame(e, edge)))
  expect(uses.map(u => u.length)).toEqual([1, 1])
  const orientations = uses.map(u => k.shapeOrientation(u[0]))
  expect([...orientations].sort()).toEqual(['forward', 'reversed'])

  const text = k.toBREP(edge), shellText = k.toBREP(shape), supports = surfaceTable(text)
  const tolerance = Number(/^Ed\s*\n\s*([^\s]+)/m.exec(text)?.[1])
  expect(tolerance).toBeGreaterThanOrEqual(0)
  expect(tolerance).toBeLessThanOrEqual(1e-6)
  const reps = [...text.matchAll(/^2[ \t]+(\d+)[ \t]+(\d+)[ \t]+0[ \t]+-2[ \t]+10[ \t]*\r?$/gm)]
  expect(reps).toHaveLength(2)
  const uvTable = /^Curve2ds 2\s*\n([\s\S]*?)^Curves /m.exec(text)
  expect(uvTable).not.toBeNull()
  const tokens = uvTable![1].trim().split(/\s+/).map(Number), split = tokens[0] === 1 ? 5 : 14
  const pcurves = [tokens.slice(0, split), tokens.slice(split)]
  for (const [f, expected] of [[above, [7, 0, 0, 1, 2, 2, 0, 0, 4, 0, -2, 2, 10, 2]], [below, [1, 0, 0, 1, 0]]] as const) {
    const ownSupport = signature(exclusiveFaceSurface(shellText, k.toBREP(f), faces.length))
    const matching = reps.filter(rep => signature(supports[Number(rep[2]) - 1]) === ownSupport)
    expect(matching).toHaveLength(1)
    expect(pcurves[Number(matching[0][1]) - 1]).toEqual(expected)
  }
  let maximumGap = 0
  for (let i = 0; i <= 64; i++) {
    const t = -2 + 12 * i / 64, point = k.curvePointAtParam(edge, t)
    for (const q of [k.pointOnSurface(above, (t + 2) / 3, 0), k.pointOnSurface(below, t, 0)])
      maximumGap = Math.max(maximumGap, Math.hypot(point.x - q.x, point.y - q.y, point.z - q.z))
  }
  expect(maximumGap).toBeLessThan(1e-7)
  return { curve: k.getNurbsCurveData(edge), orientations, faceOrientations: [above, below].map(f => k.shapeOrientation(f)),
    tolerance, maximumGap }
}

it('clamps the imported nonclamped cubic rim before sewing and round-trips both native pcurves', async () => {
  const k = await OcctKernel.init(), handles: ShapeHandle[] = []
  const own = (shape: ShapeHandle) => { handles.push(shape); return shape }
  const sourceCurve: NurbsCurveData = { degree: 3, rational: false, periodic: false, weights: [],
    knots: [-7, -2, 1, 4, 7, 10, 19], multiplicities: [1, 3, 3, 3, 3, 3, 1], poles: [...ring, ring[0]].flat() }
  const upperRim: ExperimentalPreservedFixtureRim = { curve: sourceCurve, range: activeRange,
    pcurve: { range: activeRange, start: [0, 0], end: [4, 0] } }
  const lowerRim: ExperimentalPreservedFixtureRim = { ...upperRim,
    pcurve: { kind: 'identity-line', range: activeRange, start: [-2, 0], end: [10, 0] } }
  const above = band(false), below = band(true)
  try {
    const sourceFace = own(makeExperimentalNaturalPeriodicFixtureSide(k, above, upperRim)), original = k.toBREP(sourceFace)
    const sourceEdge = k.getSubShapes(sourceFace, 'edge').map(own).find(e => k.curveParameters(e).first === -2)!
    expect(k.curveIsClosed(sourceEdge)).toBe(true)
    const curve = k.getNurbsCurveData(sourceEdge)
    expect(curve).toEqual(sourceCurve)
    const poles = Array.from({ length: curve.poles.length / 3 }, (_, i) => curve.poles.slice(i * 3, i * 3 + 3) as Point)
    const clamped = clampExperimentalPolynomialBSpline({ ...curve, poles }, activeRange)
    if (clamped.status !== 'converted') throw Error(clamped.reason)
    expect(clamped.maximumCurveErrorUpper).toBe(0)
    const clampedCurve: NurbsCurveData = { ...sourceCurve, ...clamped.curve, poles: clamped.curve.poles.flat() }
    expect(clampedCurve).toEqual({ ...sourceCurve, knots: [-2, 1, 4, 7, 10], multiplicities: [4, 3, 3, 3, 4] })

    const edited = structuredClone(above)
    for (let u = 0; u < edited.nu; u++) edited.poles[u * edited.nv + 1][0] += 1 / 32
    const newAbove = own(makeExperimentalNaturalPeriodicFixtureSide(k, edited, { ...upperRim, curve: clampedCurve }))
    const newBelow = own(makeExperimentalNaturalPeriodicFixtureSide(k, below, undefined, { ...lowerRim, curve: clampedCurve }))
    expect(k.pointOnSurface(newAbove, 0, 1).x).toBeGreaterThan(k.pointOnSurface(sourceFace, 0, 1).x)
    const sewn = own(k.sew([newAbove, newBelow], 1e-7)), before = inspectSharedRim(k, sewn, own)
    expect(before.curve).toEqual(clampedCurve)
    const step = k.exportStep(sewn)
    expect(step).toContain('ISO-10303-21;')
    const reopened = inspectSharedRim(k, own(k.importStep(step)), own)
    // The importer may use the exact periodic representation of the same
    // cubic pieces. Its saturated endpoint shares the duplicate pole.
    const periodicCurve = { ...clampedCurve, periodic: true, multiplicities: [3, 3, 3, 3, 3], poles: ring.flat() }
    expect(reopened.curve).toEqual(reopened.curve.periodic ? periodicCurve : clampedCurve)
    expect(reopened.orientations).toEqual(before.orientations)
    expect(reopened.faceOrientations).toEqual(before.faceOrientations)
    console.info({ sewnGap: before.maximumGap, sewnTolerance: before.tolerance,
      reopenedGap: reopened.maximumGap, reopenedTolerance: reopened.tolerance, reopenedPeriodic: reopened.curve.periodic })
    expect(k.toBREP(sourceFace)).toBe(original)
  } finally {
    handles.reverse().forEach(handle => k.release(handle))
    k[Symbol.dispose]()
  }
}, 30_000)
