// SPDX-License-Identifier: AGPL-3.0-only
import { OcctKernel } from 'occt-wasm'
import { expect, it } from 'vitest'
import { runExperimentalPeriodicRefinementTangencyCadFixture } from '../experimentalPeriodicTangencyCadFixture'

it('refines two different CAD U bases, applies tangency, and verifies the sewn STEP readback', async () => {
  const kernel = await OcctKernel.init()
  try {
    const receipt = runExperimentalPeriodicRefinementTangencyCadFixture(kernel)
    const { before, after, reopened, refinement, maxStepSurfaceGapMm } = receipt
    const originalKnots = Array.from({ length: 17 }, (_, i) => i)
    const withExtra = (...knots: number[]) => [...originalKnots, ...knots].sort((a, b) => a - b)
    expect(receipt).toMatchObject({
      scope: 'synthetic-two-face-open-shell',
      sourceFacesPreserved: true,
      globalG1Certified: false,
      refinement: {
        mismatchedBasesRefused: true,
        sourceKnots: [withExtra(3.5), withExtra(11.5)],
        commonKnots: withExtra(3.5, 11.5),
        commonMultiplicities: Array(19).fill(1),
        selected: { samples: 365 },
        support: { samples: 365 },
      },
      before: { samples: 73 },
      after: { samples: 73 },
      reopened: { samples: 73 },
    })
    expect(receipt.replay.changedIndices).toHaveLength(18)
    expect(receipt.replay.checkedSpans).toBe(18)
    for (const comparison of [refinement!.selected, refinement!.support, after, reopened]) {
      expect(comparison.maxGapMm).toBeLessThan(1e-7)
      expect(comparison.maxNormalSin).toBeLessThan(1e-7)
    }
    expect(before.maxGapMm).toBeLessThan(1e-7)
    expect(before.maxNormalSin).toBeGreaterThan(0.25)
    expect(maxStepSurfaceGapMm).toBeLessThan(1e-7)
    expect(receipt.step).toContain('ISO-10303-21;')
    console.info({ refinement, before, after, reopened, maxStepSurfaceGapMm })
  } finally {
    kernel[Symbol.dispose]()
  }
}, 30_000)
