// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { boundExperimentalCandidateHistoricalResidual } from '../experimentalCandidateHistoricalResidual'

function surface(dv: 1 | 5, z0: number, z1: number, period = 4): Net {
  const k = .5522847498307936
  const xy = [[1, 0], [1, k], [k, 1], [0, 1], [-k, 1], [-1, k], [-1, 0], [-1, -k], [-k, -1], [0, -1], [k, -1], [1, -k]]
  const nv = dv + 1
  return { du: 3, dv, nu: 12, nv, periodic: [1, 0], rational: [0, 0], ku: [0, period / 4, period / 2, 3 * period / 4, period],
    mu: [3, 3, 3, 3, 3], kv: [0, 1], mv: [dv + 1, dv + 1], weights: Array(12 * nv).fill(1),
    poles: xy.flatMap(([x, y]) => Array.from({ length: nv }, (_, v): Point => [x, y, z0 + (z1 - z0) * v / dv])) }
}
const request = () => ({ lateral: { net: surface(5, -1, 0), edge: 'V1' as const },
  support: { net: surface(1, 0, 1, 28), edge: 'V0' as const }, edgePeriod: [0, 7] as const,
  training: [0, 1.75, 3.5, 5.25, 7], holdout: [0, .875, 2.625, 4.375, 6.125, 7], maximumResidualMmPerV: 1e-3, maxPointEvaluations: 16 })

it('certifies both historical residual definitions and counts each seam limit once without transferring a continuous PASS', () => {
  const input = request(), before = structuredClone(input), r = boundExperimentalCandidateHistoricalResidual(input)
  expect(r.status).toBe('within-historical-sampled-residual-criterion')
  expect(r.groups.training.checkedPoints).toBe(5)
  expect(r.groups.holdout.checkedPoints).toBe(4)
  expect(r.checkedPoints).toBe(9)
  expect(r.parameterMappings[0].lateralParameters).toEqual([0, 1, 2, 3, 4])
  expect(r.parameterMappings[0].supportParameters).toEqual([0, 7, 14, 21, 28])
  expect(r.continuousResidualCertified).toBe(false)
  expect(r.oldPassTransferred).toBe(false)
  expect(input).toEqual(before)
})

it('records an interval witness for an actual sampled residual excess while still visiting the independent holdout', () => {
  const input = request()
  for (let u = 0; u < input.lateral.net.nu; u++) input.lateral.net.poles[u * input.lateral.net.nv + 4][0] += .01
  const r = boundExperimentalCandidateHistoricalResidual(input)
  expect(r.status).toBe('outside-historical-sampled-residual-criterion')
  expect(r.witnesses.some(w => w.combined[0] > input.maximumResidualMmPerV)).toBe(true)
  expect(r.checkedPoints).toBe(9)
  expect(r.groups.holdout.checkedPoints).toBe(4)
})

it('refuses aliased historical sets and insufficient point budgets before evaluating jets', () => {
  const input = request()
  expect(() => boundExperimentalCandidateHistoricalResidual({ ...input, holdout: [0, 1.75, 7] })).toThrow('mapped-training-holdout-alias')
  expect(() => boundExperimentalCandidateHistoricalResidual({ ...input, maxPointEvaluations: 8 })).toThrow('point-budget')
  expect(() => boundExperimentalCandidateHistoricalResidual({ ...input, training: [0, 1, 1, 7] })).toThrow('original-parameter-set-invalid')
})

it('suppresses whole-group residual uppers when a degenerate support prevents enclosing points', () => {
  const input = request()
  for (const p of input.support.net.poles) p[2] = 0
  const r = boundExperimentalCandidateHistoricalResidual(input)
  expect(r.status).toBe('inconclusive')
  expect(r.checkedPoints).toBe(9)
  expect(r.groups.training.boundedPoints).toBe(0)
  expect(r.groups.training.boundsComplete).toBe(false)
  expect(r.groups.training.maximumCombinedResidual).toBeNull()
  expect(r.groups.holdout.maximumProjectedResidual).toBeNull()
  expect(r.groups.holdout.diagnosticOnlyPartialMaxima).not.toBeNull()
})
