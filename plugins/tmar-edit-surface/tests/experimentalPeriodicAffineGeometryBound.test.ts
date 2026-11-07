// SPDX-License-Identifier: AGPL-3.0-only
import { OcctKernel } from 'occt-wasm'
import { expect, it, vi } from 'vitest'
import { boundPeriodicAffineMapGeometry } from '../experimentalPeriodicAffineGeometryBound'

it('bounds all spans of a periodic polygon, including its fastest closing segment', async () => {
  const kernel = await OcctKernel.init()
  try {
    const poles = [0, 0, 0, 0, 1, 0, 0, 4, 0, 100, 0, 0]
    const knots = [0, 0.3, 1, 2.5, 3]
    const target = kernel.makeBSplineEdge(poles, [], knots, knots.map(() => 1), 1, true)
    const brep = kernel.toBREP(target), shapeCount = kernel.shapeCount
    const result = boundPeriodicAffineMapGeometry(kernel, target, [0, 1, 10])

    // The first interior map image rounds down to a corner of the target.
    // The exact image 3/10 is on the other side of that parameter value.
    expect(result.knots).toEqual([0, 0.3, 3])
    expect(result.checkedTargetSpans).toBe(4)
    expect(result.maxParameterError).toBeGreaterThan(0)
    expect(result.maxTargetSpeedBound).toBeGreaterThanOrEqual(200)
    expect(result.maxTargetSpeedBound).toBeLessThan(200 + 1e-10)
    expect(result.maxPositionError).toBeGreaterThanOrEqual(200 * result.maxParameterError)
    expect(result.maxPositionError).toBeLessThan(201 * result.maxParameterError)
    expect(kernel.toBREP(target)).toBe(brep)
    expect(kernel.shapeCount).toBe(shapeCount)
  } finally {
    kernel[Symbol.dispose]()
  }
})

it.each([
  { mult: [1, 1, 1, 1, 1], widths: [8, 6, 7, 9], xy: [[0, 0], [8, 0], [8, 12], [1, 12]] },
  { mult: [2, 1, 2, 1, 2], widths: [4, 3, 3, 6, 7, 7],
    xy: [[0, 0], [8, 0], [8, 12], [1, 12], [0, 9], [0, 3]] },
])('uses the wrapped cubic derivative denominators for multiplicities $mult', async ({ mult, widths, xy }) => {
  const kernel = await OcctKernel.init()
  try {
    const poles = xy.flatMap(([x, y]) => [x, y, 0])
    const knots = [2, 3, 5, 9, 12]
    const target = kernel.makeBSplineEdge(poles, [], knots, mult, 3, true)
    const result = boundPeriodicAffineMapGeometry(kernel, target, [0, 1, 3])

    // Use the hand-expanded widths of the repeated periodic knot sequence.
    const expected = Math.max(...xy.map(([x, y], i) => {
      const [nextX, nextY] = xy[(i + 1) % xy.length]
      return 3 * (Math.abs(nextX - x) + Math.abs(nextY - y)) / widths[i]
    }))
    expect(result.checkedTargetSpans).toBe(4)
    expect(result.maxTargetSpeedBound).toBeGreaterThanOrEqual(expected)
    expect(result.maxTargetSpeedBound).toBeLessThan(expected + 1e-12)
    expect(result.maxPositionError).toBeGreaterThanOrEqual(expected * result.maxParameterError)
    expect(boundPeriodicAffineMapGeometry(kernel, target, [0, 1, 2])).toMatchObject({
      knots: [2, 7, 12], maxParameterError: 0, maxPositionError: 0, checkedTargetSpans: 4,
    })
  } finally {
    kernel[Symbol.dispose]()
  }
})

it('keeps wrapped differences finite even when a shifted knot would overflow', async () => {
  const kernel = await OcctKernel.init()
  try {
    const poles = [0, 0, 0, 8, 0, 0, 8, 12, 0, 1, 12, 0]
    const knots = [1e308, 1.1e308, 1.2e308, 1.3e308, 1.4e308]
    const target = kernel.makeBSplineEdge(poles, [], knots, knots.map(() => 1), 3, true)
    const result = boundPeriodicAffineMapGeometry(kernel, target, [0, 1, 7])
    expect(result.checkedTargetSpans).toBe(4)
    expect(result.maxPositionError).toBeGreaterThan(0)
    expect(result.maxPositionError).toBeLessThan(1e-12)
  } finally {
    kernel[Symbol.dispose]()
  }
})

it('refuses unsupported targets, collisions and unprovable interval arithmetic', async () => {
  const kernel = await OcctKernel.init()
  try {
    const poles = [0, 0, 0, 8, 0, 0, 8, 12, 0, 1, 12, 0]
    const knots = [2, 3, 5, 9, 12], mult = knots.map(() => 1)
    const target = kernel.makeBSplineEdge(poles, [], knots, mult, 3, true)
    const rational = kernel.makeBSplineEdge(poles, [1, 2, 1, 2], knots, mult, 3, true)
    const overflow = kernel.makeBSplineEdge(
      [-1e308, 0, 0, 1e308, 0, 0, 1e308, 12, 0, -1e308, 12, 0], [], knots, mult, 3, true)
    const brep = kernel.toBREP(target)
    const trimmedBrep = brep.replace(/^(1\s+1 0 2) 12$/m, '$1 9')
    expect(trimmedBrep).not.toBe(brep)
    const trimmed = kernel.fromBREP(trimmedBrep)

    expect(() => boundPeriodicAffineMapGeometry(kernel, target, [0, Number.MIN_VALUE, 3])).toThrow(/Collisione/)
    expect(() => boundPeriodicAffineMapGeometry(kernel, rational, [0, 1, 3])).toThrow(/non razionale/)
    expect(() => boundPeriodicAffineMapGeometry(kernel, trimmed, [0, 1, 3])).toThrow(/periodo intero/)
    expect(() => boundPeriodicAffineMapGeometry(kernel, overflow, [0, 1, 3])).toThrow(/overflow/)
  } finally {
    kernel[Symbol.dispose]()
  }
})

it('refuses a sparse pole array returned by the coefficient reader', async () => {
  const kernel = await OcctKernel.init()
  try {
    const poles = [0, 0, 0, 8, 0, 0, 8, 12, 0, 1, 12, 0]
    const knots = [2, 3, 5, 9, 12]
    const target = kernel.makeBSplineEdge(poles, [], knots, knots.map(() => 1), 3, true)
    const coefficients = kernel.getNurbsCurveData(target)
    vi.spyOn(kernel, 'getNurbsCurveData').mockReturnValue({
      ...coefficients, poles: Array<number>(coefficients.poles.length),
    })

    expect(() => boundPeriodicAffineMapGeometry(kernel, target, [0, 1, 3])).toThrow(/coefficienti mancanti/)
  } finally {
    kernel[Symbol.dispose]()
  }
})

it('refuses fewer poles per period than the degree', async () => {
  const kernel = await OcctKernel.init()
  try {
    const knots = [0, 1, 3], multiplicities = [1, 1, 1]
    const poles = [0, 0, 0, 8, 0, 0]
    const cubic = kernel.makeBSplineEdge(poles, [], knots, multiplicities, 3, true)
    expect(() => boundPeriodicAffineMapGeometry(kernel, cubic, [0, 1, 7])).toThrow(/poli inferiore al grado/)

    const quadratic = kernel.makeBSplineEdge(poles, [], knots, multiplicities, 2, true)
    expect(boundPeriodicAffineMapGeometry(kernel, quadratic, [0, 1, 7]).checkedTargetSpans).toBe(2)
  } finally {
    kernel[Symbol.dispose]()
  }
})
