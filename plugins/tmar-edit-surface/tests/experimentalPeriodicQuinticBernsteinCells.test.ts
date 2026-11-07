// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { boundExperimentalBernsteinPatchNormals } from '../experimentalBernsteinPatchNormalBound'
import { extractExperimentalPeriodicQuinticBernsteinCell } from '../experimentalPeriodicQuinticBernsteinCells'
import type { V } from '../tangencyCoefficientIntervals'

function net(ku = [0, 1, 2, 4], mu = [2, 1, 1, 2], kv = [0, 1, 2, 4], mv = [6, 2, 1, 6]): Net {
  const full = kv.flatMap((knot, i) => Array<number>(mv[i]).fill(knot))
  const nv = full.length - 6
  const heights = Array.from({ length: nv }, (_, i) => full.slice(i + 1, i + 6).reduce((sum, knot) => sum + knot, 0))
  return {
    du: 2, dv: 5, nu: 4, nv, periodic: [1, 0], rational: [0, 0], ku, mu, kv, mv,
    poles: [[0, 0], [2, 1], [3, 4], [-1, 3]].flatMap(([x, y], u) =>
      heights.map((z): Point => [x, y, (u + 1) * z])),
    weights: Array<number>(4 * nv).fill(1),
  }
}

function expectControl(control: V, origin: Point, expected: Point) {
  for (const [axis, [lo, hi]] of control.entries()) {
    const relative = expected[axis] - origin[axis]
    expect(lo).toBeLessThanOrEqual(relative)
    expect(hi).toBeGreaterThanOrEqual(relative)
    expect(hi - lo).toBeLessThan(1e-10)
  }
}

it.each([2, 3])('extracts both degree-%s Bézier seam pieces in periodic pole order', degree => {
  const base = net([0, 1, 3], [2, 2, 2], [0, 1], [6, 6])
  const original: Net = { ...base, du: degree, nu: 2 * degree, mu: [degree, degree, degree],
    poles: Array.from({ length: 2 * degree }, (_, u) => Array.from({ length: 6 }, (_, v): Point =>
      [u, u * u, (u + 1) * v])).flat(),
    weights: Array<number>(2 * degree * 6).fill(1) }
  const candidate = structuredClone(original)
  candidate.poles[degree * 6 + 3][2] += 1
  const before = structuredClone({ original, candidate })
  for (const uSpan of [0, 1]) {
    const rows = Array.from({ length: degree + 1 }, (_, i) => (uSpan * degree + i) % original.nu)
    const result = extractExperimentalPeriodicQuinticBernsteinCell(original, candidate, uSpan, 0)
    expect(result.original).toMatchObject({ degreeU: degree, degreeV: 5 })
    expect(result.original.controls).toHaveLength((degree + 1) * 6)
    expect(result.uDomain).toEqual([original.ku[uSpan], original.ku[uSpan + 1]])
    expect(result.vDomain).toEqual([0, 1])
    for (const [i, u] of rows.entries()) for (let v = 0; v < 6; v++) {
      expectControl(result.original.controls[i * 6 + v], result.origin, original.poles[u * 6 + v])
      expectControl(result.candidate.controls[i * 6 + v], result.origin, candidate.poles[u * 6 + v])
    }
  }
  expect({ original, candidate }).toEqual(before)
})

it('encloses analytic tensor controls on mixed U spans and a repeated-knot V basis', () => {
  const original = net(), candidate = structuredClone(original)
  for (const point of candidate.poles) point[2] *= 2
  // The third coordinate is a product of a U spline with coefficients
  // [1,2,3,4] and the linear field 5V. These U Bézier controls follow from
  // the endpoint derivatives and the neighboring span widths.
  const uControls = [
    [[0, 0, 1], [2, 1, 2], [2.5, 2.5, 2.5]],
    [[5 / 3, 11 / 3, 10 / 3], [-1, 3, 4], [0, 0, 1]],
  ]
  for (const [i, uSpan] of [0, 2].entries()) {
    const result = extractExperimentalPeriodicQuinticBernsteinCell(original, candidate, uSpan, 1)
    expect(result.vDomain).toEqual([1, 2])
    for (const [u, [x, y, scale]] of uControls[i].entries()) for (let v = 0; v < 6; v++) {
      expectControl(result.original.controls[u * 6 + v], result.origin, [x, y, scale * (5 + v)])
      expectControl(result.candidate.controls[u * 6 + v], result.origin, [x, y, 2 * scale * (5 + v)])
    }
  }
  const cell = extractExperimentalPeriodicQuinticBernsteinCell(original, candidate, 0, 1)
  expect(boundExperimentalBernsteinPatchNormals(cell.candidate, cell.original).status).toBe('certified-positive')
})

it('uses local U differences when explicitly extending the periodic knots would overflow', () => {
  const unit = 2 ** 1019, origin = 27 * unit
  const original = net(), moved = net(original.ku.map(knot => origin + knot * unit))
  expect(moved.ku[1] + (moved.ku.at(-1)! - moved.ku[0])).toBe(Infinity)
  const ordinary = extractExperimentalPeriodicQuinticBernsteinCell(original, original, 2, 2)
  const shifted = extractExperimentalPeriodicQuinticBernsteinCell(moved, moved, 2, 2)
  for (const [i, point] of ordinary.original.controls.entries()) for (let axis = 0; axis < 3; axis++) {
    const [lo, hi] = shifted.original.controls[i][axis]
    expect(lo).toBeLessThanOrEqual(point[axis][1])
    expect(hi).toBeGreaterThanOrEqual(point[axis][0])
    expect(hi - lo).toBeLessThan(1e-10)
  }
})

it('declines incompatible inputs and intervals that cannot be enclosed', () => {
  const original = net(), candidate = structuredClone(original)
  expect(() => extractExperimentalPeriodicQuinticBernsteinCell(original, candidate, 3, 0)).toThrow(/indice della cella/)
  expect(() => extractExperimentalPeriodicQuinticBernsteinCell(original, net([0, 0.5, 2, 4]), 0, 0)).toThrow(/basi U\/V/)
  const smoothSeam = net([0, 1, 2, 4], [1, 2, 1, 1])
  expect(() => extractExperimentalPeriodicQuinticBernsteinCell(smoothSeam, smoothSeam, 0, 0)).toThrow(/cucitura U satura/)
  candidate.rational = [1, 0]
  candidate.weights[0] = 2
  expect(() => extractExperimentalPeriodicQuinticBernsteinCell(original, candidate, 0, 0)).toThrow(/pesi unitari/)
  const tiny = net([0, Number.MIN_VALUE, 2 * Number.MIN_VALUE, 1])
  expect(() => extractExperimentalPeriodicQuinticBernsteinCell(tiny, tiny, 0, 0)).toThrow(/overflow/)
})
