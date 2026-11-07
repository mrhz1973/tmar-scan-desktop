// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { mapPeriodicKnotsAffineRounded } from '../experimentalPeriodicAffineKnotMap'
import { measureExperimentalPeriodicQuinticPairFullDomain, measureExperimentalPeriodicQuinticPairFullDomainScaled,
  type ExperimentalPeriodicQuinticPairFullDomainDiagnosticRequest } from '../experimentalPeriodicQuinticPairFullDomainDiagnostic'
import type { ExperimentalPeriodicQuinticScaledBudgets } from '../experimentalPeriodicQuinticSideDiagnostic'

function fixture(targetSlope = 8): ExperimentalPeriodicQuinticPairFullDomainDiagnosticRequest {
  const ring = [[0, 0], [1, 2 ** -35], [2, 2], [-2, 0]]
  const slopes = [5, 5, targetSlope, 5]
  const central: Net = {
    du: 2, dv: 1, nu: 4, nv: 2, periodic: [1, 0], rational: [0, 0],
    ku: [10, 12, 14, 18], mu: [2, 1, 1, 2], kv: [0, 1], mv: [2, 2],
    poles: ring.flatMap(([x, y], u): Point[] => [[x, y, 0], [x, y, slopes[u]]]), weights: Array<number>(8).fill(1),
  }
  const side = (below: boolean): ExperimentalPeriodicQuinticPairFullDomainDiagnosticRequest['atCentralV0'] => {
    const ku = below ? [0, 2, 3, 4] : [40, 43, 46, 52]
    const kv = below ? [0, 1] : [0, 1, 2, 3, 128]
    const mv = below ? [6, 6] : [6, 1, 1, 1, 6]
    const full = kv.flatMap((knot, i) => Array<number>(mv[i]).fill(knot))
    const nv = full.length - 6
    const heights = Array.from({ length: nv }, (_, i) => full.slice(i + 1, i + 6).reduce((sum, knot) => sum + knot, 0))
    const net: Net = {
      du: 2, dv: 5, nu: 4, nv, periodic: [1, 0], rational: [0, 0], ku, mu: [2, 1, 1, 2], kv, mv,
      // The lower lateral uses the reflected U knot and control order.
      poles: (below ? [0, 3, 2, 1] : [0, 1, 2, 3]).flatMap(u => {
        const [x, y] = ring[u]
        return heights.map((z): Point => [x, y, below ? (z / 5 - 1) * slopes[u] : z + slopes[u]])
      }),
      weights: Array<number>(4 * nv).fill(1),
    }
    return {
      lateral: { net, edge: below ? 'V1' : 'V0', uAtEdgeEnds: [ku[0], ku.at(-1)!] },
      centralUAtEdgeEnds: below ? [18, 10] : [10, 18], edgePeriod: below ? [-2, 2] : [0, 8], lambda: 1,
      sampleSearch: { training: { perSpan: 3, minimumInterior: 10 }, holdout: { perSpan: 2, minimumInterior: 8 },
        searchDepth: 5, maxAttempts: 512 },
      budgets: { sampledPositionGap: 1e-12, seamDerivativeGap: 1e-8, minimumPivotRatio: 0.1,
        trainingDerivativeResidual: 1e-10, holdoutDerivativeResidual: 1e-10, storageDerivativeResidual: 1e-10,
        secondDerivativeChange: 1e-10, displacement: 30, minimumSampledNormalNorm: 0.1, jointNormalChord: 1e-10 },
      normalBudget: { maxCells: 16, maxPatchChecks: 8192, maxDepth: 8 },
    }
  }
  return { central, atCentralV0: side(true), atCentralV1: side(false) }
}

it('diagnoses both sampled joints and certifies all native lateral cells before returning both candidates', () => {
  const request = fixture(), before = structuredClone(request)
  const result = measureExperimentalPeriodicQuinticPairFullDomain(request)
  expect(result).toMatchObject({ status: 'diagnostic-only', receipts: {
    sampling: { V0: { status: 'generated' }, V1: { status: 'generated' } },
    joint: { V0: { status: 'diagnostic-only' }, V1: { status: 'diagnostic-only' } },
    normals: {
      V0: { status: 'certified-positive', coverage: { certifiedCells: 3, checkedCells: 3 } },
      V1: { status: 'certified-positive', coverage: { certifiedCells: 12, checkedCells: 12 } },
    },
  } })
  if (result.status !== 'diagnostic-only') throw new Error(JSON.stringify(result))
  expect(result.candidates.V0.ku).toEqual([0, 2, 3, 4])
  expect(result.candidates.V1.ku).toEqual([40, 43, 46, 52])
  expect(result.candidates.V1.poles[2 * 9 + 1][2]).toBeCloseTo(9.6, 12)
  expect(request).toEqual(before)
})

it('stops when distinct edge observations alias in the native U map and cannot supply independent grids', () => {
  const request = fixture()
  const [first, last] = [1, 1 + 7 * Number.EPSILON]
  const t = 1 + Number.EPSILON, next = t + Number.EPSILON
  request.atCentralV0.edgePeriod = [first, last]
  const knot = 2 ** 50, end = knot + 1
  request.atCentralV0.lateral.net.ku = [knot, knot + 0.5, end]
  request.atCentralV0.lateral.net.mu = [2, 2, 2]
  request.atCentralV0.lateral.uAtEdgeEnds = [knot, end]
  expect(mapPeriodicKnotsAffineRounded([first, t, last], knot, end).knots[1]).toBe(
    mapPeriodicKnotsAffineRounded([first, next, last], knot, end).knots[1])
  request.atCentralV0.sampleSearch.training = request.atCentralV0.sampleSearch.holdout = { perSpan: 1, minimumInterior: 1 }
  const result = measureExperimentalPeriodicQuinticPairFullDomain(request)
  expect(result).toMatchObject({ status: 'inconclusive',
    stop: { stage: 'sample-search', side: 'V0', reasonCode: 'insufficient-independent-coverage' },
    receipts: { sampling: { V1: { status: 'not-run' } }, joint: { V0: { status: 'not-run' } } },
  })
  expect(result).not.toHaveProperty('candidates')
})

it('keeps the positive first lateral receipt and withholds both candidates when the second has an interior inversion', () => {
  const request = fixture(45), before = structuredClone(request)
  const result = measureExperimentalPeriodicQuinticPairFullDomain(request)
  expect(result).toMatchObject({ status: 'nonpositive-witness',
    stop: { stage: 'surface-normals', side: 'V1', reasonCode: 'nonpositive-normal-dot-witness' },
    receipts: {
      joint: { V0: { status: 'diagnostic-only' }, V1: { status: 'diagnostic-only' } },
      normals: { V0: { status: 'certified-positive' }, V1: { status: 'nonpositive-witness',
        nativeParameter: { u: { enclosure: [43, 43] }, v: { enclosure: [1, 1] } } } },
    },
  })
  expect(result).not.toHaveProperty('candidates')
  expect(result.receipts.joint.V0).not.toHaveProperty('candidate')
  expect(result.receipts.joint.V1).not.toHaveProperty('candidate')
  expect(request).toEqual(before)
})

it('preserves a second-joint refusal and skips both normal checks', () => {
  const request = fixture()
  request.atCentralV1.budgets.displacement = 0
  const result = measureExperimentalPeriodicQuinticPairFullDomain(request)
  expect(result).toMatchObject({ status: 'inconclusive',
    stop: { stage: 'joint-diagnostic', phase: 'proposal', side: 'V1', reasonCode: 'displacement-bound-exceeds-budget' },
    receipts: { joint: { V0: { status: 'diagnostic-only' } }, normals: { V0: { status: 'not-run' }, V1: { status: 'not-run' } } },
  })
  expect(result).not.toHaveProperty('candidates')
})

it('honors per-side sample-search and full-domain budgets', () => {
  const request = fixture()
  request.atCentralV1.sampleSearch.maxAttempts = 1
  const samplingStop = measureExperimentalPeriodicQuinticPairFullDomain(request)
  expect(samplingStop).toMatchObject({ status: 'inconclusive',
    stop: { stage: 'sample-search', side: 'V1', reasonCode: 'candidate-budget-exhausted' },
    receipts: { sampling: { V0: { status: 'generated' }, V1: { status: 'inconclusive', attempts: 1 } } },
  })
  expect(samplingStop).not.toHaveProperty('candidates')

  const bounded = fixture()
  bounded.atCentralV0.normalBudget.maxPatchChecks = 1
  const normalStop = measureExperimentalPeriodicQuinticPairFullDomain(bounded)
  expect(normalStop).toMatchObject({ status: 'inconclusive',
    stop: { stage: 'surface-normals', side: 'V0', reasonCode: 'patch-check-budget' },
    receipts: { normals: { V0: { coverage: { patchChecks: 0 } }, V1: { status: 'not-run' } } },
  })
  expect(normalStop).not.toHaveProperty('candidates')
})

it('rejects a shared lateral input before any work', () => {
  const request = fixture()
  request.atCentralV1.lateral.net = request.atCentralV0.lateral.net
  expect(measureExperimentalPeriodicQuinticPairFullDomain(request)).toMatchObject({ status: 'declined',
    stop: { stage: 'preflight', reasonCode: 'pair-aliased-input' },
    receipts: { sampling: { V0: { status: 'not-run' }, V1: { status: 'not-run' } } },
  })
})

function scaledFixture(slope?: number): ExperimentalPeriodicQuinticPairFullDomainDiagnosticRequest<ExperimentalPeriodicQuinticScaledBudgets> {
  const { central, atCentralV0, atCentralV1 } = fixture(slope)
  const scaled = (side: typeof atCentralV0) => {
    const { minimumPivotRatio: _minimumPivotRatio, ...budgets } = side.budgets
    return { ...side, budgets: { ...budgets,
      minimumRawColumnRmsWeight: 0.01, minimumRawColumnNormRatio: 0.1, minimumScaledPivotRatio: 0.1,
      storedHoldoutDerivativeResidual: budgets.holdoutDerivativeResidual,
    } }
  }
  return { central, atCentralV0: scaled(atCentralV0), atCentralV1: scaled(atCentralV1) }
}

it('returns both candidates only after both scaled fits and native normal checks pass', () => {
  const request = scaledFixture(), before = structuredClone(request)
  const result = measureExperimentalPeriodicQuinticPairFullDomainScaled(request)
  expect(result).toMatchObject({ status: 'diagnostic-only', receipts: {
    sampling: { V0: { status: 'generated' }, V1: { status: 'generated' } },
    joint: { V0: { status: 'diagnostic-only' }, V1: { status: 'diagnostic-only' } },
    normals: { V0: { status: 'certified-positive' }, V1: { status: 'certified-positive' } },
  } })
  if (result.status !== 'diagnostic-only') throw new Error(JSON.stringify(result))
  for (const joint of [result.receipts.joint.V0, result.receipts.joint.V1]) {
    if (joint.status !== 'diagnostic-only') throw new Error(JSON.stringify(joint))
    expect(joint.evidence.fit!.scaledPivotRatio).toBeGreaterThan(0.1)
    expect(joint.evidence.fit!.rawColumnNorms.minRmsWeight).toBeGreaterThan(0.01)
    expect(joint.evidence.fit).not.toHaveProperty('pivotRatio')
  }
  expect(result.candidates.V1.poles[2 * 9 + 1][2]).toBeCloseTo(9.6, 12)
  expect(request).toEqual(before)
})

it('withholds both candidates on a scaled-fit stop at the second lateral or an interior normal witness', () => {
  const request = scaledFixture()
  request.atCentralV1.budgets.minimumRawColumnRmsWeight = 1
  const stopped = measureExperimentalPeriodicQuinticPairFullDomainScaled(request)
  expect(stopped).toMatchObject({ status: 'declined',
    stop: { stage: 'joint-diagnostic', phase: 'fit', side: 'V1', reasonCode: 'raw-column-rms-below-budget' },
    receipts: { joint: { V0: { status: 'diagnostic-only' }, V1: { status: 'declined' } },
      normals: { V0: { status: 'not-run' }, V1: { status: 'not-run' } } },
  })

  const witness = measureExperimentalPeriodicQuinticPairFullDomainScaled(scaledFixture(45))
  expect(witness).toMatchObject({ status: 'nonpositive-witness',
    stop: { stage: 'surface-normals', side: 'V1', reasonCode: 'nonpositive-normal-dot-witness' },
    receipts: { joint: { V0: { status: 'diagnostic-only' }, V1: { status: 'diagnostic-only' } },
      normals: { V0: { status: 'certified-positive' }, V1: { status: 'nonpositive-witness',
        nativeParameter: { u: { enclosure: [43, 43] }, v: { enclosure: [1, 1] } } } } },
  })
  for (const result of [stopped, witness]) {
    expect(result).not.toHaveProperty('candidates')
    expect(result.receipts.joint.V0).not.toHaveProperty('candidate')
    expect(result.receipts.joint.V1).not.toHaveProperty('candidate')
  }
})
