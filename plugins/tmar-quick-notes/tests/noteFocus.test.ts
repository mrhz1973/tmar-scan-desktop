// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest'
import { Group, Plane, Vector3 } from 'three'
import { focusProblem, focusWarning } from '../noteFocus'
import { useStore } from '../../../src/state/store'
import { useShell } from '../../../src/state/shellStore'
import { useDeviation } from '../../../src/state/deviationStore'
import { useNotes } from '../../reverse/state/noteStore'
import { useReverse } from '../../reverse/state/reStore'
import type { SceneManager } from '../../../src/viewer/SceneManager'
import type { Note } from '../../reverse/core/notes'
const scene = { scanShown: () => false, layerHost: () => ({ partGroup: new Group(), clipPlanes: () => [] }) } as unknown as SceneManager
const note: Note = { id: 1, text: 'Saved observation', at: [12, 8, 3], on: [{ kind: 'scan' }] }
beforeEach(() => {
  useShell.setState({ workspace: 'reverse' })
  useDeviation.setState({ split: false, picking: false, animate: false, nominalBusy: false,
    alignStatus: 'idle', referenceStatus: 'idle', mapStatus: 'idle', showScan: true })
  useStore.setState({ busy: false, fileName: 'synthetic.stl' })
  useReverse.setState({ building: false, playback: null, sketchDraft: null, extrudeDraft: null, revolveDraft: null, featureDraft: null, bodies: [] })
  useNotes.setState({ notes: [note], editing: null })
})
describe('saved note navigation policy', () => {
  it('does not block navigation just because its scan is hidden', () => { expect(focusProblem(note, scene)).toBeNull(); expect(focusWarning(note, scene)).toMatch(/hidden/) })
  it('allows a legacy note without a target to show its saved marker', () => { const n = { ...note, on: [] }; expect(focusProblem(n, scene)).toBeNull(); expect(focusWarning(n, scene)).toMatch(/no target/) })
  it('allows the saved position of a removed CAD target with an explicit warning', () => {
    const n: Note = { ...note, on: [{ kind: 'vertex', body: 999, point: note.at }] }
    expect(focusProblem(n, scene)).toBeNull(); expect(focusWarning(n, scene)).toMatch(/no longer exists/)
  })
  it('locates scan-side notes in split Deviation without inventing a reference anchor', () => {
    useShell.setState({ workspace: 'deviation' })
    useDeviation.setState({ split: true })
    expect(focusProblem(note, scene)).toBeNull()
    const unknown: Note = { ...note, on: [] }
    const reference: Note = { ...note, on: [{ kind: 'vertex', body: 999, point: note.at }] }
    expect(focusProblem(unknown, scene)).toMatch(/scan-side/)
    expect(focusProblem(reference, scene)).toMatch(/scan-side/)
    useDeviation.setState({ referenceStatus: 'running' })
    expect(focusProblem(note, scene)).toMatch(/Finish/)
    useDeviation.setState({ referenceStatus: 'idle', picking: true })
    expect(focusProblem(note, scene)).toMatch(/Finish/)
  })
  it('allows scan-side note focus with a hidden scan in split view, retaining visibility', () => {
    useShell.setState({ workspace: 'deviation' })
    useDeviation.setState({ split: true, showScan: false })
    expect(focusProblem(note, scene)).toBeNull()
    expect(focusWarning(note, scene)).toMatch(/hidden/)
    expect(useDeviation.getState().showScan).toBe(false)
  })
  it('warns when the saved scan-side note is clipped in split view without changing its anchor', () => {
    useShell.setState({ workspace: 'deviation' })
    useDeviation.setState({ split: true })
    const clippedScene = {
      scanShown: () => true,
      layerHost: () => ({
        partGroup: new Group(),
        clipPlanes: () => [new Plane(new Vector3(0, 0, -1), 0)],
      }),
    } as unknown as SceneManager
    const before = JSON.stringify(note)
    expect(focusProblem(note, clippedScene)).toBeNull()
    expect(focusWarning(note, clippedScene)).toMatch(/clipped/)
    expect(JSON.stringify(note)).toBe(before)
  })
  it('does not move the camera for invalid coordinates', () => expect(focusProblem({ ...note, at: [NaN, 0, 0] }, scene)).toMatch(/valid/))
  it('does not interrupt a CAD operation', () => { useReverse.setState({ building: true }); expect(focusProblem(note, scene)).toMatch(/Finish/) })
  it('protects an unsaved note editor', () => { useNotes.setState({ editing: { id: 1, at: { x: 10, y: 10 } } }); expect(focusProblem(note, scene)).toMatch(/Save or cancel/) })
  it('never mutates imported-note provenance or coordinates', () => {
    const n: Note = { ...note, fromFile: true }; const before = JSON.stringify(n)
    focusProblem(n, scene); focusWarning(n, scene); expect(JSON.stringify(n)).toBe(before)
  })
})
