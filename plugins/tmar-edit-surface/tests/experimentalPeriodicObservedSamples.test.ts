// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { mapPeriodicKnotsAffineRounded } from '../experimentalPeriodicAffineKnotMap'
import { generateExperimentalPeriodicIndependentSamples, generateExperimentalPeriodicObservedSamples,
  type ExperimentalPeriodicObservedSamplesRequest } from '../experimentalPeriodicIndependentSamples'
import { boundExperimentalPeriodicUObservationGram } from '../experimentalPeriodicUObservationGram'

function fixture(lateralSpans: number, supportSpans: number, supportExponent: number, perSpan = 3): ExperimentalPeriodicObservedSamplesRequest {
  return {
    edgePeriod: [-2, 3],
    lateral: { knots: Array.from({ length: lateralSpans + 1 }, (_, i) => 4 * (i / lateralSpans) ** 2), uAtEdgeEnds: [0, 4] },
    support: { knots: Array.from({ length: supportSpans + 1 }, (_, i) => 5 + 7 * (i / supportSpans) ** supportExponent), uAtEdgeEnds: [12, 5] },
    training: { perSpan, minimumInterior: 10 }, holdout: { perSpan: 2, minimumInterior: 8 },
    searchDepth: 6, maxAttempts: 4096,
    observation: { degree: 3, multiplicities: [3, ...Array<number>(lateralSpans - 1).fill(1), 3],
      maxComparisons: 6000, maxRows: 200, maxFreeColumns: 64 },
  }
}

it.each([[12, 7, 1.5], [16, 11, 1.4]])('strictly improves the certified Gram inverse norm on unequal %i/%i-span designs',
  (lateralSpans, supportSpans, supportExponent) => {
    const request = fixture(lateralSpans, supportSpans, supportExponent), before = structuredClone(request)
    const greedy = generateExperimentalPeriodicIndependentSamples(request)
    const result = generateExperimentalPeriodicObservedSamples(request)
    if (greedy.status !== 'generated' || result.status !== 'generated') throw new Error(JSON.stringify({ greedy, result }))
    const report = result.observation
    if (!report || report.baseline.status !== 'certified-full-rank' || report.trial?.status !== 'certified-full-rank')
      throw new Error(JSON.stringify(report))
    expect(report.selection).toBe('certified-improvement')
    expect(report.trial.inverseInfinityNormUpper).toBeLessThan(report.baseline.inverseInfinityNormLower)
    expect(report.trial.size).toEqual(report.baseline.size)
    expect(report.baselineAttempts).toBe(greedy.attempts)
    expect(result.attempts).toBeLessThanOrEqual(request.maxAttempts)
    expect(report.comparisons).toBeLessThanOrEqual(request.observation.maxComparisons)
    expect(report.proposedExchanges).toBeGreaterThan(0)
    expect(result.training).not.toEqual(greedy.training)
    expect(result.training.length).toBe(greedy.training.length)
    expect(result.holdout).toEqual(greedy.holdout)
    expect(result.coverage).toEqual(greedy.coverage)

    const lateral = (grid: readonly number[]) => mapPeriodicKnotsAffineRounded(grid, 0, 4).knots
    const support = (grid: readonly number[]) => mapPeriodicKnotsAffineRounded(grid, -12, -5).knots.map(u => -u)
    for (const [map, axis] of [[lateral, request.lateral], [support, request.support]] as const) {
      const train = map(result.training), holdout = map(result.holdout)
      expect([train[0], train.at(-1)]).toEqual(axis.uAtEdgeEnds)
      expect([holdout[0], holdout.at(-1)]).toEqual(axis.uAtEdgeEnds)
      const interior = [...train.slice(1, -1), ...holdout.slice(1, -1)]
      expect(new Set(interior).size).toBe(interior.length)
    }
    const gram = (grid: readonly number[]) => boundExperimentalPeriodicUObservationGram({
      ...request.observation, knots: request.lateral.knots, parameters: lateral(grid).slice(0, -1),
    })
    expect(report.baseline).toEqual(gram(greedy.training))
    expect(report.trial).toEqual(gram(result.training))
    expect(generateExperimentalPeriodicObservedSamples(request)).toEqual(result)
    expect(request).toEqual(before)
  })

it('retains the greedy baseline when the proposed mass-improving exchanges worsen the certified Gram metric', () => {
  const request = fixture(9, 6, 0.7, 2)
  const greedy = generateExperimentalPeriodicIndependentSamples(request)
  const result = generateExperimentalPeriodicObservedSamples(request)
  if (greedy.status !== 'generated' || result.status !== 'generated') throw new Error(JSON.stringify({ greedy, result }))
  const report = result.observation
  if (!report || report.baseline.status !== 'certified-full-rank' || report.trial?.status !== 'certified-full-rank')
    throw new Error(JSON.stringify(report))
  expect(report.selection).toBe('baseline-retained')
  expect(report.proposedExchanges).toBeGreaterThan(0)
  expect(report.trial.inverseInfinityNormLower).toBeGreaterThan(report.baseline.inverseInfinityNormUpper)
  expect(result.training).toEqual(greedy.training)
  expect(result.holdout).toEqual(greedy.holdout)
})

it('honors both work caps and withholds grids when the baseline Gram cannot be certified', () => {
  const request = fixture(12, 7, 1.5)
  request.maxAttempts = 300
  request.observation.maxComparisons = 1
  const result = generateExperimentalPeriodicObservedSamples(request)
  expect(result).toMatchObject({ status: 'generated', attempts: 300, observation: {
    selection: 'baseline-retained', comparisons: 1, comparisonBudgetExhausted: true,
  } })
  request.observation.maxRows = 1
  const refused = generateExperimentalPeriodicObservedSamples(request)
  expect(refused).toMatchObject({ status: 'inconclusive', reason: 'observation-gram-inconclusive', observation: {
    selection: 'baseline-not-certified', baseline: { status: 'inconclusive', reason: 'work-budget' }, comparisons: 0,
  } })
  expect(refused).not.toHaveProperty('training')
  expect(refused).not.toHaveProperty('holdout')
})
