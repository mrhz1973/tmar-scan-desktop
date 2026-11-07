// SPDX-License-Identifier: AGPL-3.0-only
import { OcctKernel } from 'occt-wasm'
import { expect, it } from 'vitest'
import { comparePeriodicCurvesAffine } from '../experimentalPeriodicAffineCurveWitness'

const poles = [0, 0, 0, 4, 0, 0, 4, 4, 0, 0, 4, 0]
const multiplicities = [1, 1, 1, 1, 1]

it('refines offset and positively scaled supports with different knots and degrees', async () => {
  const kernel = await OcctKernel.init()
  try {
    const left = kernel.makeBSplineEdge(poles, [], [0, 6, 12, 18, 24], multiplicities, 3, true)
    const right = kernel.makeBSplineEdge(poles, [], [-20, 10, 40, 70, 100], multiplicities, 3, true)
    const a = kernel.curveKnotInsert(left, 8, 1)
    const b = kernel.curveKnotInsert(kernel.curveDegreeElevate(right, 1), 4, 1)
    const sources = [a, b].map(edge => kernel.toBREP(edge))
    const shapeCount = kernel.shapeCount

    const witness = comparePeriodicCurvesAffine(kernel, a, b)
    expect(witness).toMatchObject({
      sourceA: { first: 0, last: 24 },
      sourceB: { first: -20, last: 100 },
      comparison: { first: 0, last: 15 / 8 },
      degree: 4,
      knots: [0, 3 / 8, 15 / 32, 5 / 8, 15 / 16, 45 / 32, 15 / 8],
      multiplicities: [2, 1, 2, 2, 2, 2, 2],
    })
    expect(witness.maxRefinedPoleDistance).toBeLessThan(1e-12)
    for (let i = 0; i <= 32; i++) {
      const u = 24 * i / 32
      const p = kernel.curvePointAtParam(a, u)
      const q = kernel.curvePointAtParam(b, -20 + 5 * u)
      expect(Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z)).toBeLessThan(1e-12)
    }
    expect([a, b].map(edge => kernel.toBREP(edge))).toEqual(sources)
    expect(kernel.shapeCount).toBe(shapeCount)
  } finally {
    kernel[Symbol.dispose]()
  }
})

it('compares refined rational supports and refuses unequal weights', async () => {
  const kernel = await OcctKernel.init()
  try {
    const aKnots = [0, 4, 8, 12, 16]
    const bKnots = aKnots.map(knot => 128 + 2 * knot)
    const weights = [1, 2, 1, 2]
    const a = kernel.makeBSplineEdge(poles, weights, aKnots, multiplicities, 3, true)
    const right = kernel.makeBSplineEdge(poles, weights, bKnots, multiplicities, 3, true)
    const b = kernel.curveKnotInsert(right, 132, 2)
    const different = kernel.makeBSplineEdge(poles, [1, 3, 1, 2], bKnots, multiplicities, 3, true)
    const shapeCount = kernel.shapeCount
    const sources = [a, b, different].map(edge => kernel.toBREP(edge))

    expect(comparePeriodicCurvesAffine(kernel, a, b)).toMatchObject({
      sameRefinedCoefficients: true, maxRefinedPoleDistance: 0,
    })
    expect(() => comparePeriodicCurvesAffine(kernel, a, different)).toThrow(/pesi/)
    expect([a, b, different].map(edge => kernel.toBREP(edge))).toEqual(sources)
    expect(kernel.shapeCount).toBe(shapeCount)
  } finally {
    kernel[Symbol.dispose]()
  }
})

it('reports a phase shift on the same periodic locus', async () => {
  const kernel = await OcctKernel.init()
  try {
    const a = kernel.makeBSplineEdge(poles, [], [0, 4, 8, 12, 16], multiplicities, 3, true)
    const phased = kernel.makeBSplineEdge([...poles.slice(3), ...poles.slice(0, 3)],
      [], [128, 136, 144, 152, 160], multiplicities, 3, true)
    expect(comparePeriodicCurvesAffine(kernel, a, phased)).toMatchObject({
      sameRefinedCoefficients: false, maxRefinedPoleDistance: 4,
    })
  } finally {
    kernel[Symbol.dispose]()
  }
})

it('rejects a shortened period, mismatched orientation and an unrepresentable common period', async () => {
  const kernel = await OcctKernel.init()
  try {
    const a = kernel.makeBSplineEdge(poles, [], [0, 1, 2, 4, 6], multiplicities, 3, true)
    const reversed = kernel.reverseShape(a)
    const brep = kernel.toBREP(a)
    const trimmedBrep = brep.replace(/^(1\s+1 0 0) 6$/m, '$1 4')
    expect(trimmedBrep).not.toBe(brep)
    const trimmed = kernel.fromBREP(trimmedBrep)
    const incompatible = kernel.makeBSplineEdge(poles, [],
      [0, 1, 2, 4, 2 ** 53 - 1], multiplicities, 3, true)
    const shapeCount = kernel.shapeCount

    expect(() => comparePeriodicCurvesAffine(kernel, a, reversed)).toThrow(/orientamento/)
    expect(() => comparePeriodicCurvesAffine(kernel, a, trimmed)).toThrow(/periodo intero/)
    expect(() => comparePeriodicCurvesAffine(kernel, a, incompatible)).toThrow(/non rappresentabili/)
    expect(kernel.shapeCount).toBe(shapeCount)
  } finally {
    kernel[Symbol.dispose]()
  }
})

it('refuses overflow of the source interval or refined pole distance', async () => {
  const kernel = await OcctKernel.init()
  try {
    const hugePeriod = kernel.makeBSplineEdge(poles, [],
      [-1e308, -5e307, 0, 5e307, 1e308], multiplicities, 3, true)
    const distant = (x: number, knots: number[]) => kernel.makeBSplineEdge(
      [x, 0, 0, x, 4, 0, x, 4, 4, x, 0, 4], [], knots, multiplicities, 3, true)
    const a = distant(-1e308, [0, 4, 8, 12, 16])
    const b = distant(1e308, [1, 3, 5, 7, 9])
    const shapeCount = kernel.shapeCount

    expect(() => comparePeriodicCurvesAffine(kernel, a, hugePeriod)).toThrow(/periodo intero/)
    expect(() => comparePeriodicCurvesAffine(kernel, a, b)).toThrow(/distanza tra poli fuori intervallo/)
    expect(kernel.shapeCount).toBe(shapeCount)
  } finally {
    kernel[Symbol.dispose]()
  }
})

it('includes the placement of a located source in the compared poles', async () => {
  const kernel = await OcctKernel.init()
  try {
    const a = kernel.makeBSplineEdge(poles, [], [0, 4, 8, 12, 16], multiplicities, 3, true)
    const b = kernel.makeBSplineEdge(poles, [], [1, 3, 5, 7, 9], multiplicities, 3, true)
    const brep = kernel.toBREP(b)
    const locatedBrep = brep.replace('Locations 0', 'Locations 1\n1\n1 0 0 100\n0 1 0 0\n0 0 1 0')
      .replace(/\+1 0\s*$/, '+1 1\n')
    const located = kernel.fromBREP(locatedBrep)
    expect(kernel.toBREP(located)).toContain('Locations 1')
    expect(comparePeriodicCurvesAffine(kernel, a, located)).toMatchObject({
      sameRefinedCoefficients: false, maxRefinedPoleDistance: 100,
    })
  } finally {
    kernel[Symbol.dispose]()
  }
})
