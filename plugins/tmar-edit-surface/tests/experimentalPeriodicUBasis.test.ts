// SPDX-License-Identifier: AGPL-3.0-only
import { OcctKernel } from 'occt-wasm'
import { expect, it } from 'vitest'
import { prepareExperimentalPeriodicUBasis } from '../experimentalPeriodicUBasis'

it.each([
  { multiplicities: [1, 1, 1, 1, 1], lastIndices: [3, 0, 1, 2] },
  { multiplicities: [2, 1, 2, 1, 2], lastIndices: [4, 5, 0, 1] },
])('uses OCCT pole order for nonuniform cubic spans with multiplicities $multiplicities', async ({
  multiplicities, lastIndices,
}) => {
  const kernel = await OcctKernel.init()
  try {
    const knots = [-3, -1, 0.5, 4, 7]
    const degree = 3
    const basis = prepareExperimentalPeriodicUBasis(degree, knots, multiplicities)
    const poles = [[3, 1, -2], [0, -2, 4], [7, 0, 1], [-5, 4, 2], [2, 7, -1], [9, -3, 6]]
      .slice(0, basis.poleCount)
    const edge = kernel.makeBSplineEdge(poles.flat(), [], knots, multiplicities, degree, true)
    const points = knots.slice(0, -1).flatMap((a, i) => {
      const b = knots[i + 1]
      return [a, a + (b - a) / 8, (a + b) / 2, b - (b - a) / 8]
    })
    points.push(knots[0] + 2 ** -20, knots.at(-1)! - 2 ** -20, knots.at(-1)!)

    expect(basis.evaluate(knots[0]).indices).toEqual([0, 1, 2, 3])
    expect(basis.evaluate(6).indices).toEqual(lastIndices)
    expect(basis.evaluate(knots.at(-1)!)).toEqual(basis.evaluate(knots[0]))
    for (const parameter of points) {
      const { indices, values } = basis.evaluate(parameter)
      expect(values.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 13)
      const point = kernel.curvePointAtParam(edge, parameter)
      for (const [axis, coordinate] of [point.x, point.y, point.z].entries()) {
        const value = indices.reduce((sum, i, j) => sum + values[j] * poles[i][axis], 0)
        expect(value).toBeCloseTo(coordinate, 11)
      }
    }
  } finally {
    kernel[Symbol.dispose]()
  }
})

it('refuses invalid or numerically collapsed bases and out-of-period parameters', () => {
  const sparse = [0, 1, 2]
  delete sparse[1]
  expect(() => prepareExperimentalPeriodicUBasis(1.5, [0, 1, 2], [1, 1, 1])).toThrow(/grado/)
  expect(() => prepareExperimentalPeriodicUBasis(1, sparse, [1, 1, 1])).toThrow(/nodi/)
  expect(() => prepareExperimentalPeriodicUBasis(2, [0, 1, 2], [1, 1, 2])).toThrow(/base/)
  expect(() => prepareExperimentalPeriodicUBasis(2, [0, 1, 2], [1, 1, 1])).toThrow(/poli/)
  expect(() => prepareExperimentalPeriodicUBasis(1, [0, 1, 1], [1, 1, 1])).toThrow(/nodi/)
  expect(() => prepareExperimentalPeriodicUBasis(1, [0, Number.MIN_VALUE, 1e300], [1, 1, 1]))
    .toThrow(/intervallo locale/)
  const basis = prepareExperimentalPeriodicUBasis(1, [0, 1, 2], [1, 1, 1])
  expect(() => basis.evaluate(-1)).toThrow(/fuori periodo/)
  expect(() => basis.evaluate(3)).toThrow(/fuori periodo/)
  expect(() => basis.evaluate(NaN)).toThrow(/fuori periodo/)
})

it('refuses a positive span with an overflowing reciprocal during preparation', () => {
  const multiplicities = [1, 1, 1]
  expect(() => prepareExperimentalPeriodicUBasis(1, [0, 1e-309, 1], multiplicities))
    .toThrow(/reciproco dello span/)

  const basis = prepareExperimentalPeriodicUBasis(1, [0, 1e-308, 1], multiplicities)
  const { indices, values } = basis.evaluate(5e-309)
  expect(indices).toEqual([0, 1])
  expect(values[0]).toBeCloseTo(0.5, 13)
  expect(values[1]).toBeCloseTo(0.5, 13)
  expect(basis.evaluate(1)).toEqual(basis.evaluate(0))
})

it('retains a translated nonuniform basis when an extended seam knot would overflow', () => {
  const unit = 2 ** 1019
  const origin = 24 * unit
  const knots = [0, 1, 3, 5, 7]
  const translated = knots.map(knot => origin + knot * unit)
  const multiplicities = [2, 1, 2, 1, 2]
  expect(translated[2] + (translated.at(-1)! - translated[0])).toBe(Infinity)
  const reference = prepareExperimentalPeriodicUBasis(3, knots, multiplicities)
  const basis = prepareExperimentalPeriodicUBasis(3, translated, multiplicities)
  for (const u of [0, 0.25, 2, 4, 6.75, 7]) {
    expect(basis.evaluate(origin + u * unit)).toEqual(reference.evaluate(u))
  }
})
