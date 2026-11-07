// SPDX-License-Identifier: AGPL-3.0-only
import { OcctKernel, type ShapeHandle } from 'occt-wasm'
import { expect, it } from 'vitest'
import { encodeNet, type Net, type Point } from '../brep'
import { prepareExperimentalPeriodicSurfaceDerivatives } from '../experimentalPeriodicSurfaceDerivatives'

function fixture(rows: 4 | 9): Net {
  const ring = [[3, 0], [2, 2], [-1, 3], [-3, 0], [-1, -2], [2, -2]]
  return {
    nu: 6, nv: rows, du: 3, dv: 3, periodic: [1, 0], rational: [0, 0],
    ku: [-3, -1, 0.5, 4, 7], mu: [2, 1, 2, 1, 2],
    kv: rows === 4 ? [2, 8] : [2, 2.5, 4, 5, 7, 8], mv: rows === 4 ? [4, 4] : [4, 1, 2, 1, 1, 4],
    poles: ring.flatMap(([x, y]) => Array.from({ length: rows }, (_, j): Point => {
      const t = j / (rows - 1)
      return [x * (1 + t / 8) + t / 8, y * (1 + t / 4) - t / 16, (4 + y / 4) * t + x * t ** 2 / 8]
    })),
    weights: Array<number>(6 * rows).fill(1),
  }
}

function surface(k: OcctKernel, net: Net): ShapeHandle {
  // A support-only face is sufficient for independent OCCT D1 and point
  // evaluation. This fixture makes no claim about wires or trim validity.
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

function differenceOnCubicSpan(point: (t: number) => Point, parameter: number, step: number): Point {
  // Cubic-exact one-sided difference with all four points in one span.
  const origin = point(parameter)
  const values = [1, 2, 3].map(i => point(parameter + i * step))
  return origin.map((x, axis) => [18, -9, 2].reduce((sum, weight, i) =>
    sum + weight * (values[i][axis] - x), 0) / (6 * step)) as Point
}

const tuple = (point: { x: number; y: number; z: number }): Point => [point.x, point.y, point.z]
const error = (a: Point, b: Point) => Math.hypot(...a.map((x, i) => x - b[i]))
const unit = (a: Point) => a.map(x => x / Math.hypot(...a)) as Point
const cross = (a: Point, b: Point): Point => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
]

it.each([4, 9] as const)('matches OCCT on a %i-row support, including knots, V edges and the double U seam', async rows => {
  const net = fixture(rows), evaluator = prepareExperimentalPeriodicSurfaceDerivatives(net)
  const k = await OcctKernel.init()
  try {
    const face = surface(k, net), reverse = k.reverseShape(face)
    expect(k.shapeOrientation(face)).toBe('forward')
    expect(k.shapeOrientation(reverse)).toBe('reversed')
    const samplesU = [-3, -2, -1, 0.5, 3, 4, 6, 7]
    const samplesV = rows === 4 ? [2, 3, 8] : [2, 2.5, 3, 4, 5, 6, 7, 8]
    const step = (t: number, knots: number[]) => {
      const next = knots.find(knot => knot > t)
      return next === undefined ? (knots.at(-2)! - t) / 16 : (next - t) / 16
    }
    for (const u of samplesU) for (const v of samplesV) {
      const result = evaluator.evaluate(u, v)
      const point = (s: number, t: number) => tuple(k.pointOnSurface(face, s, t))
      const du = differenceOnCubicSpan(t => point(t, v), u, step(u, net.ku))
      const dv = differenceOnCubicSpan(t => point(u, t), v, step(v, net.kv))
      expect(error(result.du, du)).toBeLessThan(1e-10)
      expect(error(result.dv, dv)).toBeLessThan(1e-10)

      const normal = tuple(k.surfaceNormal(face, u, v)), opposite = tuple(k.surfaceNormal(reverse, u, v))
      expect(Math.hypot(...result.normal)).toBeGreaterThan(0.05)
      expect(error(result.normal, cross(du, dv))).toBeLessThan(1e-9)
      expect(error(unit(result.normal), normal)).toBeLessThan(1e-11)
      expect(error(unit(result.normal), opposite.map(x => -x) as Point)).toBeLessThan(1e-11)
    }
    for (const v of samplesV) expect(evaluator.evaluate(-3, v)).toEqual(evaluator.evaluate(7, v))
    const candidate = evaluator.evaluate(0.5, 3)
    expect(Math.abs(Math.hypot(...candidate.normal) - 1)).toBeGreaterThan(0.05)
  } finally {
    k[Symbol.dispose]()
  }
})

it('evaluates clamped linear V and reports a degenerate parametric normal as zero', () => {
  const cubic = fixture(4)
  const linear: Net = {
    ...cubic, dv: 1, nv: 2, kv: [2, 8], mv: [2, 2], weights: Array<number>(12).fill(1),
    poles: Array.from({ length: 12 }, (_, i): Point => [0, 0, 6 * (i % 2)]),
  }
  const evaluator = prepareExperimentalPeriodicSurfaceDerivatives(linear)
  for (const v of [2, 5, 8]) {
    const { du, dv, normal } = evaluator.evaluate(0.5, v)
    expect(du).toEqual([0, 0, 0])
    expect(error(dv, [0, 0, 1])).toBeLessThan(1e-13)
    expect(normal.every(x => x === 0)).toBe(true)
  }
})

it('refuses C0 knots or seams, nonunit weights, invalid parameters and nonfinite coefficients', () => {
  const source = fixture(9)
  const seamCrease = { ...source, mu: [3, 1, 1, 1, 3] }
  const uCrease = { ...source, mu: [1, 1, 3, 1, 1] }
  const vCrease = { ...source, kv: [2, 2.5, 4, 5, 8], mv: [4, 1, 3, 1, 4] }
  for (const net of [seamCrease, uCrease, vCrease]) {
    expect(() => prepareExperimentalPeriodicSurfaceDerivatives(net)).toThrow(/C1/)
  }
  const weights = structuredClone(source)
  weights.rational = [1, 0]
  weights.weights[0] = 2
  expect(() => prepareExperimentalPeriodicSurfaceDerivatives(weights)).toThrow(/pesi unitari/)

  const nonfinite = structuredClone(source)
  nonfinite.poles[0][0] = Infinity
  expect(() => prepareExperimentalPeriodicSurfaceDerivatives(nonfinite)).toThrow(/reticolo/)
  nonfinite.poles[0][0] = -Number.MAX_VALUE
  nonfinite.poles[nonfinite.nv][0] = Number.MAX_VALUE
  expect(() => prepareExperimentalPeriodicSurfaceDerivatives(nonfinite)).toThrow(/coefficiente.*non finito/)

  const evaluator = prepareExperimentalPeriodicSurfaceDerivatives(source)
  expect(() => evaluator.evaluate(8, 3)).toThrow(/fuori periodo/)
  expect(() => evaluator.evaluate(NaN, 3)).toThrow(/fuori periodo/)
  expect(() => evaluator.evaluate(0, 9)).toThrow(/fuori intervallo V/)
  expect(() => evaluator.evaluate(0, Infinity)).toThrow(/fuori intervallo V/)
})

it('refuses an unrepresentable derivative scale or normal without masking overflow', () => {
  const source = fixture(4)
  const tinyV = { ...source, kv: [0, 1e-309] }
  expect(() => prepareExperimentalPeriodicSurfaceDerivatives(tinyV)).toThrow(/scala della derivata/)

  const huge = { ...source, poles: source.poles.map(p => p.map(x => x * 1e155) as Point) }
  const evaluator = prepareExperimentalPeriodicSurfaceDerivatives(huge)
  expect(() => evaluator.evaluate(0.5, 3)).toThrow(/normale.*non finita/)
})
