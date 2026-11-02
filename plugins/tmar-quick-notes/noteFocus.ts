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

export const useNoteFocus = create<{ id: number | null; canReturn: boolean }>(() => ({ id: null, canReturn: false }))
let previous: { scene: SceneManager; pose: ReturnType<SceneManager['captureView']> } | null = null

/** Validate identity and the saved anchor. Never guess a missing target's origin. */
export function focusProblem(note: Note, scene: SceneManager): string | null {
  const re = useReverse.getState(), workspace = useShell.getState().workspace
  if (re.building || reEditorOpen(re) || re.playback || useStore.getState().busy) return 'Finish the current operation before locating a note.'
  if (useNotes.getState().editing) return 'Save or cancel the open note before locating another note.'
  if (!note.at.every(Number.isFinite)) return 'This note has no valid model-space anchor.'
  if (workspace === 'flat') return 'Open a 3D workspace to locate this note.'
  const d = useDeviation.getState()
  if (workspace === 'deviation' && (d.picking || d.animate || d.split || d.alignStatus === 'running')) return 'Use a still, single Deviation viewport before locating a note.'
  const target = note.on[0]
  if (!target) return 'This note has no target to locate.'
  if (target.kind === 'scan') {
    if (!useStore.getState().fileName) return 'The scan referenced by this note is not loaded.'
    if (!scene.scanShown()) return 'The scan is hidden. Show it before locating this note.'
  } else {
    if (workspace !== 'reverse') return 'Open Reverse engineer to locate a CAD-body note.'
    const body = re.bodies.find((b) => b.id === target.body)
    const session = reverseSession(), mesh = session?.meshes.get(target.body), topo = session?.topologies.get(target.body)
    if (!body || !mesh || !topo) return 'The body referenced by this note no longer exists.'
    if (!body.visible || re.bodiesHidden) return 'The body is hidden. Show it before locating this note.'
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
  if (host.clipPlanes()?.some((p) => p.distanceToPoint(world) < -1e-7)) return 'The note is clipped out. Adjust the section before locating it.'
  return null
}

export function goToNote(id: number): boolean {
  const scene = sceneOf(), note = useNotes.getState().notes.find((n) => n.id === id)
  if (!scene || !note) { useStore.getState().setStatus('This note or its viewport is no longer available.'); return false }
  const problem = focusProblem(note, scene)
  if (problem) { useStore.getState().setStatus(problem); return false }
  const host = scene.layerHost()
  host.partGroup.updateWorldMatrix(true, false)
  const world = new Vector3(...note.at).applyMatrix4(host.partGroup.matrixWorld)
  if (!previous || previous.scene !== scene) previous = { scene, pose: scene.captureView() }
  const radius = Math.max(0.5, host.modelRadius() * 0.09)
  const min = world.clone().addScalar(-radius), max = world.clone().addScalar(radius)
  scene.fitBox([min.x, min.y, min.z], [max.x, max.y, max.z])
  notePinsOf(scene).setFocus(id)
  useNoteFocus.setState({ id, canReturn: true })
  useStore.getState().setStatus(`Note ${id} located. Return to previous view restores the working view.`)
  return true
}
export function clearNoteFocus(restore = false): void {
  if (previous) {
    notePinsOf(previous.scene).setFocus(null)
    if (restore && sceneOf() === previous.scene) previous.scene.restoreView(previous.pose)
  }
  previous = null
  useNoteFocus.setState({ id: null, canReturn: false })
}
