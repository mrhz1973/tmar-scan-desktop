// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from '../../../src/state/store'
import { useCommandActivity } from '../../../src/commands/activity'
import { useReverse, type ReState } from '../../reverse/state/reStore'
import { useNotes } from '../../reverse/state/noteStore'
import { setFeatureVisibility } from '../featureVisibility'
import type { FeatureCategory } from '../featureCategories'

beforeEach(() => {
  useStore.setState({ busy: false })
  useCommandActivity.setState({ running: null })
  useReverse.setState({
    features: [
      { id: 1, kind: 'sketch', visible: true, plane: { kind: 'world' } },
      { id: 2, kind: 'extrude' },
      { id: 3, kind: 'sketch', visible: true, plane: { kind: 'section' } },
      { id: 4, kind: 'sheet' },
      { id: 5, kind: 'sketch', visible: true, suppressed: true },
    ],
    bodies: [{ id: 2, visible: true, surface: false }, { id: 4, visible: true, surface: true }],
    hiddenBodies: [], results: { 1: { bodies: [2] }, 2: { bodies: [2, 4] }, 3: { bodies: [2] }, 4: { bodies: [4, 2] } },
    rolledBack: [], building: false, playback: null, sketchDraft: null,
    extrudeDraft: null, revolveDraft: null, featureDraft: null, buildVersion: 10,
  } as unknown as Partial<ReState>)
  useNotes.getState().load([{ id: 1, text: 'Preserve annotation', at: [1, 2, 3], on: [{ kind: 'scan' }] }])
})

describe('category visibility write boundary', () => {
  it('keeps body state identities and unrelated sketches on mixed sketch Hide', () => {
    const old = useReverse.getState(), notes = useNotes.getState().notes
    setFeatureVisibility([1, 2, 3, 4, 5, 999], false, 'sketches')
    const now = useReverse.getState()
    expect(now.features[0]).toMatchObject({ visible: false })
    expect(now.features[2]).toBe(old.features[2])
    expect(now.features[4]).toBe(old.features[4])
    expect(now.bodies).toBe(old.bodies)
    expect(now.hiddenBodies).toBe(old.hiddenBodies)
    expect(now.buildVersion).toBe(old.buildVersion)
    expect(useNotes.getState().notes).toBe(notes)
  })
  it('keeps ordinary sketches and body state for section Hide', () => {
    const old = useReverse.getState()
    setFeatureVisibility([1, 2, 3], false, 'sections')
    const now = useReverse.getState()
    expect(now.features[0]).toBe(old.features[0])
    expect(now.features[2]).toMatchObject({ visible: false })
    expect(now.bodies).toBe(old.bodies)
  })
  it('never hides a solid through Surface operations', () => {
    setFeatureVisibility([2, 4], false, 'surfaces')
    expect(useReverse.getState().hiddenBodies).toEqual([4])
    expect(useReverse.getState().bodies[0].visible).toBe(true)
  })
  it('never hides a surface through Solid-body operations', () => {
    const old = useReverse.getState()
    setFeatureVisibility([1, 2, 4], false, 'bodies')
    expect(useReverse.getState().hiddenBodies).toEqual([2])
    expect(useReverse.getState().bodies[1].visible).toBe(true)
    expect(useReverse.getState().features).toBe(old.features)
  })
  it('refuses a missing or unknown category at runtime', () => {
    const old = useReverse.getState()
    for (const bad of [undefined, 'all', 'other']) setFeatureVisibility([1, 2, 4], false, bad as FeatureCategory)
    expect(useReverse.getState()).toBe(old)
  })
  it('does not change stale, suppressed or rolled-back records', () => {
    const old = useReverse.getState()
    setFeatureVisibility([5, 999], false, 'sketches')
    expect(useReverse.getState()).toBe(old)
  })
  it('refuses visibility writes during a build', () => {
    useReverse.setState({ building: true })
    const old = useReverse.getState()
    setFeatureVisibility([1, 2], false, 'sketches')
    expect(useReverse.getState()).toBe(old)
  })
  it('shows one category without revealing a hidden body in another', () => {
    setFeatureVisibility([2], false, 'bodies')
    setFeatureVisibility([4], false, 'surfaces')
    setFeatureVisibility([1, 2, 4], true, 'surfaces')
    expect(useReverse.getState().hiddenBodies).toEqual([2])
    expect(useReverse.getState().bodies.map(b => b.visible)).toEqual([false, true])
  })
})
