// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { featureTargets } from '../featureVisibility'
import type { ReState } from '../../reverse/state/reStore'
const state = {
  features: [{ id: 1, kind: 'sketch' }, { id: 2, kind: 'extrude' }, { id: 3, kind: 'fillet' }, { id: 4, kind: 'extrude', suppressed: true }],
  bodies: [{ id: 2 }], results: { 2: { bodies: [2] }, 3: { bodies: [2] } },
} as unknown as Pick<ReState, 'features' | 'bodies' | 'results'>
describe('feature visibility is not suppression', () => {
  it('resolves sketches and actual body outputs', () => { expect(featureTargets(state, [1, 2])).toEqual({ sketches: [1], bodies: [2], skipped: [] }) })
  it('deduplicates a shared output', () => { expect(featureTargets(state, [2, 3, 2]).bodies).toEqual([2]) })
  it('reports missing, rolled-back and suppressed outputs', () => { expect(featureTargets(state, [4, 77]).skipped).toEqual([4, 77]) })
  it('does not modify the input feature or geometry state', () => { const before = JSON.stringify(state); featureTargets(state, [1, 2, 3]); expect(JSON.stringify(state)).toBe(before) })
})
