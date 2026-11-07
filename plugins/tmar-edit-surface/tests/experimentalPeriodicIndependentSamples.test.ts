// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { mapPeriodicKnotsAffineRounded } from '../experimentalPeriodicAffineKnotMap'
import { generateExperimentalPeriodicIndependentSamples } from '../experimentalPeriodicIndependentSamples'
import type { ExperimentalPeriodicIndependentSamplesRequest } from '../experimentalPeriodicIndependentSamples'

const fixture: ExperimentalPeriodicIndependentSamplesRequest = {
  edgePeriod: [0, 4],
  lateral: { knots: [0, .5, 1, 1 + 2 ** -40, 2.5, 4], uAtEdgeEnds: [0, 4] },
  support: { knots: [20, 23, 26 - 2 ** -41, 26 - 2 ** -44, 27, 28], uAtEdgeEnds: [28, 20] },
  training: { perSpan: 2, minimumInterior: 18 },
  holdout: { perSpan: 1, minimumInterior: 10 },
  searchDepth: 6,
  maxAttempts: 2048,
}

describe('experimental independent periodic sample grids', () => {
  it('covers narrow nonuniform spans independently after rounded maps with opposite orientations', () => {
    const request = structuredClone(fixture)
    const result = generateExperimentalPeriodicIndependentSamples(request)
    expect(result.status).toBe('generated')
    if (result.status !== 'generated') throw new Error(result.reason)
    expect(result.attempts).toBeLessThanOrEqual(request.maxAttempts)
    expect(generateExperimentalPeriodicIndependentSamples(request)).toEqual(result)
    expect(request).toEqual(fixture)

    for (const [axis, start, end, direction] of [['lateral', 0, 4, 1], ['support', -28, -20, -1]] as const) {
      const knots = request[axis].knots
      const used = new Set<number>()
      for (const group of ['training', 'holdout'] as const) {
        const grid = result[group]
        expect([grid[0], grid.at(-1)]).toEqual(request.edgePeriod)
        expect(grid.length - 2).toBeGreaterThanOrEqual(request[group].minimumInterior)
        const mapped = mapPeriodicKnotsAffineRounded(grid, start, end).knots.map(u => direction * u)
        expect([mapped[0], mapped.at(-1)]).toEqual(request[axis].uAtEdgeEnds)
        const counts = knots.slice(1).map(() => 0)
        for (const u of mapped.slice(1, -1)) {
          expect(used.has(u)).toBe(false)
          used.add(u)
          const span = knots.findIndex((first, index) => first < u && u < knots[index + 1])
          expect(span).toBeGreaterThanOrEqual(0)
          counts[span]++
        }
        expect(counts).toEqual(result.coverage[group][axis])
        for (const count of counts) expect(count).toBeGreaterThanOrEqual(request[group].perSpan)
      }
    }
  })

  it('refuses a native span with adjacent binary64 endpoints', () => {
    const result = generateExperimentalPeriodicIndependentSamples({ ...fixture, lateral: {
      knots: [1, 1 + Number.EPSILON, 2], uAtEdgeEnds: [1, 2],
    } })
    expect(result).toMatchObject({ status: 'inconclusive', reason: 'no-binary64-knot-span-interior', at: { axis: 'lateral', span: 0 } })
    expect(result).not.toHaveProperty('training')
    expect(result).not.toHaveProperty('holdout')
  })

  it('refuses an edge with zero or too few distinct binary64 interior parameters', () => {
    const adjacent = generateExperimentalPeriodicIndependentSamples({ ...fixture, edgePeriod: [1, 1 + Number.EPSILON] })
    expect(adjacent).toMatchObject({ status: 'inconclusive', reason: 'no-binary64-edge-interior' })

    const oneInterior: ExperimentalPeriodicIndependentSamplesRequest = {
      ...fixture,
      edgePeriod: [1, 1 + 2 * Number.EPSILON],
      lateral: { knots: [0, 1], uAtEdgeEnds: [0, 1] },
      support: { knots: [2, 3], uAtEdgeEnds: [3, 2] },
      training: { perSpan: 1, minimumInterior: 1 },
      holdout: { perSpan: 1, minimumInterior: 1 },
    }
    const insufficient = generateExperimentalPeriodicIndependentSamples(oneInterior)
    expect(insufficient).toMatchObject({ status: 'inconclusive', reason: 'insufficient-independent-coverage' })
    expect(insufficient).not.toHaveProperty('training')
    expect(insufficient).not.toHaveProperty('holdout')
  })

  it('caps candidate trials and refuses quotas beyond the consumer grid cap', () => {
    expect(generateExperimentalPeriodicIndependentSamples({ ...fixture, maxAttempts: 1 })).toMatchObject({
      status: 'inconclusive', reason: 'candidate-budget-exhausted', attempts: 1,
    })
    expect(generateExperimentalPeriodicIndependentSamples({ ...fixture, training: { perSpan: 4094, minimumInterior: 1 } })).toMatchObject({
      status: 'inconclusive', reason: 'coverage-exceeds-sampler-cap', attempts: 0,
    })
  })

  it('rejects partial maps, malformed knots and nonfinite budgets', () => {
    expect(() => generateExperimentalPeriodicIndependentSamples({ ...fixture, support: { ...fixture.support, uAtEdgeEnds: [27, 20] } })).toThrow(/intero periodo/)
    expect(() => generateExperimentalPeriodicIndependentSamples({ ...fixture, lateral: { ...fixture.lateral, knots: [0, , 4] as number[] } })).toThrow(/nodi/)
    expect(() => generateExperimentalPeriodicIndependentSamples({ ...fixture, maxAttempts: Infinity })).toThrow(/budget/)
  })
})
