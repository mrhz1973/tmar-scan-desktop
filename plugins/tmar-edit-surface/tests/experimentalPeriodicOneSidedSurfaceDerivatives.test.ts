// SPDX-License-Identifier: AGPL-3.0-only
import { OcctKernel } from 'occt-wasm'
import { expect, it } from 'vitest'
import { encodeNet, type Net, type Point } from '../brep'
import { prepareExperimentalPeriodicOneSidedSurfaceDerivatives } from '../experimentalPeriodicOneSidedSurfaceDerivatives'
import { prepareExperimentalPeriodicSurfaceDerivatives } from '../experimentalPeriodicSurfaceDerivatives'

function triangleStrip(): Net {
  const triangle = [[0, 0], [2, 0], [4, 0], [6, 0], [4, 2], [2, 4], [0, 6], [0, 4], [0, 2]]
  const heights = [-3, -2, -1, 0, 4, 8, 12], shifts = [0, 0, 0, 0, 2, 4, 6]
  return {
    nu: 9, nv: 7, du: 3, dv: 3, periodic: [1, 0], rational: [0, 0],
    ku: [0, 1, 3, 4], mu: [3, 3, 3, 3], kv: [-1, 0, 2], mv: [4, 3, 4],
    poles: triangle.flatMap(([x, y]) => heights.map((z, j): Point => [x + shifts[j], y, z])),
    weights: Array<number>(63).fill(1),
  }
}

function surface(k: OcctKernel, net: Net) {
  return k.fromBREP(`CASCADE Topology V3, (c) Open Cascade
Locations 0
Curve2ds 0
Curves 0
Polygon3D 0
PolygonOnTriangulations 0
Surfaces 1
${encodeNet(net)}
Triangulations 0

TShapes 1
Fa
0 1e-7 1 0

0111000
*

+1 0
`)
}

const tuple = (point: { x: number; y: number; z: number }): Point => [point.x, point.y, point.z]
const unit = (v: Point) => v.map(x => x / Math.hypot(...v)) as Point
const error = (a: Point, b: Point) => Math.hypot(...a.map((x, i) => x - b[i]))
const difference = (a: Point, b: Point, step: number) => a.map((x, i) => (x - b[i]) / step) as Point

it('matches the two limits at the triple cubic seam and true U and V creases', async () => {
  const net = triangleStrip(), evaluator = prepareExperimentalPeriodicOneSidedSurfaceDerivatives(net)
  const k = await OcctKernel.init()
  try {
    const face = surface(k, net), reversed = k.reverseShape(face)
    expect(k.shapeOrientation(face)).toBe('forward')
    expect(k.shapeOrientation(reversed)).toBe('reversed')
    const samples = [
      { u: 0, v: -0.25, sides: { u: 'left' } }, { u: 0, v: -0.25, sides: { u: 'right' } },
      { u: 4, v: 0, sides: { u: 'left', v: 'right' } }, { u: 4, v: 0, sides: { u: 'right', v: 'left' } },
      { u: 1, v: 0, sides: { u: 'left', v: 'left' } }, { u: 1, v: 0, sides: { u: 'right', v: 'right' } },
      { u: 3, v: 0, sides: { u: 'left', v: 'right' } }, { u: 3, v: 0, sides: { u: 'right', v: 'left' } },
      { u: 2, v: -1, sides: { v: 'right' } }, { u: 2, v: 2, sides: { v: 'left' } },
      { u: 2, v: 1, sides: {} },
    ] as const
    for (const { u, v, sides } of samples) {
      const actual = evaluator.evaluate(u, v, sides)
      const uSide = 'u' in sides ? sides.u : undefined, vSide = 'v' in sides ? sides.v : undefined
      const physicalU = u === 0 && uSide === 'left' ? 4 : u === 4 && uSide === 'right' ? 0 : u
      const hU = uSide === 'left' ? -1 / 16 : 1 / 16, hV = vSide === 'left' ? -1 / 16 : 1 / 16
      const point = (s: number, t: number) => tuple(k.pointOnSurface(face, s, t))
      const origin = point(physicalU, v)
      // The fixture is affine within each cell, so the inward OCCT secant
      // gives the one-sided derivative without crossing either crease.
      expect(error(actual.du, difference(point(physicalU + hU, v), origin, hU))).toBeLessThan(1e-10)
      expect(error(actual.dv, difference(point(physicalU, v + hV), origin, hV))).toBeLessThan(1e-10)
      const uInterior = physicalU + hU / 2, vInterior = v + hV / 2
      expect(error(unit(actual.normal), tuple(k.surfaceNormal(face, uInterior, vInterior)))).toBeLessThan(1e-11)
      expect(error(unit(actual.normal), tuple(k.surfaceNormal(reversed, uInterior, vInterior)).map(x => -x) as Point))
        .toBeLessThan(1e-11)
    }
    const left = evaluator.evaluate(0, -0.25, { u: 'left' }), right = evaluator.evaluate(0, -0.25, { u: 'right' })
    expect(error(left.du, [0, -6, 0])).toBeLessThan(1e-12)
    expect(error(right.du, [6, 0, 0])).toBeLessThan(1e-12)
    expect(error(left.normal, [-18, 0, 0])).toBeLessThan(1e-12)
    expect(error(right.normal, [0, -18, 0])).toBeLessThan(1e-12)
    expect(evaluator.evaluate(4, -0.25, { u: 'left' })).toEqual(left)
    expect(evaluator.evaluate(4, -0.25, { u: 'right' })).toEqual(right)
  } finally {
    k[Symbol.dispose]()
  }
})

it('agrees with the existing evaluator on C1 spans and makes a supplied side optional at C1 knots', () => {
  const base = triangleStrip()
  const net: Net = {
    ...base, nu: 6, ku: [-3, -1, 0.5, 4, 7], mu: [2, 1, 2, 1, 2],
    kv: [-1, 0, 1, 2], mv: [4, 2, 1, 4], poles: base.poles.slice(0, 42), weights: Array<number>(42).fill(1),
  }
  const regular = prepareExperimentalPeriodicSurfaceDerivatives(net)
  const oneSided = prepareExperimentalPeriodicOneSidedSurfaceDerivatives(net)
  for (const u of [-3, -2, -1, 0.5, 2, 7]) for (const v of [-1, -0.25, 0, 1, 2]) {
    const actual = oneSided.evaluate(u, v), expected = regular.evaluate(u, v)
    expect(error(actual.du, expected.du)).toBeLessThan(1e-12)
    expect(error(actual.dv, expected.dv)).toBeLessThan(1e-12)
    expect(error(actual.normal, expected.normal)).toBeLessThan(1e-11)
  }
  const left = oneSided.evaluate(0.5, 0, { u: 'left', v: 'left' })
  const right = oneSided.evaluate(0.5, 0, { u: 'right', v: 'right' })
  expect(error(left.normal, right.normal)).toBeLessThan(1e-11)
})

it('requires an explicit side even when the two limits of a structural C0 seam happen to agree', () => {
  const net = triangleStrip()
  for (let v = 0; v < net.nv; v++) {
    const [x, y, z] = net.poles[v]
    net.poles[8 * net.nv + v] = [x - 2, y, z]
  }
  const evaluator = prepareExperimentalPeriodicOneSidedSurfaceDerivatives(net)
  expect(() => evaluator.evaluate(0, 1)).toThrow(/lato U richiesto.*C0/)
  const left = evaluator.evaluate(0, 1, { u: 'left' }), right = evaluator.evaluate(0, 1, { u: 'right' })
  expect(error(left.du, right.du)).toBeLessThan(1e-12)
  expect(error(left.dv, right.dv)).toBeLessThan(1e-12)
  expect(error(left.normal, right.normal)).toBeLessThan(1e-11)
})

it('refuses ambiguous sides, exterior requests, bad coefficients and unrepresentable normals', () => {
  const net = triangleStrip(), evaluator = prepareExperimentalPeriodicOneSidedSurfaceDerivatives(net)
  for (const u of [0, 1, 3, 4]) expect(() => evaluator.evaluate(u, 0.5)).toThrow(/lato U richiesto.*C0/)
  expect(() => evaluator.evaluate(1, 0, { u: 'right' })).toThrow(/lato V richiesto.*C0/)
  expect(() => evaluator.evaluate(2, 0.5, { u: 'left' })).toThrow(/lato U specificato fuori/)
  expect(() => evaluator.evaluate(1, 0.5, { u: 'above' as never })).toThrow(/lato U non valido/)
  expect(() => evaluator.evaluate(2, -1, { v: 'left' })).toThrow(/lato V esterno/)
  expect(() => evaluator.evaluate(2, 2, { v: 'right' })).toThrow(/lato V esterno/)
  expect(() => evaluator.evaluate(NaN, 1)).toThrow(/parametro fuori intervallo U/)
  expect(() => evaluator.evaluate(2, 3)).toThrow(/parametro fuori intervallo V/)
  expect(() => prepareExperimentalPeriodicSurfaceDerivatives(net)).toThrow(/C1/)
  const weighted = structuredClone(net)
  weighted.rational = [1, 0]
  weighted.weights[0] = 2
  expect(() => prepareExperimentalPeriodicOneSidedSurfaceDerivatives(weighted)).toThrow(/pesi unitari/)
  expect(() => prepareExperimentalPeriodicOneSidedSurfaceDerivatives({ ...net, ku: [0, 1e-309, 3, 4] }))
    .toThrow(/reciproco della campata/)
  const huge = { ...net, poles: net.poles.map(p => p.map(x => x * 1e155) as Point) }
  expect(() => prepareExperimentalPeriodicOneSidedSurfaceDerivatives(huge).evaluate(2, 1)).toThrow(/normale.*non finita/)
})
