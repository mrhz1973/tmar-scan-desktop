// SPDX-License-Identifier: AGPL-3.0-only
import { OcctKernel, type NurbsCurveData, type ShapeHandle } from 'occt-wasm'
import { expect, it } from 'vitest'
import { signature, surfaceTable, type Net, type Point } from '../brep'
import { exclusiveFaceSurface } from '../exclusiveSurface'
import { clampExperimentalPolynomialBSpline } from '../experimentalClampedBSplineTrim'
import { clampExperimentalDetachedBrepRim } from '../experimentalDetachedBrepRimClamp'
import { makeExperimentalNaturalPeriodicFixtureSide, type ExperimentalPreservedFixtureRim } from './experimentalPeriodicClosedSolid.fixture'

// Synthetic coefficients only. None of these coordinates or knots comes from
// the Tube. Dyadic coordinates and parameter maps make coefficient comparisons
// meaningful without adapting the fixture to an observed roundtrip result.
const range = [-2, 234] as const
const internalKnots = Array.from({ length: 235 }, (_, i) => i - 1)
const activeKnots = [range[0], ...internalKnots, range[1]]
const periodicMultiplicities = [3, ...internalKnots.map(() => 1), 3]
const ring: Point[] = Array.from({ length: 238 }, (_, i) => {
  const angle = 2 * Math.PI * i / 238
  return [Math.round(10240 * Math.cos(angle)) / 1024, Math.round(8192 * Math.sin(angle)) / 1024, 0]
})
const originalCurve: NurbsCurveData = {
  degree: 3, rational: false, periodic: false, weights: [], poles: [...ring, ring[0]].flat(),
  knots: [-3, ...activeKnots, 235], multiplicities: [1, ...periodicMultiplicities, 1],
}
const expectedClamped: NurbsCurveData = {
  ...originalCurve, knots: activeKnots, multiplicities: [4, ...internalKnots.map(() => 1), 4],
}
const expectedPeriodic: NurbsCurveData = {
  ...expectedClamped, periodic: true, multiplicities: periodicMultiplicities, poles: ring.flat(),
}
// Every active knot and 1/4, 1/2, 3/4 of every span: 237 + 236 * 3 = 945.
const parameters = [...activeKnots]
for (let i = 0; i < activeKnots.length - 1; i++)
  for (const fraction of [0.25, 0.5, 0.75])
    parameters.push(activeKnots[i] + fraction * (activeKnots[i + 1] - activeKnots[i]))
parameters.sort((a, b) => a - b)

type Own = (shape: ShapeHandle) => ShapeHandle

function band(below: boolean): Net {
  const ku = activeKnots.map(t => below ? t : (t + 2) / 2)
  const poles = ring.flatMap(([x, y]) => Array.from({ length: 6 }, (_, v): Point => [x, y, v - (below ? 5 : 0)]))
  return { du: 3, dv: 5, nu: 238, nv: 6, ku, mu: periodicMultiplicities,
    kv: below ? [-5, 0] : [0, 5], mv: [6, 6], poles, weights: poles.map(() => 1), rational: [0, 0], periodic: [1, 0] }
}

function findRim(k: OcctKernel, face: ShapeHandle, own: Own) {
  const matching = k.getSubShapes(face, 'edge').map(own).filter(edge => {
    const bounds = k.curveParameters(edge)
    return bounds.first === range[0] && bounds.last === range[1] && !k.curveIsPeriodic(edge)
  })
  expect(matching).toHaveLength(1)
  return matching[0]
}

function expectSimpleInterior(curve: NurbsCurveData, poleCount: number) {
  expect(curve.degree).toBe(3)
  expect(curve.rational).toBe(false)
  expect(curve.poles).toHaveLength(3 * poleCount)
  const interior = curve.knots.flatMap((knot, i) => knot > range[0] && knot < range[1]
    ? [{ knot, multiplicity: curve.multiplicities[i] }] : [])
  expect(interior).toHaveLength(235)
  expect(interior.map(item => item.knot)).toEqual(internalKnots)
  expect(interior.every(item => item.multiplicity === 1)).toBe(true)
}

function inspectJoinedRim(k: OcctKernel, shape: ShapeHandle, sourceEdge: ShapeHandle, own: Own) {
  expect(k.isValid(shape)).toBe(true)
  expect(k.getSubShapes(shape, 'solid').map(own)).toHaveLength(0)
  const faces = k.getSubShapes(shape, 'face').map(own)
  expect(faces).toHaveLength(2)
  const above = faces.find(face => k.uvBounds(face).vMin === 0)!
  const below = faces.find(face => k.uvBounds(face).vMax === 0)!
  expect(k.uvBounds(above)).toEqual({ uMin: 0, uMax: 118, vMin: 0, vMax: 5 })
  expect(k.uvBounds(below)).toEqual({ uMin: -2, uMax: 234, vMin: -5, vMax: 0 })
  const shared = k.sharedEdges(above, below).map(own)
  expect(shared).toHaveLength(1)
  const edge = shared[0]
  expect(k.curveParameters(edge)).toEqual({ first: range[0], last: range[1] })
  expect(k.curveIsClosed(edge)).toBe(true)
  const uses = [above, below].map(face => k.getSubShapes(face, 'wire').map(own)
    .flatMap(wire => k.iterShapes(wire).map(own)).filter(use => k.isSame(use, edge)))
  expect(uses.map(side => side.length)).toEqual([1, 1])
  const orientations = uses.map(side => k.shapeOrientation(side[0]))
  expect([...orientations].sort()).toEqual(['forward', 'reversed'])

  const text = k.toBREP(edge), shapeText = k.toBREP(shape), supports = surfaceTable(text)
  const tolerance = Number(/^Ed\s*\n\s*([^\s]+)/m.exec(text)?.[1])
  expect(tolerance).toBeGreaterThanOrEqual(0)
  expect(tolerance).toBeLessThanOrEqual(1e-6)
  const reps = [...text.matchAll(/^2[ \t]+(\d+)[ \t]+(\d+)[ \t]+0[ \t]+-2[ \t]+234[ \t]*\r?$/gm)]
  expect(reps).toHaveLength(2)
  const uvTable = /^Curve2ds 2\s*\n([\s\S]*?)^Curves /m.exec(text)
  expect(uvTable).not.toBeNull()
  const tokens = uvTable![1].trim().split(/\s+/).map(Number), split = tokens[0] === 1 ? 5 : 14
  const pcurves = [tokens.slice(0, split), tokens.slice(split)]
  for (const [face, expected] of [[above, [7, 0, 0, 1, 2, 2, 0, 0, 118, 0, -2, 2, 234, 2]], [below, [1, 0, 0, 1, 0]]] as const) {
    const ownSupport = signature(exclusiveFaceSurface(shapeText, k.toBREP(face), faces.length))
    const matching = reps.filter(rep => signature(supports[Number(rep[2]) - 1]) === ownSupport)
    expect(matching).toHaveLength(1)
    expect(pcurves[Number(matching[0][1]) - 1]).toEqual(expected)
  }
  let maximumSupportGap = 0, maximumSourceGap = 0
  for (const t of parameters) {
    const p = k.curvePointAtParam(edge, t), original = k.curvePointAtParam(sourceEdge, t)
    maximumSourceGap = Math.max(maximumSourceGap, Math.hypot(p.x - original.x, p.y - original.y, p.z - original.z))
    for (const q of [k.pointOnSurface(above, (t + 2) / 2, 0), k.pointOnSurface(below, t, 0)])
      maximumSupportGap = Math.max(maximumSupportGap, Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z))
  }
  expect(maximumSupportGap).toBeLessThan(1e-7)
  expect(maximumSourceGap).toBeLessThan(1e-7)
  const curve = k.getNurbsCurveData(edge)
  expectSimpleInterior(curve, curve.periodic ? 238 : 239)
  return { curve, tolerance, maximumSupportGap, maximumSourceGap, orientations,
    faceOrientations: [above, below].map(face => k.shapeOrientation(face)) }
}

it('preserves a synthetic cubic 239-pole rim with 235 simple interior knots through detached clamping and STEP', async () => {
  expectSimpleInterior(originalCurve, 239)
  expect(originalCurve.knots).toHaveLength(239)
  expect(originalCurve.multiplicities.reduce((sum, m) => sum + m, 0)).toBe(243)
  const flat = originalCurve.knots.flatMap((knot, i) => Array<number>(originalCurve.multiplicities[i]).fill(knot))
  expect([flat[3], flat[239]]).toEqual(range)
  expect(activeKnots).toHaveLength(237)
  expect(new Set(parameters).size).toBe(945)
  for (let i = 0; i < activeKnots.length - 1; i++)
    expect(parameters.filter(t => t > activeKnots[i] && t < activeKnots[i + 1])).toHaveLength(3)

  const k = await OcctKernel.init(), handles: ShapeHandle[] = []
  const own: Own = shape => { handles.push(shape); return shape }
  const upperRim: ExperimentalPreservedFixtureRim = { curve: originalCurve, range,
    pcurve: { range, start: [0, 0], end: [118, 0] } }
  const lowerRim: ExperimentalPreservedFixtureRim = { ...upperRim,
    pcurve: { kind: 'identity-line', range, start: [-2, 0], end: [234, 0] } }
  try {
    const above = own(makeExperimentalNaturalPeriodicFixtureSide(k, band(false), upperRim))
    const below = own(makeExperimentalNaturalPeriodicFixtureSide(k, band(true), undefined, lowerRim))
    const sewn = own(k.sew([above, below], 1e-7)), sourceText = k.toBREP(sewn)
    const faces = k.getSubShapes(sewn, 'face').map(own), protectedFace = faces.find(face => k.uvBounds(face).vMax === 0)!
    const sourceEdge = findRim(k, protectedFace, own), source = k.getNurbsCurveData(sourceEdge)
    expect(source).toEqual(originalCurve)
    expectSimpleInterior(source, 239)
    const text = k.toBREP(protectedFace)
    const otherCurves = (face: ShapeHandle, target: ShapeHandle) => k.getSubShapes(face, 'edge').map(own)
      .filter(other => !k.isSame(other, target)).map(other => k.getNurbsCurveData(other))
    const protectedCurves = otherCurves(protectedFace, sourceEdge)
    const sourceCurve = { ...source, poles: Array.from({ length: 239 }, (_, i) => source.poles.slice(i * 3, i * 3 + 3) as Point) }
    const clamp = clampExperimentalPolynomialBSpline(sourceCurve, range)
    if (clamp.status !== 'converted') throw Error(clamp.reason)
    expect(clamp.exactInBinary64).toBe(true)
    expect(clamp.maximumCurveErrorUpper).toBe(0)
    expect({ ...source, ...clamp.curve, poles: clamp.curve.poles.flat() }).toEqual(expectedClamped)

    const result = clampExperimentalDetachedBrepRim(text, { sourceCurve, range })
    if (result.status !== 'rewritten') throw Error(result.reason)
    const outsideCurves = (brep: string) => brep.replace(/(^Curves \d+\s*\n)[\s\S]*?(^Polygon3D)/m, '$1$2')
    expect(outsideCurves(result.brep)).toBe(outsideCurves(text))
    expect(result.brep).not.toBe(text)
    const staged = own(k.fromBREP(result.brep)), edge = findRim(k, staged, own)
    expect(k.isValid(staged)).toBe(true)
    expect(otherCurves(staged, edge)).toEqual(protectedCurves)
    expect(k.shapeOrientation(staged)).toBe(k.shapeOrientation(protectedFace))
    expect(k.uvBounds(staged)).toEqual(k.uvBounds(protectedFace))
    const clamped = k.getNurbsCurveData(edge)
    expect(clamped).toEqual(expectedClamped)
    expectSimpleInterior(clamped, 239)
    const moving = band(false)
    for (let u = 0; u < moving.nu; u++) moving.poles[u * moving.nv + 1][0] += 1 / 32
    const rebuilt = own(makeExperimentalNaturalPeriodicFixtureSide(k, moving, { ...upperRim, curve: clamped }))
    expect(k.pointOnSurface(rebuilt, 59, 1).x).toBeGreaterThan(k.pointOnSurface(above, 59, 1).x)
    const joined = own(k.sew([rebuilt, staged], 1e-7)), before = inspectJoinedRim(k, joined, sourceEdge, own)
    expect(before.curve).toEqual(expectedClamped)
    const step = k.exportStep(joined)
    expect(step).toContain('ISO-10303-21;')
    const reopened = inspectJoinedRim(k, own(k.importStep(step)), sourceEdge, own)
    expect(reopened.curve).toEqual(reopened.curve.periodic ? expectedPeriodic : expectedClamped)
    expect(reopened.orientations).toEqual(before.orientations)
    expect(reopened.faceOrientations).toEqual(before.faceOrientations)
    expect(k.toBREP(protectedFace)).toBe(text)
    expect(k.toBREP(sewn)).toBe(sourceText)
    console.info({ scope: 'synthetic-only; no Tube data or qualification', degree: 3, sourcePoles: 239, clampedPoles: 239,
      simpleInteriorKnots: 235, activeSpans: 236, sampledParameters: parameters.length, exactClampingBound: clamp.maximumCurveErrorUpper,
      sewnSupportGap: before.maximumSupportGap, sewnSourceGap: before.maximumSourceGap, sewnTolerance: before.tolerance,
      reopenedSupportGap: reopened.maximumSupportGap, reopenedSourceGap: reopened.maximumSourceGap,
      reopenedTolerance: reopened.tolerance, reopenedPeriodic: reopened.curve.periodic, reopenedPoles: reopened.curve.poles.length / 3 })
  } finally {
    handles.reverse().forEach(handle => k.release(handle))
    k[Symbol.dispose]()
  }
}, 30_000)
