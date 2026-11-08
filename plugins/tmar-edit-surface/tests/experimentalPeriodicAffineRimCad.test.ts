// SPDX-License-Identifier: AGPL-3.0-only
import { OcctKernel, type ShapeHandle } from 'occt-wasm'
import { expect, it } from 'vitest'
import { signature, surfaceTable, type Net, type Point } from '../brep'
import { exclusiveFaceSurface } from '../exclusiveSurface'
import { makeExperimentalNaturalPeriodicFixtureSide, type ExperimentalPreservedFixtureRim } from './experimentalPeriodicClosedSolid.fixture'

function rimFixture() {
  const ring: Point[] = [[10, 0, 0], [10, 8, 0], [0, 10, 0], [-10, 0, 0], [0, -10, 0], [10, -8, 0]]
  const poles = ring.flatMap(([x, y]) => Array.from({ length: 6 }, (_, v): Point => [x, y, v]))
  const net: Net = { du: 2, dv: 5, nu: 6, nv: 6, ku: [0, 1, 2, 3, 4, 5], mu: [2, 1, 1, 1, 1, 2],
    kv: [0, 5], mv: [6, 6], periodic: [1, 0], rational: [0, 0], poles, weights: poles.map(() => 1) }
  // The middle five spans describe the U ring. Constant extensions outside
  // the edge trim keep the underlying curve's knot interval strictly wider.
  const base = ring[0], extended = [base, base, ...ring, base, base, base]
  const input: ExperimentalPreservedFixtureRim = { curve: { degree: 2, periodic: false, rational: false,
    poles: extended.flat(), weights: [], knots: [-5, -2, 1, 4, 7, 10, 13, 17],
    multiplicities: [3, 2, 1, 1, 1, 1, 2, 3] }, range: [-2, 13],
    pcurve: { range: [-2, 13], start: [0, 0], end: [5, 0] } }
  return { net, input }
}

it('preserves a trimmed closed nonperiodic rim and its native affine pcurve while moving the cut', async () => {
  const k = await OcctKernel.init(), handles: ShapeHandle[] = []
  const own = (shape: ShapeHandle) => { handles.push(shape); return shape }
  const { net, input } = rimFixture()
  const rim = (face: ShapeHandle) => {
    const matches = k.getSubShapes(face, 'edge').map(own).filter(e => k.curveParameters(e).first === -2)
    expect(matches).toHaveLength(1)
    return matches[0]
  }
  try {
    const source = own(makeExperimentalNaturalPeriodicFixtureSide(k, net, input)), original = rim(source)
    const curve = k.getNurbsCurveData(original), range = k.curveParameters(original)
    expect(curve).toEqual(input.curve)
    expect(range).toEqual({ first: -2, last: 13 })
    const edited = structuredClone(net)
    for (let u = 0; u < edited.nu; u++) edited.poles[u * edited.nv + 1][0] += 1 / 32
    const stored = { ...input, curve, range: [range.first, range.last] as const }
    const candidate = own(makeExperimentalNaturalPeriodicFixtureSide(k, edited, stored)), copied = rim(candidate)
    expect(k.curveIsClosed(copied)).toBe(true)
    expect(k.curveIsPeriodic(copied)).toBe(false)
    expect(k.getNurbsCurveData(copied)).toEqual(curve)
    expect(k.curveParameters(copied)).toEqual(range)
    for (const face of [source, candidate]) {
      const edge = rim(face), text = k.toBREP(edge)
      expect(text).toMatch(/^2\s+\d+\s+\d+\s+0\s+-2\s+13$/m)
      const serializedPcurve = /^Curve2ds 1\s*\n([\s\S]*?)^Curves /m.exec(text)
      expect(serializedPcurve?.[1].trim().replace(/\s+/g, ' ')).toBe('7 0 0 1 2 2 0 0 5 0 -2 2 13 2')
      const vertex = k.getSubShapes(edge, 'vertex').map(own)
      expect(vertex).toHaveLength(1)
      expect(k.vertexPosition(vertex[0])).toEqual({ x: 10, y: 0, z: 0 })
      const cut = k.getSubShapes(face, 'edge').map(own).filter(e => !k.curveIsClosed(e))
      expect(cut).toHaveLength(1)
      expect(k.getSubShapes(cut[0], 'vertex').map(own).some(v => k.isSame(v, vertex[0]))).toBe(true)
      for (const t of [-2, 1, 4, 7, 10, 13]) {
        const p = k.curvePointAtParam(edge, t), q = k.pointOnSurface(face, (t + 2) / 3, 0)
        expect(Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z)).toBeLessThan(1e-7)
      }
    }
    expect(k.pointOnSurface(candidate, 0, 1).x).toBeGreaterThan(k.pointOnSurface(source, 0, 1).x)
    expect(() => makeExperimentalNaturalPeriodicFixtureSide(k, edited, { ...stored,
      pcurve: { ...stored.pcurve, range: [0, 5] } })).toThrow('Unsupported preserved rim range or pcurve')
    expect(() => makeExperimentalNaturalPeriodicFixtureSide(k, edited, { ...stored,
      pcurve: { ...stored.pcurve, end: [4, 0] } })).toThrow('Unsupported preserved rim range or pcurve')
    const inconsistent = structuredClone(stored)
    inconsistent.curve.poles[3 * 4 + 1] += 1
    expect(() => makeExperimentalNaturalPeriodicFixtureSide(k, edited, inconsistent)).toThrow('Preserved rim')
  } finally {
    handles.reverse().forEach(handle => k.release(handle))
    k[Symbol.dispose]()
  }
}, 30_000)

it('vetoes STEP trim expansion and round-trips an exactly segmented shared rim', async () => {
  const k = await OcctKernel.init(), handles: ShapeHandle[] = []
  const own = (shape: ShapeHandle) => { handles.push(shape); return shape }
  const { net, input } = rimFixture()
  const opposite: Net = { ...net, ku: net.ku.map(u => -2 + 3 * u), kv: [-5, 0],
    poles: net.poles.map(([x, y, z]) => [x, y, z - 5]) }
  const oppositeInput: ExperimentalPreservedFixtureRim = { ...input,
    pcurve: { kind: 'identity-line', range: [-2, 13], start: [-2, 0], end: [13, 0] } }
  function inspect(shape: ShapeHandle, allowPeriodic = false) {
    expect(k.isValid(shape)).toBe(true)
    const faces = k.getSubShapes(shape, 'face').map(own)
    expect(faces).toHaveLength(2)
    const first = faces.find(f => k.uvBounds(f).vMin === 0)!, second = faces.find(f => k.uvBounds(f).vMax === 0)!
    expect(first).toBeDefined(); expect(second).toBeDefined()
    const shared = k.sharedEdges(first, second).map(own)
    expect(shared).toHaveLength(1)
    const edge = shared[0]
    expect(k.curveIsClosed(edge)).toBe(true)
    const range = k.curveParameters(edge), periodic = k.curveIsPeriodic(edge)
    const uses = [first, second].flatMap(f => k.getSubShapes(f, 'wire').map(own)
      .flatMap(w => k.iterShapes(w).map(own)).filter(e => k.isSame(e, edge)))
    expect(uses.map(e => k.shapeOrientation(e)).sort()).toEqual(['forward', 'reversed'])
    const text = k.toBREP(edge), supports = surfaceTable(text), bodyText = k.toBREP(shape)
    const tolerance = Number(/^Ed[ \t]*\r?\n[ \t]*([^\s]+)/m.exec(text)?.[1])
    expect(Number.isFinite(tolerance)).toBe(true)
    const reps = [...text.matchAll(/^2[ \t]+(\d+)[ \t]+(\d+)[ \t]+0[ \t]+([-+\d.eE]+)[ \t]+([-+\d.eE]+)[ \t]*\r?$/gm)]
    expect(reps).toHaveLength(2)
    const pcurveRanges = reps.map(rep => [Number(rep[3]), Number(rep[4])])
    if ((!allowPeriodic && periodic) || tolerance > 1e-6 || range.first !== -2 || range.last !== 13 || pcurveRanges.some(([a, b]) => a !== -2 || b !== 13))
      return { status: 'rim-representation-changed', range, periodic, pcurveRanges, tolerance }
    const pcurveTable = /^Curve2ds 2\s*\n([\s\S]*?)^Curves /m.exec(text)
    expect(pcurveTable).not.toBeNull()
    const tokens = pcurveTable![1].trim().split(/\s+/).map(Number)
    const firstCount = tokens[0] === 1 ? 5 : 14
    const curves = [tokens.slice(0, firstCount), tokens.slice(firstCount)]
    for (const [f, expected] of [[first, [7, 0, 0, 1, 2, 2, 0, 0, 5, 0, -2, 2, 13, 2]], [second, [1, 0, 0, 1, 0]]] as const) {
      const ownSupport = signature(exclusiveFaceSurface(bodyText, k.toBREP(f), faces.length))
      const matching = reps.filter(rep => signature(supports[Number(rep[2]) - 1]) === ownSupport)
      expect(matching).toHaveLength(1)
      expect(curves[Number(matching[0][1]) - 1]).toEqual(expected)
    }
    for (let i = 0; i <= 32; i++) {
      const t = -2 + 15 * i / 32, p = k.curvePointAtParam(edge, t)
      for (const q of [k.pointOnSurface(first, (t + 2) / 3, 0), k.pointOnSurface(second, t, 0)])
        expect(Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z)).toBeLessThan(1e-7)
    }
    return { status: 'preserved', curve: k.getNurbsCurveData(edge) }
  }
  try {
    const first = own(makeExperimentalNaturalPeriodicFixtureSide(k, net, input))
    const second = own(makeExperimentalNaturalPeriodicFixtureSide(k, opposite, undefined, oppositeInput))
    const joined = own(k.sew([first, second], 1e-7))
    expect(inspect(joined)).toEqual({ status: 'preserved', curve: input.curve })
    const step = k.exportStep(joined)
    expect(step).toContain('ISO-10303-21;')
    const reopened = own(k.importStep(step))
    const readback = inspect(reopened)
    expect(readback).toMatchObject({ status: 'rim-representation-changed',
      range: { first: -5, last: 17 }, periodic: true, pcurveRanges: [[-5, 17], [-5, 17]] })
    if (readback.status !== 'rim-representation-changed') throw Error('Expected a round-trip veto')
    expect(readback.tolerance).toBeGreaterThan(1e-6)
    // Remove only the two constant spans outside the edge interval. In this
    // synthetic basis the active coefficients stay exact when clamped.
    const trimmed = { ...input, curve: { ...input.curve, poles: input.curve.poles.slice(6, -6),
      knots: input.curve.knots.slice(1, -1), multiplicities: [3, 1, 1, 1, 1, 3] } }
    const trimmedFirst = own(makeExperimentalNaturalPeriodicFixtureSide(k, net, trimmed))
    const trimmedSecond = own(makeExperimentalNaturalPeriodicFixtureSide(k, opposite, undefined, { ...oppositeInput, curve: trimmed.curve }))
    const trimmedJoined = own(k.sew([trimmedFirst, trimmedSecond], 1e-7))
    expect(inspect(trimmedJoined)).toEqual({ status: 'preserved', curve: trimmed.curve })
    const trimmedReadback = inspect(own(k.importStep(k.exportStep(trimmedJoined))), true)
    // Saturated periodic form shares U0 at the ends instead of duplicating
    // its last control point. Both exact forms represent the same edge map.
    expect(trimmedReadback).toEqual({ status: 'preserved', curve: { ...trimmed.curve, periodic: true,
      poles: trimmed.curve.poles.slice(0, -3), multiplicities: [2, 1, 1, 1, 1, 2] } })
  } finally {
    handles.reverse().forEach(h => k.release(h))
    k[Symbol.dispose]()
  }
}, 30_000)
