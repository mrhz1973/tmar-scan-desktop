// SPDX-License-Identifier: AGPL-3.0-only
import { Group, Plane, Vector3 } from 'three'
import { beforeEach, describe, expect, it } from 'vitest'
import { useDeviation } from '../../../src/state/deviationStore'
import { useStore } from '../../../src/state/store'
import type { PickHit, SceneManager } from '../../../src/viewer/SceneManager'
import { noteWorkspace, registerNoteWorkspace } from '../../reverse/app/noteWorkspaces'
import { useNotes } from '../../reverse/state/noteStore'
import { useReverse } from '../../reverse/state/reStore'
import { deviationNoteBlock, placeDeviationNote, type DeviationNoteState } from '../notePlacement'

const idle: DeviationNoteState = {
  nominalBusy: false, alignStatus: 'idle', mapStatus: 'idle', referenceStatus: 'idle',
  picking: false, split: false, marking: false, animate: false, showScan: true, mapOn: 'scan',
}

beforeEach(() => {
  useNotes.getState().load([])
  useStore.setState({ fileName: 'synthetic.stl', busy: false })
  useReverse.setState({ building: false, sketchDraft: null, extrudeDraft: null, revolveDraft: null, featureDraft: null })
  useDeviation.setState({ ...useDeviation.getInitialState(), showScan: true, mapOn: 'scan' })
})

describe('Deviation note placement guards', () => {
  it('permits the ordinary visible scan-side map', () => expect(deviationNoteBlock(idle, true, false)).toBeNull())
  it('refuses unsupported or ambiguous modes', () => {
    expect(deviationNoteBlock(idle, false, false)).toMatch(/Load a scan/)
    expect(deviationNoteBlock(idle, true, true)).toMatch(/Wait/)
    for (const patch of [{ split: true }, { picking: true }, { marking: true }, { animate: true }, { showScan: false }, { mapOn: 'reference' }, { alignStatus: 'running' }, { nominalBusy: true }]) {
      expect(deviationNoteBlock({ ...idle, ...patch }, true, false)).not.toBeNull()
    }
  })
})

describe('shared note records on the actual scan', () => {
  const hit: PickHit = { point: [2, 3, 4], normal: [0, 0, 1], vertices: [0, 1, 2], weights: [1, 0, 0], faceIndex: 0, clientX: 12, clientY: 34, ctrlKey: false }
  const scene = (picked: PickHit | null, clipped = false) => {
    const partGroup = new Group()
    partGroup.position.set(100, 0, 0)
    return { layerHost: () => ({ partGroup, pickScan: () => picked, clipPlanes: () => clipped ? [new Plane(new Vector3(0, 0, -1), 0)] : null }) } as unknown as SceneManager
  }
  it('uses the existing note store and keeps part-frame coordinates under alignment', () => {
    placeDeviationNote(scene(hit), 12, 34)
    expect(useNotes.getState().notes).toHaveLength(1)
    expect(useNotes.getState().notes[0]).toMatchObject({ at: [2, 3, 4], normal: [0, 0, 1], on: [{ kind: 'scan' }] })
    expect(useNotes.getState().editing?.at).toEqual({ x: 12, y: 34 })
  })
  it('creates no note on empty space, clipped surfaces or a busy comparison', () => {
    placeDeviationNote(scene(null), 1, 2)
    placeDeviationNote(scene(hit, true), 1, 2)
    useDeviation.setState({ animate: true })
    placeDeviationNote(scene(hit), 1, 2)
    expect(useNotes.getState().notes).toEqual([])
  })
})

describe('optional note-workspace adapters', () => {
  it('registers and removes an adapter without replacing Reverse engineer', () => {
    const adapter = { workspace: 'test-deviation', place: () => {} }
    const remove = registerNoteWorkspace(adapter)
    try {
      expect(noteWorkspace('test-deviation')).toBe(adapter)
      expect(() => registerNoteWorkspace(adapter)).toThrow(/cannot replace/)
      expect(() => registerNoteWorkspace({ ...adapter, workspace: 'reverse' })).toThrow(/cannot replace/)
    } finally { remove() }
    expect(noteWorkspace('test-deviation')).toBeUndefined()
  })
})
