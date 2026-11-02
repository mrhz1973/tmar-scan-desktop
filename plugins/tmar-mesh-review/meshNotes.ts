// SPDX-License-Identifier: AGPL-3.0-only
import { Vector3 } from 'three'
import { sceneOf } from '../../src/commands/host'
import { useCommandActivity } from '../../src/commands/activity'
import { useStore } from '../../src/state/store'
import { useMark } from '../../src/state/markStore'
import type { SceneManager } from '../../src/viewer/SceneManager'
import { useMeshTools } from '../mesh-tools/state/meshStore'
import { pinNoteOnScan } from '../reverse/app/useNotePins'
import { meshNoteBlock, meshReviewBlock, reducedShown } from './policy'
export function inspectionBlockNow(): string | null {
  return meshReviewBlock(useMeshTools.getState(), !!useStore.getState().fileName,
    useStore.getState().busy || !!useCommandActivity.getState().running, useMark.getState().gesture !== null)
}
export function meshNoteBlockNow(): string | null {
  const blocked = meshNoteBlock(useMeshTools.getState(), !!useStore.getState().fileName,
    useStore.getState().busy || !!useCommandActivity.getState().running, useMark.getState().gesture !== null)
  if (blocked) return blocked
  if (sceneOf()?.showingEdited()) return 'The displayed mesh is an edited preview, not the scan in use.'
  return null
}
export function meshFocusWarning(): string | null {
  const m = useMeshTools.getState()
  return m.copyTriangles !== null || reducedShown(m)
    ? 'An inspection preview is displayed; this marker retains its saved scan coordinates, not a verified point on the preview.' : null
}
export function placeMeshNote(scene: SceneManager, x: number, y: number): void {
  const blocked = meshNoteBlockNow()
  if (blocked) { useStore.getState().setStatus(blocked); return }
  const host = scene.layerHost(), hit = host.pickScan(x, y)
  if (!hit || !hit.point.every(Number.isFinite)) {
    useStore.getState().setStatus('Click the visible scan surface. Escape cancels the note.'); return
  }
  host.partGroup.updateWorldMatrix(true, false)
  const world = new Vector3(...hit.point).applyMatrix4(host.partGroup.matrixWorld)
  if (host.clipPlanes()?.some(p => p.distanceToPoint(world) < -1e-7)) {
    useStore.getState().setStatus('That point is clipped out. Choose a visible scan surface.'); return
  }
  pinNoteOnScan(hit)
}
