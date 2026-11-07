// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { measureExperimentalPeriodicQuinticPair,
  type ExperimentalPeriodicQuinticPairDiagnosticRequest } from '../experimentalPeriodicQuinticPairDiagnostic'

// Insert a quadratic knot at 1/2 and reverse about the saturated seam.
function refineReverse([a, b, c, d]: Point[]): Point[] {
  return [a, d, c, b.map((x, i) => (3 * x + c[i]) / 4) as Point,
    a.map((x, i) => (x + b[i]) / 2) as Point]
}

function fixture(): ExperimentalPeriodicQuinticPairDiagnosticRequest {
  const ring: Point[] = [[0, 0, 0], [1, 2 ** -35, 0], [2, 2, 0], [-2, 0, 0]]
  const slopes = [5, 5, 8, 5]
  const centralBorder = refineReverse(ring)
  const centralSlopes = refineReverse(slopes.map((z): Point => [0, 0, z]))
  const central: Net = {
    du: 2, dv: 1, nu: 5, nv: 2, periodic: [1, 0], rational: [0, 0],
    ku: [20, 24, 26, 27, 28], mu: [2, 1, 1, 1, 2], kv: [0, 2], mv: [2, 2],
    poles: centralBorder.flatMap(([x, y], u): Point[] => [[x, y, 0], [x, y, 2 * centralSlopes[u][2]]]),
    weights: Array<number>(10).fill(1),
  }
  const lateral = (below: boolean): Net => {
    const kv = below ? [0, 2, 5, 7, 9, 12, 16, 20] : [0, 1, 3, 5, 8, 11, 14, 18]
    const last = kv.at(-1)!, full = [0, 0, 0, 0, 0, ...kv, last, last, last, last, last]
    const heights = Array.from({ length: 12 }, (_, i) => full.slice(i + 1, i + 6).reduce((sum, knot) => sum + knot, 0))
    return {
      du: 2, dv: 5, nu: 4, nv: 12, periodic: [1, 0], rational: [0, 0],
      ku: below ? [0, 1, 2, 4] : [40, 43, 46, 52], mu: [2, 1, 1, 2], kv, mv: [6, 1, 1, 1, 1, 1, 1, 6],
      poles: ring.flatMap(([x, y], u) => {
        const offset = below ? -5 * last : 2 * slopes[u]
        return heights.map((z): Point => [x, y, z + offset])
      }),
      weights: Array<number>(48).fill(1),
    }
  }
  const training = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 3.5, 4]
  const holdout = [0, 0.125, 0.375, 0.625, 0.875, 1.125, 1.625, 2.25, 2.75, 3.25, 3.75, 4]
  const side = (below: boolean): ExperimentalPeriodicQuinticPairDiagnosticRequest['atCentralV0'] => ({
    lateral: { net: lateral(below), edge: below ? 'V1' : 'V0', uAtEdgeEnds: below ? [0, 4] : [40, 52] },
    centralUAtEdgeEnds: [28, 20], edgePeriod: below ? [-2, 2] : [0, 8],
    training: training.map(t => below ? t - 2 : 2 * t),
    holdout: holdout.map(t => below ? t - 2 : 2 * t),
    lambda: 1,
    budgets: {
      sampledPositionGap: 1e-12, seamDerivativeGap: below ? 1e-9 : 5e-10, minimumPivotRatio: 0.1,
      trainingDerivativeResidual: 1e-11, holdoutDerivativeResidual: 1e-11,
      storageDerivativeResidual: 1e-11, secondDerivativeChange: 1e-11, displacement: below ? 8 : 3,
      minimumSampledNormalNorm: 0.1, jointNormalChord: 1e-10,
    },
  })
  return { central, atCentralV0: side(true), atCentralV1: side(false) }
}

it('returns two independent lateral diagnostics against an unchanged central net', () => {
  const request = fixture(), before = structuredClone(request)
  const result = measureExperimentalPeriodicQuinticPair(request)
  expect(request).toEqual(before)
  expect(result.status).toBe('diagnostic-only')
  if (result.status !== 'diagnostic-only') throw new Error(JSON.stringify(result.receipts))
  expect(result.receipts.V0).toMatchObject({ status: 'diagnostic-only', evidence: {
    fit: { fixedFirst: [0, 0, -5], freeRank: 3 },
    proposal: { maxPositionDisplacementBound: expect.closeTo(7.2, 10) },
  } })
  expect(result.receipts.V1).toMatchObject({ status: 'diagnostic-only', evidence: {
    fit: { fixedFirst: [0, 0, 5], freeRank: 3 },
    proposal: { maxPositionDisplacementBound: expect.closeTo(2.4, 10) },
  } })
  for (const [edge, source, editableRows] of [
    ['V0', request.atCentralV0.lateral.net, [9, 10]],
    ['V1', request.atCentralV1.lateral.net, [1, 2]],
  ] as const) {
    const candidate = result.candidates[edge]
    expect(candidate).not.toBe(source)
    for (const [i, point] of candidate.poles.entries()) {
      if (i < 12 || !editableRows.some(row => row === i % 12)) expect(point).toEqual(source.poles[i])
    }
    expect('candidate' in result.receipts[edge]).toBe(false)
  }
})

it('stops at V0 using its own displacement budget and leaves V1 unrun', () => {
  const request = fixture()
  request.atCentralV0.budgets.displacement = 3
  const before = structuredClone(request)
  const result = measureExperimentalPeriodicQuinticPair(request)
  expect(result).toMatchObject({ status: 'inconclusive', stoppedAt: 'V0', phase: 'proposal', receipts: {
    V0: { status: 'inconclusive', reason: expect.stringMatching(/spostamento/) },
    V1: { status: 'not-run' },
  } })
  expect('candidates' in result).toBe(false)
  expect(request).toEqual(before)
})

it('retains the first receipt and withholds both candidates when V1 stops', () => {
  const request = fixture()
  request.atCentralV1.training = [0, 1, 8]
  const before = structuredClone(request)
  const result = measureExperimentalPeriodicQuinticPair(request)
  expect(result).toMatchObject({ status: 'declined', stoppedAt: 'V1', phase: 'fit', receipts: {
    V0: { status: 'diagnostic-only' },
    V1: { status: 'declined', reason: expect.stringMatching(/rango/) },
  } })
  expect('candidates' in result).toBe(false)
  expect('candidate' in result.receipts.V0).toBe(false)
  expect(request).toEqual(before)
})

it('rejects aliased lateral inputs before either side is evaluated', () => {
  const request = fixture()
  request.atCentralV1.lateral.net = request.atCentralV0.lateral.net
  expect(measureExperimentalPeriodicQuinticPair(request)).toMatchObject({
    status: 'declined', phase: 'preflight', receipts: { V0: { status: 'not-run' }, V1: { status: 'not-run' } },
  })
})
