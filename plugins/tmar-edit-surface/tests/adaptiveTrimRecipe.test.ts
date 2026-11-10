// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { readRecipe } from '../recipe'
import { readAdaptiveTrimRecipe } from '../adaptiveTrimRecipe'

const fixture = () => ({ schema: 'tmar.surface-edit', version: 7, engine: 'occt-wasm-5.7.1/brep-v3', units: 'mm',
  coordinateFrame: 'imported-step', source: { bodyId: 'body', brepSha256: 'a'.repeat(64), faceCount: 2, solidCount: 1 },
  faceIndex: 0, preparation: 'plane-to-bicubic', baseNetSha256: 'b'.repeat(64), continuity: 'G0',
  edits: [{ index: 0, point: [1, 2, 3] }], lockedPoles: [1], boundaryMode: 'locked',
  refinements: [{ axis: 'U', value: 0.5, count: 1 }], trimPolicy: 'circular-fine-v1' })

describe('isolated adaptive trim v7', () => {
  it('validates and clones all nested input, while the existing reader rejects v7', () => {
    const input = fixture(), result = readAdaptiveTrimRecipe(input)
    expect(() => readRecipe(input)).toThrow()
    expect(result).toEqual(input)
    input.edits[0].point[0] = 99
    input.source.bodyId = 'changed'
    input.refinements[0].value = 0.2
    expect(result.edits[0].point[0]).toBe(1)
    expect(result.source.bodyId).toBe('body')
    expect(result.refinements[0].value).toBe(0.5)
  })
  it('keeps the existing v4 contract usable', () => {
    const { trimPolicy: _policy, ...rest } = fixture()
    expect(readRecipe({ ...rest, version: 4 }).version).toBe(4)
  })
  it('rejects unknown fields, invalid policies, boundaries, preparations and refinements', () => {
    const f = fixture()
    const bad: unknown[] = [null, { ...f, extra: 1 }, { ...f, trimPolicy: 'other' },
      { ...f, boundaryMode: 'free-natural' }, { ...f, preparation: 'native-nurbs' },
      { ...f, refinements: [] }, { ...f, refinements: [{ axis: 'U', value: NaN, count: 1 }] },
      { ...f, refinements: [{ axis: 'U', value: 0.5, count: 26 }] },
      { ...f, source: { ...f.source, extra: 1 } },
      { ...f, edits: [{ ...f.edits[0], extra: 1 }] }, { ...f, edits: [{ index: 0, point: [1, , 3] }] },
      { ...f, lockedPoles: Array(1) }, { ...f, refinements: [{ axis: 'U', value: 0.5, count: 1, extra: 1 }] }]
    for (const item of bad) expect(() => readAdaptiveTrimRecipe(item)).toThrow()
  })
})
