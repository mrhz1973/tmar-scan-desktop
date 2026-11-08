// SPDX-License-Identifier: AGPL-3.0-only
import { OcctKernel, type NurbsCurveData, type ShapeHandle } from 'occt-wasm'
import { expect, it } from 'vitest'
import { signature, surfaceTable, type Net, type Point } from '../brep'
import { exclusiveFaceSurface } from '../exclusiveSurface'
import { clampExperimentalDetachedBrepRim } from '../experimentalDetachedBrepRimClamp'
import { makeExperimentalNaturalPeriodicFixtureSide, type ExperimentalPreservedFixtureRim } from './experimentalPeriodicClosedSolid.fixture'

const ring: Point[] = [[10, 0, 0], [10, 8, 0], [0, 10, 0], [-10, 0, 0], [0, -10, 0], [10, -8, 0]]
const range = [-2, 13] as const

function band(below: boolean): Net {
  const ku = [0, 1, 2, 3, 4, 5].map(u => below ? -2 + 3 * u : u)
  const poles = ring.flatMap(([x, y]) => Array.from({ length: 6 }, (_, v): Point => [x, y, v - (below ? 5 : 0)]))
  return { du: 2, dv: 5, nu: 6, nv: 6, ku, mu: [2, 1, 1, 1, 1, 2], kv: below ? [-5, 0] : [0, 5], mv: [6, 6],
    poles, weights: poles.map(() => 1), rational: [0, 0], periodic: [1, 0] }
}

function inspectJoinedRim(k: OcctKernel, shape: ShapeHandle, own: (shape: ShapeHandle) => ShapeHandle) {
  expect(k.isValid(shape)).toBe(true)
  const faces = k.getSubShapes(shape, 'face').map(own)
  expect(faces).toHaveLength(2)
  const above = faces.find(face => k.uvBounds(face).vMin === 0)!
  const below = faces.find(face => k.uvBounds(face).vMax === 0)!
  expect(k.uvBounds(above)).toEqual({ uMin: 0, uMax: 5, vMin: 0, vMax: 5 })
  expect(k.uvBounds(below)).toEqual({ uMin: -2, uMax: 13, vMin: -5, vMax: 0 })
  const shared = k.sharedEdges(above, below).map(own)
  expect(shared).toHaveLength(1)
  const edge = shared[0]
  expect(k.curveParameters(edge)).toEqual({ first: -2, last: 13 })
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
  const reps = [...text.matchAll(/^2[ \t]+(\d+)[ \t]+(\d+)[ \t]+0[ \t]+-2[ \t]+13[ \t]*\r?$/gm)]
  expect(reps).toHaveLength(2)
  const uvTable = /^Curve2ds 2\s*\n([\s\S]*?)^Curves /m.exec(text)
  expect(uvTable).not.toBeNull()
  const tokens = uvTable![1].trim().split(/\s+/).map(Number), split = tokens[0] === 1 ? 5 : 14
  const pcurves = [tokens.slice(0, split), tokens.slice(split)]
  for (const [face, expected] of [[above, [7, 0, 0, 1, 2, 2, 0, 0, 5, 0, -2, 2, 13, 2]], [below, [1, 0, 0, 1, 0]]] as const) {
    const ownSupport = signature(exclusiveFaceSurface(shapeText, k.toBREP(face), faces.length))
    const matching = reps.filter(rep => signature(supports[Number(rep[2]) - 1]) === ownSupport)
    expect(matching).toHaveLength(1)
    expect(pcurves[Number(matching[0][1]) - 1]).toEqual(expected)
  }
  let maximumGap = 0
  for (let i = 0; i <= 64; i++) {
    const t = -2 + 15 * i / 64, p = k.curvePointAtParam(edge, t)
    for (const q of [k.pointOnSurface(above, (t + 2) / 3, 0), k.pointOnSurface(below, t, 0)])
      maximumGap = Math.max(maximumGap, Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z))
  }
  expect(maximumGap).toBeLessThan(1e-7)
  return { curve: k.getNurbsCurveData(edge), orientations, faceOrientations: [above, below].map(face => k.shapeOrientation(face)),
    tolerance, maximumGap }
}

it('clamps a detached protected rim and preserves both native pcurves through sewing and STEP readback', async () => {
  const k = await OcctKernel.init(), handles: ShapeHandle[] = []
  const own = (shape: ShapeHandle) => { handles.push(shape); return shape }
  const originalCurve: NurbsCurveData = { degree: 2, rational: false, periodic: false, weights: [], poles: [...ring, ring[0]].flat(),
    knots: [-5, -2, 1, 4, 7, 10, 13, 17], multiplicities: [1, 2, 1, 1, 1, 1, 2, 1] }
  const upperRim: ExperimentalPreservedFixtureRim = { curve: originalCurve, range, pcurve: { range, start: [0, 0], end: [5, 0] } }
  const lowerRim: ExperimentalPreservedFixtureRim = { ...upperRim,
    pcurve: { kind: 'identity-line', range, start: [-2, 0], end: [13, 0] } }
  const rim = (face: ShapeHandle) => {
    const matching = k.getSubShapes(face, 'edge').map(own).filter(edge => k.curveParameters(edge).first === -2 && !k.curveIsPeriodic(edge))
    expect(matching).toHaveLength(1)
    return matching[0]
  }
  try {
    const above = own(makeExperimentalNaturalPeriodicFixtureSide(k, band(false), upperRim))
    const below = own(makeExperimentalNaturalPeriodicFixtureSide(k, band(true), undefined, lowerRim))
    const sewn = own(k.sew([above, below], 1e-7)), faces = k.getSubShapes(sewn, 'face').map(own)
    const protectedFace = faces.find(f => k.uvBounds(f).vMax === 0)!
    const sourceEdge = rim(protectedFace), text = k.toBREP(protectedFace), source = k.getNurbsCurveData(sourceEdge)
    const otherCurves = (face: ShapeHandle, target: ShapeHandle) => k.getSubShapes(face, 'edge').map(own)
      .filter(other => !k.isSame(other, target)).map(other => k.getNurbsCurveData(other))
    const protectedCurves = otherCurves(protectedFace, sourceEdge)
    expect(source).toEqual(originalCurve)
    const request = { sourceCurve: { ...source, poles: Array.from({ length: source.poles.length / 3 }, (_, i) =>
      source.poles.slice(i * 3, i * 3 + 3) as Point) }, range }
    const result = clampExperimentalDetachedBrepRim(text, request)
    if (result.status !== 'rewritten') throw Error(result.reason)
    const outsideCurves = (brep: string) => brep.replace(/(^Curves \d+\s*\n)[\s\S]*?(^Polygon3D)/m, '$1$2')
    expect(outsideCurves(result.brep)).toBe(outsideCurves(text))
    expect(result.brep).not.toBe(text)

    const staged = own(k.fromBREP(result.brep)), edge = rim(staged)
    expect(k.isValid(staged)).toBe(true)
    expect(otherCurves(staged, edge)).toEqual(protectedCurves)
    expect(k.shapeOrientation(staged)).toBe(k.shapeOrientation(protectedFace))
    expect(k.uvBounds(staged)).toEqual(k.uvBounds(protectedFace))
    expect(k.curveParameters(edge)).toEqual({ first: -2, last: 13 })
    const clamped = k.getNurbsCurveData(edge)
    expect(clamped).toEqual({ ...originalCurve, knots: [-2, 1, 4, 7, 10, 13], multiplicities: [3, 1, 1, 1, 1, 3] })
    const moving = band(false)
    for (let u = 0; u < moving.nu; u++) moving.poles[u * moving.nv + 1][0] += 1 / 32
    const rebuilt = own(makeExperimentalNaturalPeriodicFixtureSide(k, moving, { ...upperRim, curve: clamped }))
    const joined = own(k.sew([rebuilt, staged], 1e-7)), joinedFaces = k.getSubShapes(joined, 'face').map(own)
    expect(k.isValid(joined)).toBe(true)
    expect(joinedFaces).toHaveLength(2)
    const shared = k.sharedEdges(joinedFaces[0], joinedFaces[1]).map(own)
    expect(shared).toHaveLength(1)
    expect(k.getNurbsCurveData(shared[0])).toEqual(clamped)
    const before = inspectJoinedRim(k, joined, own)
    const step = k.exportStep(joined)
    expect(step).toContain('ISO-10303-21;')
    const reopened = inspectJoinedRim(k, own(k.importStep(step)), own)
    const periodicCurve = { ...clamped, periodic: true, multiplicities: [2, 1, 1, 1, 1, 2], poles: ring.flat() }
    expect(reopened.curve).toEqual(reopened.curve.periodic ? periodicCurve : clamped)
    expect(reopened.orientations).toEqual(before.orientations)
    expect(reopened.faceOrientations).toEqual(before.faceOrientations)
    console.info({ sewnGap: before.maximumGap, sewnTolerance: before.tolerance,
      reopenedGap: reopened.maximumGap, reopenedTolerance: reopened.tolerance, reopenedPeriodic: reopened.curve.periodic })
    expect(k.toBREP(protectedFace)).toBe(text)

    const vertexReference = text.replace(/(^Ve[ \t]*\r?\n[^\r\n]+\r?\n[^\r\n]+\r?\n)([ \t]*0[ \t]+0[ \t]*\r?$)/m,
      (_, prefix, terminator) => `${prefix}-2 1 ${result.curveIndex} 0\n${terminator}`)
    expect(vertexReference).not.toBe(text)
    expect(clampExperimentalDetachedBrepRim(vertexReference, request))
      .toEqual({ status: 'inconclusive', reason: 'unsupported-vertex-table' })
    const topology = text.indexOf('\nTShapes ')
    let changed = false
    const ambiguous = text.slice(0, topology) + text.slice(topology).replace(/^(1[ \t]+)(\d+)([ \t]+0[ \t]+[-+\d.eE]+[ \t]+[-+\d.eE]+[ \t]*)$/gm,
      (row, prefix, index, suffix) => {
        if (changed || Number(index) === result.curveIndex) return row
        changed = true
        return `${prefix}${result.curveIndex}${suffix}`
      })
    expect(changed).toBe(true)
    expect(clampExperimentalDetachedBrepRim(ambiguous, request)).toEqual({ status: 'inconclusive', reason: 'ambiguous-edge-owner' })
    expect(clampExperimentalDetachedBrepRim(text, { ...request, range: [1, 13] }))
      .toEqual({ status: 'inconclusive', reason: 'edge-range-or-pcurve-unverified' })
    expect(clampExperimentalDetachedBrepRim(text.replace(/(\nCurves \d+\r?\n)7 /, '$16 '), request).status).toBe('inconclusive')
  } finally {
    handles.reverse().forEach(h => k.release(h))
    k[Symbol.dispose]()
  }
}, 30_000)
