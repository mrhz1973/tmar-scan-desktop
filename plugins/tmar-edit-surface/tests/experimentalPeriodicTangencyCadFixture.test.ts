// SPDX-License-Identifier: AGPL-3.0-only
import { OcctKernel } from 'occt-wasm'
import { expect, it, vi } from 'vitest'
import { runExperimentalPeriodicTangencyCadFixture } from '../experimentalPeriodicTangencyCadFixture'

it('applies the proposal on a valid synthetic two-face shell and verifies the reopened STEP', async () => {
  const kernel = await OcctKernel.init()
  try {
    const receipt = runExperimentalPeriodicTangencyCadFixture(kernel)
    expect(receipt).toMatchObject({
      scope: 'synthetic-two-face-open-shell',
      sourceFacesPreserved: true,
      globalG1Certified: false,
      before: { samples: 65 },
      after: { samples: 65 },
      reopened: { samples: 65 },
    })
    expect(receipt.replay.changedIndices).toHaveLength(16)
    expect(receipt.before.maxNormalSin).toBeGreaterThan(0.25)
    expect(receipt.after.maxGapMm).toBeLessThan(1e-7)
    expect(receipt.after.maxNormalSin).toBeLessThan(1e-7)
    expect(receipt.reopened.maxGapMm).toBeLessThan(1e-7)
    expect(receipt.reopened.maxNormalSin).toBeLessThan(1e-7)
    expect(receipt.maxStepSurfaceGapMm).toBeLessThan(1e-7)
    expect(receipt.step).toContain('ISO-10303-21;')
    const { before, after, reopened, maxStepSurfaceGapMm } = receipt
    console.info({ before, after, reopened, maxStepSurfaceGapMm })
  } finally {
    kernel[Symbol.dispose]()
  }
}, 30000)

it.each(['compound', 'reversed shell'] as const)('refuses a %s at STEP readback', async kind => {
  const kernel = await OcctKernel.init()
  const importStep = kernel.importStep.bind(kernel)
  const replaceImport = vi.spyOn(kernel, 'importStep').mockImplementation(step => {
    const shell = importStep(step)
    try {
      return kind === 'compound' ? kernel.makeCompound([shell]) : kernel.reverseShape(shell)
    } finally {
      kernel.release(shell)
    }
  })
  try {
    expect(() => runExperimentalPeriodicTangencyCadFixture(kernel)).toThrow(/guscio aperto a due facce non valido/)
    expect(replaceImport).toHaveBeenCalledOnce()
  } finally {
    replaceImport.mockRestore()
    kernel[Symbol.dispose]()
  }
}, 30000)
