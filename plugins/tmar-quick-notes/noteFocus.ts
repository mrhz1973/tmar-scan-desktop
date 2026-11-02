// SPDX-License-Identifier: AGPL-3.0-only
import { Vector3 } from 'three'
import { create } from 'zustand'
import { sceneOf } from '../../src/commands/host'
import type { SceneManager } from '../../src/viewer/SceneManager'
import { useStore } from '../../src/state/store'
import { useShell } from '../../src/state/shellStore'
import { useDeviation } from '../../src/state/deviationStore'
import { useNotes } from '../reverse/state/noteStore'
import { reEditorOpen, useReverse } from '../reverse/state/reStore'
import { reverseSession, meshDiagonal } from '../reverse/app/reSession'
import { nearestOnMesh, type Note } from '../reverse/core/notes'
import { matchEdge, matchFace, matchTolerance } from '../reverse/core/topo'
import { notePinsOf } from '../reverse/viewer/notePins'
import { noteWorkspace } from '../reverse/app/noteWorkspaces'

export const useNoteFocus = create<{ id: number | null; canReturn: boolean; message: string; warning: boolean }>(() => ({ id: null, canReturn: false, message: '', warning: false }))
let previous: { scene: SceneManager; pose: ReturnType<SceneManager['captureView']> } | null = null

/** Only an unsafe camera operation or an invalid saved point blocks navigation. */
export function focusProblem(note: Note, _scene: SceneManager): string | null {
  const re = useReverse.getState(), workspace = useShell.getState().workspace
  if (re.building || reEditorOpen(re) || re.playback || useStore.getState().busy) return 'Finish the current operation before locating a note.'
  if (useNotes.getState().editing) return 'Save or cancel the open note before locating another note.'
  if (!Array.isArray(note.at) || note.at.length !== 3 || !note.at.every(Number.isFinite)) return 'This note has no valid model-space anchor.'
  if (workspace === 'flat') return 'Open a 3D workspace to locate this note.'
  const adapterProblem = noteWorkspace(workspace)?.focusProblem?.(note, _scene)
  if (adapterProblem) return adapterProblem
  const d = useDeviation.getState()
  if (workspace === 'deviation' && (d.picking || d.animate || d.split || d.alignStatus === 'running')) return 'Use a still, single Deviation viewport before locating a note.'
  return null
}

/** Diagnostics do not prevent locating the saved marker. No target is guessed or moved. */
export function focusWarning(note: Note, scene: SceneManager): string | null {
  const re = useReverse.getState(), workspace = useShell.getState().workspace
  const adapterWarning = noteWorkspace(workspace)?.focusWarning?.(note, scene)
  if (adapterWarning) return adapterWarning
  const target = note.on[0]
  if (!target) return 'This note has no target record; only its saved coordinates are available.'
  if (target.kind === 'scan') {
    if (!useStore.getState().fileName) return 'The scan referenced by this note is not loaded.'
    if (!scene.scanShown()) return 'The scan is hidden; its saved marker is shown without revealing it.'
  } else {
    if (workspace !== 'reverse') return 'The CAD target is not displayed in this workspace; only the saved marker is shown.'
    const body = re.bodies.find((b) => b.id === target.body)
    const session = reverseSession(), mesh = session?.meshes.get(target.body), topo = session?.topologies.get(target.body)
    if (!body || !mesh || !topo) return 'The body referenced by this note no longer exists.'
    if (!body.visible || re.bodiesHidden) return 'The body is hidden; its saved marker is shown without revealing it.'
    const tolerance = matchTolerance(meshDiagonal(mesh))
    let faceHash: number | undefined
    if (target.kind === 'face') {
      const index = matchFace(target.face, topo.faces.map((f) => f.fingerprint), tolerance)
      if (index === null) return 'The saved face is no longer identifiable. Review the note target.'
      faceHash = topo.faces[index].hash
    } else if (target.kind === 'edge' && matchEdge(target.edge, topo.edges.map((e) => e.fingerprint), tolerance) === null) {
      return 'The saved edge is no longer identifiable. Review the note target.'
    }
    const nearest = nearestOnMesh(mesh, note.at, faceHash)
    if (!nearest || nearest.distance > Math.max(0.05, meshDiagonal(mesh) * 1e-4)) return 'The saved anchor is no longer on this body. Review the note target.'
  }
  const host = scene.layerHost()
  host.partGroup.updateWorldMatrix(true, false)
  const world = new Vector3(...note.at).applyMatrix4(host.partGroup.matrixWorld)
  if (host.clipPlanes()?.some((p) => p.distanceToPoint(world) < -1e-7)) return 'The target is clipped by the current section; the marker shows the saved position.'
  return null
}

export function goToNote(id: number): boolean {
  const scene = sceneOf(), note = useNotes.getState().notes.find((n) => n.id === id)
  const report = (message: string) => {
    useStore.getState().setStatus(message)
    useNoteFocus.setState({ message, warning: true })
    return false
  }
  if (!scene || !note) return report('This note or its viewport is no longer available.')
  const problem = focusProblem(note, scene)
  if (problem) return report(problem)
  const warning = focusWarning(note, scene)
  if (!previous || previous.scene !== scene) previous = { scene, pose: scene.captureView() }
  // The stored marker is the destination, not a guessed replacement face. Its
  // stored normal supplies an inspection direction; geometry is never changed.
  scene.focusPoint(note.at, note.normal)
  useNotes.getState().showLocalNotes()
  notePinsOf(scene).setFocus(id)
  const message = warning
    ? `Note ${id}: showing its saved position. ${warning} Geometry and visibility are unchanged.`
    : `Note ${id} centered and highlighted. Return to previous view restores the working view.`
  useNoteFocus.setState({ id, canReturn: true, message, warning: Boolean(warning) })
  useStore.getState().setStatus(message)
  return true
}
export function clearNoteFocus(restore = false): void {
  if (previous) {
    notePinsOf(previous.scene).setFocus(null)
    if (restore && sceneOf() === previous.scene) previous.scene.restoreView(previous.pose)
  }
  previous = null
  useNoteFocus.setState({ id: null, canReturn: false, message: '', warning: false })
}
