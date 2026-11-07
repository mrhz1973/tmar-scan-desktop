// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { solveExperimentalPeriodicMobileSeamLeastSquares } from '../experimentalPeriodicMobileSeamLeastSquares'
import { solveExperimentalPeriodicMobileSeamPairTargets, solveExperimentalPeriodicMobileSeamTargets,
  type ExperimentalPeriodicMobileSeamPairTargetsRequest } from '../experimentalPeriodicMobileSeamTargets'
import { sampleExperimentalPeriodicGeometricSideTargets } from '../experimentalPeriodicGeometricSideTargets'
import { solveAndStoreExperimentalPeriodicMobileSeamPair, type ExperimentalPeriodicMobileSeamStoredPairRequest } from '../experimentalPeriodicMobileSeamStoredPair'
import { proposeExperimentalPeriodicQuinticFullCoordinatedSeam } from '../experimentalPeriodicQuinticSide'

function fixture(): ExperimentalPeriodicMobileSeamPairTargetsRequest {
  const spans = 8, nu = spans + 2, ku = Array.from({ length: spans + 1 }, (_, i) => i)
  const mu = [3, ...Array<number>(spans - 1).fill(1), 3]
  const ring = Array.from({ length: nu }, (_, i) => [Math.cos(2 * Math.PI * i / nu), Math.sin(2 * Math.PI * i / nu)])
  ring[1][0] = ring[nu - 1][0] = 1
  ring[nu - 1][1] = -ring[1][1]
  const reverse = [ring[0], ...ring.slice(1).reverse()]
  const central: Net = { du: 3, dv: 1, nu, nv: 2, ku: ku.map(u => 10 + 2 * u), mu, kv: [0, 1], mv: [2, 2],
    periodic: [1, 0], rational: [0, 0], weights: Array<number>(2 * nu).fill(1),
    poles: reverse.flatMap(([x, y]): Point[] => [[x / 2, y / 2, 0], [x, y, 0]]) }
  const side = (below: boolean): ExperimentalPeriodicMobileSeamPairTargetsRequest['atCentralV0'] => {
    const net: Net = { du: 3, dv: 5, nu, nv: 6, ku, mu, kv: [0, 5], mv: [6, 6], periodic: [1, 0], rational: [0, 0],
      weights: Array<number>(6 * nu).fill(1),
      poles: ring.flatMap(([x, y], u) => Array.from({ length: 6 }, (_, v): Point => {
        const r = below ? 0.5 - (5 - v) / 16 : 1 + v
        const tilt = [0, 1, 4, nu - 1].includes(u) ? (below ? (5 - v) / 64 : v / 8) : 0
        return [x * r, y * r, tilt]
      })) }
    return { strip: { net, edge: below ? 'V1' : 'V0', uAtEdgeEnds: [0, spans] }, centralUAtEdgeEnds: [26, 10],
      edgePeriod: [0, spans], training: Array.from({ length: 4 * spans + 1 }, (_, i) => i / 4),
      holdout: [0, ...Array.from({ length: 4 * spans }, (_, i) => i / 4 + 1 / 8), spans],
      budgets: { minimumTangentNorm: 1e-8, minimumTransverseNorm: 1e-8, minimumPositiveScale: 0.0625,
        maximumTangentChord: 1e-10, maximumNormalChord: 1e-6, sampledPositionGap: 1e-12, seamDerivativeGap: 1e-9,
        maximumTrainingNormalResidual: 1e-7, maximumHoldoutNormalResidual: 1e-7, maximumCoefficientChange: 0.2,
        regularization: 1e-9, maxIterations: 128, relativeStationarityTolerance: 1e-11, maxFreeColumns: 32 },
    }
  }
  return { central, atCentralV0: side(true), atCentralV1: side(false) }
}

it('estimates both target fields with mobile U0 and corrects columns outside the three-column seam neighborhood', () => {
  const request = fixture(), before = structuredClone(request)
  const fixed = sampleExperimentalPeriodicGeometricSideTargets({ ...request.atCentralV1,
    support: { net: request.central, edge: 'V1', uAtEdgeEnds: request.atCentralV1.centralUAtEdgeEnds },
    budgets: { ...request.atCentralV1.budgets, maximumNormalResidual: 1e-7 },
  })
  expect(fixed).toMatchObject({ status: 'inconclusive', reason: 'locked-u0-geometric-target-incompatible' })
  const result = solveExperimentalPeriodicMobileSeamPairTargets(request)
  if (result.status !== 'targets-only') throw new Error(JSON.stringify(result))
  for (const [edge, initial] of [['V0', 1 / 64], ['V1', 1 / 8]] as const) {
    const targets = result.targets[edge], receipt = result.receipts[edge]
    if (receipt.status !== 'targets-only') throw new Error(JSON.stringify(receipt))
    expect(receipt.evidence).toMatchObject({ freeColumns: 9, checkedTraining: 33, checkedHoldout: 32 })
    expect(receipt.evidence.maxTrainingNormalResidual).toBeLessThan(1e-7)
    expect(receipt.evidence.maxHoldoutNormalResidual).toBeLessThan(1e-7)
    expect(receipt.evidence.minimumScale).toBeGreaterThan(0.1)
    expect(Math.abs(targets[0][2])).toBeLessThan(initial / 1e5)
    expect(Math.abs(targets[4][2])).toBeLessThan(initial / 1e5)
    expect(targets[0][2] - initial).toBeCloseTo((targets[1][2] + targets.at(-1)![2]) / 2 - initial, 14)
    expect(receipt).not.toHaveProperty('coefficients')
  }
  expect(request).toEqual(before)
})

it('withholds both target fields when the second solve exceeds a movement budget', () => {
  const request = fixture()
  request.atCentralV1.budgets.maximumCoefficientChange = 0
  const result = solveExperimentalPeriodicMobileSeamPairTargets(request)
  expect(result).toMatchObject({ status: 'inconclusive', stop: { side: 'V1', phase: 'fit', reasonCode: 'coefficient-change-beyond-budget' },
    receipts: { V0: { status: 'targets-only' }, V1: { status: 'inconclusive' } },
  })
  expect(result).not.toHaveProperty('targets')
  expect(result.receipts.V0).not.toHaveProperty('coefficients')
})

it('refuses mapped alias, work-budget exhaustion and a stored-target scale floor veto', () => {
  const { central, atCentralV1: side } = fixture()
  const request = { ...side, support: { net: central, edge: 'V1' as const, uAtEdgeEnds: side.centralUAtEdgeEnds } }
  expect(solveExperimentalPeriodicMobileSeamTargets({ ...request, holdout: [0, 0.25 + 2 ** -54, 8] }))
    .toMatchObject({ status: 'inconclusive', phase: 'sampling', reasonCode: 'mapped-training-holdout-alias' })
  expect(solveExperimentalPeriodicMobileSeamTargets({ ...request, budgets: { ...request.budgets, maxIterations: 1 } }))
    .toMatchObject({ status: 'inconclusive', phase: 'fit', reasonCode: 'iteration-budget' })
  const sparse = solveExperimentalPeriodicMobileSeamTargets({ ...request, training: [0, 1, 2, 6, 7, 8] })
  expect(sparse).toMatchObject({ status: 'inconclusive', phase: 'holdout', reasonCode: 'target-joint-beyond-budget' })
  expect(sparse).not.toHaveProperty('coefficients')
  const lower = fixture().atCentralV0
  expect(solveExperimentalPeriodicMobileSeamTargets({ ...lower,
    support: { net: central, edge: 'V0', uAtEdgeEnds: lower.centralUAtEdgeEnds }, budgets: { ...lower.budgets, minimumPositiveScale: 0.5 },
  })).toMatchObject({ status: 'inconclusive', phase: 'training', reasonCode: 'target-joint-beyond-budget' })
})

it('checks the regularized solution after unscaling and refuses invalid sparse columns', () => {
  const solve = (column: number, value: number) => solveExperimentalPeriodicMobileSeamLeastSquares(
    [{ entries: [{ column, weight: 1 }], value }], 3, 0.5, 0.5, 0.25, 8, 1e-12,
  )
  const regular = solve(3, 1)
  expect(regular).toMatchObject({ status: 'solved' })
  if (regular.status !== 'solved') throw new Error(regular.reason)
  expect(regular.changes[3]).toBeCloseTo(0.8, 14)
  expect(solve(3, Number.MIN_VALUE)).toMatchObject({ status: 'inconclusive', reason: 'arithmetic-refused' })
  expect(solve(9, 1)).toMatchObject({ status: 'inconclusive', reason: 'invalid-input' })
})

function storedFixture(): ExperimentalPeriodicMobileSeamStoredPairRequest {
  const { central, atCentralV0, atCentralV1 } = fixture()
  const side = (input: typeof atCentralV0) => ({ ...input, storage: { derivativeTolerance: 1e-10, secondDerivativeTolerance: 1e-10,
    maximumDisplacement: 0.5, maximumSeamDisplacement: 0.5, normalBudget: { maxCells: 8, maxPatchChecks: 1024, maxDepth: 4 },
  } })
  return { central, atCentralV0: side(atCentralV0), atCentralV1: side(atCentralV1) }
}

it('stores an analytic full-column correction with the exact seam check, including the off-seam column', () => {
  const { atCentralV1: side } = storedFixture(), net = side.strip.net
  const targets = Array.from({ length: net.nu }, (_, u): Point => {
    const i = u * net.nv
    return [net.poles[i + 1][0] - net.poles[i][0], net.poles[i + 1][1] - net.poles[i][1], 0]
  })
  const result = proposeExperimentalPeriodicQuinticFullCoordinatedSeam({ ...side.storage, net, edge: 'V0',
    seamDerivativeTolerance: side.budgets.seamDerivativeGap, targetInward: targets,
  })
  if (result.status !== 'coefficient-proposal') throw new Error(JSON.stringify(result))
  expect(result.proposal.changedIndices).toContain(4 * net.nv + 1)
  expect(result.proposal.changedIndices).toContain(1)
  expect(result.evidence).toMatchObject({ seamJumpPreserved: true, normals: { status: 'certified-positive' } })
  targets[0][2] = 0.03125
  const incompatible = proposeExperimentalPeriodicQuinticFullCoordinatedSeam({ ...side.storage, net, edge: 'V0',
    seamDerivativeTolerance: side.budgets.seamDerivativeGap, targetInward: targets,
  })
  expect(incompatible).toMatchObject({ status: 'inconclusive', phase: 'candidate-seam', reason: 'stored-seam-jump-changed' })
  expect(incompatible).not.toHaveProperty('proposal')
})

it('rechecks actual stored training, one-sided seam and disjoint holdout on both laterals', () => {
  const request = storedFixture()
  const before = structuredClone(request)
  const result = solveAndStoreExperimentalPeriodicMobileSeamPair(request)
  if (result.status !== 'diagnostic-only') throw new Error(JSON.stringify(result))
  for (const [side, source, adjacent] of [['V0', request.atCentralV0.strip.net, 4], ['V1', request.atCentralV1.strip.net, 1]] as const) {
    expect(result.receipts[side]).toMatchObject({ status: 'diagnostic-only', evidence: {
      checkedTraining: 33, checkedHoldout: 32, storage: { seamJumpPreserved: true, normals: { status: 'certified-positive' } },
    } })
    const receipt = result.receipts[side]
    if (receipt.status !== 'diagnostic-only') throw new Error(JSON.stringify(receipt))
    expect(receipt.evidence.maxDerivativeResidualBound).toBeLessThan(1e-10)
    expect(receipt.evidence.maxSecondDerivativeChangeBound).toBeLessThan(1e-10)
    const candidate = result.candidates[side]
    expect(Math.abs(candidate.poles[adjacent][2])).toBeLessThan(1e-7)
    expect(Math.abs(candidate.poles[4 * source.nv + adjacent][2])).toBeLessThan(1e-7)
    for (let u = 0; u < source.nu; u++) for (const v of [0, source.nv - 1])
      expect(candidate.poles[u * source.nv + v]).toEqual(source.poles[u * source.nv + v])
  }
  expect(request).toEqual(before)
})

it('withholds stored candidates when the second stored seam movement exceeds budget', () => {
  const request = storedFixture()
  request.atCentralV1.storage.maximumSeamDisplacement = 0
  const result = solveAndStoreExperimentalPeriodicMobileSeamPair(request)
  expect(result).toMatchObject({ status: 'inconclusive', stop: { side: 'V1', phase: 'storage', reasonCode: 'seam-displacement-bound-exceeds-budget' },
    fitReceipts: { V0: { status: 'targets-only' }, V1: { status: 'targets-only' } },
    receipts: { V0: { status: 'diagnostic-only' }, V1: { status: 'inconclusive' } },
  })
  expect(result).not.toHaveProperty('candidates')
  expect(result).not.toHaveProperty('targets')
  expect(result.receipts.V0).not.toHaveProperty('candidate')
})
