// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { boundExperimentalPeriodicQuinticSurfaceNormals } from '../experimentalPeriodicQuinticSurfaceNormals'

function productNet(ring: number[][], du: number, ku: number[], mu: number[], kv: number[], mv: number[]): Net {
  const full = kv.flatMap((knot, i) => Array<number>(mv[i]).fill(knot))
  const nv = full.length - 6, nu = ring.length
  const heights = Array.from({ length: nv }, (_, i) => full.slice(i + 1, i + 6).reduce((sum, knot) => sum + knot, 0))
  return {
    du, dv: 5, nu, nv, periodic: [1, 0], rational: [0, 0], ku, mu, kv, mv,
    poles: ring.flatMap(([x, y]) => heights.map((z): Point => [x, y, z])),
    weights: Array<number>(nu * nv).fill(1),
  }
}

function strip() {
  return productNet([[0, 0], [1, 2 ** -35], [2, 2], [-2, 0]], 2, [0, 1, 2, 4], [2, 1, 1, 2],
    [0, 1, 2, 3, 128], [6, 1, 1, 1, 6])
}

const standardBudget = { maxCells: 16, maxPatchChecks: 8192, maxDepth: 8 }

it('checks the full domain including both seam closures on a regular quintic pair', () => {
  const original = strip(), candidate = structuredClone(original)
  candidate.poles[2 * candidate.nv + 1][2] += 0.5
  candidate.poles[2 * candidate.nv + 2][2] += 1
  const before = structuredClone({ original, candidate })
  const result = boundExperimentalPeriodicQuinticSurfaceNormals(original, candidate, standardBudget)
  expect(result).toMatchObject({ status: 'certified-positive',
    coverage: { uSpans: 3, vSpans: 4, plannedCells: 12, checkedCells: 12, certifiedCells: 12 } })
  if (result.status !== 'certified-positive') throw new Error(JSON.stringify(result))
  expect(result.minimumCellLocalNormalDot).toBeGreaterThan(0)
  expect({ original, candidate }).toEqual(before)
})

it('finds the localized quintic inversion missed by the coarse V grid', () => {
  const original = strip(), candidate = structuredClone(original)
  // Same localized increments as the existing lateral blind-spot fixture.
  // The moved V bases vanish from V=3 onward, before the five coarse samples.
  candidate.poles[2 * candidate.nv + 1][2] += 8
  candidate.poles[2 * candidate.nv + 2][2] += 24
  const result = boundExperimentalPeriodicQuinticSurfaceNormals(original, candidate, standardBudget)
  expect(result).toMatchObject({ status: 'nonpositive-witness', cell: { uSpan: 0, vSpan: 0 },
    localParameter: [1, 1], nativeParameter: { u: { enclosure: [1, 1] }, v: { enclosure: [1, 1] } } })
  if (result.status !== 'nonpositive-witness') throw new Error(JSON.stringify(result))
  // The independent analytical witness has dZ/dV=-25/9 on the candidate
  // and +5 on the original, with horizontal U tangent (1,2-2^-35).
  const exactDot = 5 * (-25 / 9) * (1 + (2 - 2 ** -35) ** 2)
  expect(result.cellLocalNormalDotUpperBound).toBeGreaterThanOrEqual(exactDot - 1e-12)
  expect(result.cellLocalNormalDotUpperBound).toBeLessThan(0)
  expect(result.coverage.checkedCells).toBe(1)
})

it('identifies a witness on the left side of the periodic seam after a positive first cell', () => {
  const original = productNet([[0, 0], [1, 0], [2, 1], [0, 1]], 2, [0, 1, 3], [2, 2, 2], [0, 1], [6, 6])
  const candidate = structuredClone(original)
  for (let v = 0; v < candidate.nv; v++) candidate.poles[3 * candidate.nv + v][1] = -1
  const result = boundExperimentalPeriodicQuinticSurfaceNormals(original, candidate, standardBudget)
  expect(result).toMatchObject({ status: 'nonpositive-witness', cell: { uSpan: 1, vSpan: 0 },
    localParameter: [1, 0], nativeParameter: { u: { enclosure: [3, 3] }, uSeamSide: 'left' },
    coverage: { checkedCells: 2, certifiedCells: 1 } })
})

it('encloses an interior dyadic witness in native coordinates without relabeling it as an exact double', () => {
  const original = productNet([[0, 0], [1, 0], [2, 1], [0, 1]], 2, [0, 1, 3], [2, 2, 2], [0.1, 0.9], [6, 6])
  const candidate = structuredClone(original)
  // These are the exact degree-five elevation of cubic heights
  // [0,24,-952,37072] scaled by ten. Their normalized derivative is
  // 30*((200v-5)^2-1), which is negative only in (0.02,0.03).
  const heights = [0, 144, -2712, 31_432, 142_576, 370_720]
  for (let u = 0; u < candidate.nu; u++) for (let v = 0; v < candidate.nv; v++)
    candidate.poles[u * candidate.nv + v][2] = heights[v]
  const result = boundExperimentalPeriodicQuinticSurfaceNormals(original, candidate, { ...standardBudget, maxDepth: 12 })
  expect(result.status).toBe('nonpositive-witness')
  if (result.status !== 'nonpositive-witness') throw new Error(JSON.stringify(result))
  const [, fraction] = result.localParameter
  expect(fraction).toBeGreaterThan(0.02)
  expect(fraction).toBeLessThan(0.03)
  expect(result.nativeParameter.uSeamSide).toBe('right')
  expect(result.nativeParameter.v).toMatchObject({ domain: [0.1, 0.9], fraction })
  const [lo, hi] = result.nativeParameter.v.enclosure!
  const display = (1 - fraction) * 0.1 + fraction * 0.9
  expect(lo).toBeLessThanOrEqual(display)
  expect(hi).toBeGreaterThanOrEqual(display)
  expect(hi).toBeGreaterThan(lo)
})

it('stops for cell and subdivision caps, malformed bases or an unresolved patch', () => {
  const original = strip()
  expect(boundExperimentalPeriodicQuinticSurfaceNormals(original, original, { ...standardBudget, maxCells: 11 }))
    .toMatchObject({ status: 'inconclusive', reason: 'knot-cell-budget', coverage: { checkedCells: 0 } })
  expect(boundExperimentalPeriodicQuinticSurfaceNormals(original, original,
    { ...standardBudget, maxDepth: 2, maxPatchChecks: 6 }))
    .toMatchObject({ status: 'inconclusive', reason: 'patch-check-budget', coverage: { checkedCells: 0 } })
  const twoCells = productNet([[0, 0], [1, 0], [2, 1], [0, 1]], 2, [0, 1, 3], [2, 2, 2], [0, 1], [6, 6])
  expect(boundExperimentalPeriodicQuinticSurfaceNormals(twoCells, twoCells, { maxCells: 2, maxPatchChecks: 1, maxDepth: 0 }))
    .toMatchObject({ status: 'inconclusive', reason: 'patch-check-budget', cell: { uSpan: 1, vSpan: 0 },
      coverage: { checkedCells: 1, certifiedCells: 1, patchChecks: 1 } })
  const different = { ...original, kv: [0, 1, 2, 4, 128] }
  expect(boundExperimentalPeriodicQuinticSurfaceNormals(original, different, standardBudget))
    .toMatchObject({ status: 'inconclusive', reason: 'cell-extraction-refused', cell: { uSpan: 0, vSpan: 0 } })
  const flat = { ...original, poles: original.poles.map(([x, y]): Point => [x, y, 0]) }
  expect(boundExperimentalPeriodicQuinticSurfaceNormals(original, flat, { ...standardBudget, maxDepth: 0 }))
    .toMatchObject({ status: 'inconclusive', reason: 'patch-inconclusive', coverage: { checkedCells: 1, certifiedCells: 0 } })
})

it.skipIf(process.env.EXPERIMENTAL_V5_BERNSTEIN_BENCH !== '1')('measures a synthetic 237×6 cell comparison', () => {
  const uSpans = 237, nu = uSpans + 2
  const ring = Array.from({ length: nu }, (_, i) => {
    const angle = 2 * Math.PI * i / nu
    return [Math.cos(angle), Math.sin(angle)]
  })
  const original = productNet(ring, 3, Array.from({ length: uSpans + 1 }, (_, i) => i),
    [3, ...Array<number>(uSpans - 1).fill(1), 3], [0, 1, 2, 3, 4, 5, 6], [6, 1, 1, 1, 1, 1, 6])
  const candidate = { ...original, poles: original.poles.map(([x, y, z]): Point => [x, y, 2 * z]) }
  const start = performance.now()
  const result = boundExperimentalPeriodicQuinticSurfaceNormals(original, candidate,
    { maxCells: 1422, maxPatchChecks: 1422, maxDepth: 0 })
  console.log(JSON.stringify({ syntheticCells: 1422, elapsedMs: performance.now() - start, status: result.status,
    coverage: result.coverage }))
  expect(result).toMatchObject({ status: 'certified-positive',
    coverage: { checkedCells: 1422, certifiedCells: 1422, patchChecks: 1422 } })
}, 120_000)
