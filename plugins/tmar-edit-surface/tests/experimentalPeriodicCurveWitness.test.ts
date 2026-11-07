// SPDX-License-Identifier: AGPL-3.0-only
import { OcctKernel } from 'occt-wasm'
import { expect, it } from 'vitest'
import { comparePeriodicCurves } from '../experimentalPeriodicCurveWitness'

const poles = [0, 0, 0, 4, 0, 0, 4, 4, 0, 0, 4, 0]
const knots = [0, 4, 8, 12, 16]
const multiplicities = [1, 1, 1, 1, 1]

it('compares two periodic refinements with different knots and degrees on the original parameter interval', async () => {
  const kernel = await OcctKernel.init()
  try {
    const edge = kernel.makeBSplineEdge(poles, [], knots, multiplicities, 3, true)
    const a = kernel.curveKnotInsert(edge, 2, 1)
    const elevated = kernel.curveDegreeElevate(edge, 1)
    const b = kernel.curveKnotInsert(elevated, 0, 1)
    const snapshot = [a, b].map(h => kernel.toBREP(h))
    const shapeCount = kernel.shapeCount

    const witness = comparePeriodicCurves(kernel, a, b)
    expect(witness).toMatchObject({
      degree: 4, knots: [0, 2, 4, 8, 12, 16], multiplicities: [3, 2, 2, 2, 2, 3],
    })
    expect(witness.maxRefinedPoleDistance).toBeLessThan(1e-12)
    expect(witness.sameRefinedCoefficients).toBe(witness.maxRefinedPoleDistance === 0)
    expect([a, b].map(h => kernel.toBREP(h))).toEqual(snapshot)
    expect(kernel.shapeCount).toBe(shapeCount)
  } finally {
    kernel[Symbol.dispose]()
  }
})

it('compares refined rational curves with identical weights and rejects different weights', async () => {
  const kernel = await OcctKernel.init()
  try {
    const weights = [1, 2, 1, 2]
    const edge = kernel.makeBSplineEdge(poles, weights, knots, multiplicities, 3, true)
    const refined = kernel.curveKnotInsert(edge, 2, 2)
    expect(comparePeriodicCurves(kernel, edge, refined)).toEqual({
      degree: 3, knots: [0, 2, 4, 8, 12, 16], multiplicities: [1, 2, 1, 1, 1, 1],
      sameRefinedCoefficients: true, maxRefinedPoleDistance: 0,
    })
    const different = kernel.makeBSplineEdge(poles, [1, 3, 1, 2], knots, multiplicities, 3, true)
    const shapeCount = kernel.shapeCount
    expect(() => comparePeriodicCurves(kernel, refined, different)).toThrow(/pesi/)
    expect(kernel.shapeCount).toBe(shapeCount)
  } finally {
    kernel[Symbol.dispose]()
  }
})

it('keeps the parameter phase and rejects an offset domain, reversed edge and periodic trim', async () => {
  const kernel = await OcctKernel.init()
  try {
    const edge = kernel.makeBSplineEdge(poles, [], knots, multiplicities, 3, true)
    // Uniform knots and cyclic pole rotation give the same locus with a
    // different phase at the same parameter.
    const phased = kernel.makeBSplineEdge([...poles.slice(3), ...poles.slice(0, 3)],
      [], knots, multiplicities, 3, true)
    expect(comparePeriodicCurves(kernel, edge, phased)).toMatchObject({
      sameRefinedCoefficients: false, maxRefinedPoleDistance: 4,
    })
    const offset = kernel.makeBSplineEdge(poles, [], knots.map(k => k + 1), multiplicities, 3, true)
    expect(() => comparePeriodicCurves(kernel, edge, offset)).toThrow(/origine/)
    expect(() => comparePeriodicCurves(kernel, edge, kernel.reverseShape(edge))).toThrow(/orientamento/)
    // Keep the original periodic support and shorten the edge's 3D range.
    const brep = kernel.toBREP(edge)
    const trimmedBrep = brep.replace(/^(1\s+1 0 0) 16$/m, '$1 8')
    expect(trimmedBrep).not.toBe(brep)
    const trimmed = kernel.fromBREP(trimmedBrep)
    expect(kernel.getNurbsCurveData(trimmed).periodic).toBe(true)
    expect(kernel.curveParameters(trimmed)).toEqual({ first: 0, last: 8 })
    expect(() => comparePeriodicCurves(kernel, edge, trimmed)).toThrow(/periodo intero/)
  } finally {
    kernel[Symbol.dispose]()
  }
})

it('refuses almost coincident knots which OCCT merges during insertion', async () => {
  const kernel = await OcctKernel.init()
  try {
    const edge = kernel.makeBSplineEdge(poles, [], knots, multiplicities, 3, true)
    const a = kernel.curveKnotInsert(edge, 2, 1)
    const b = kernel.curveKnotInsert(edge, 2 + 1e-8, 1)
    const shapeCount = kernel.shapeCount
    expect(() => comparePeriodicCurves(kernel, a, b)).toThrow(/base comune richiesta/)
    expect(kernel.shapeCount).toBe(shapeCount)
  } finally {
    kernel[Symbol.dispose]()
  }
})
