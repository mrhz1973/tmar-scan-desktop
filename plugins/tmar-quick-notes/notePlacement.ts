// SPDX-License-Identifier: AGPL-3.0-only
import { Vector3 } from 'three'
import { useDeviation } from '../../src/state/deviationStore'
import { useStore } from '../../src/state/store'
import type { SceneManager } from '../../src/viewer/SceneManager'
import { pinNoteOnScan } from '../reverse/app/useNotePins'
import { reEditorOpen, useReverse } from '../reverse/state/reStore'

export interface DeviationNoteState {
  nominalBusy: boolean
  alignStatus: string
  mapStatus: string
  referenceStatus: string
  picking: boolean
  split: boolean
  marking: boolean
  animate: boolean
  showScan: boolean
  mapOn: string
}

/** Only the scan-side viewport is supported by this first adapter. Never
 * pretend that a reference-only pick identifies a point on the scan. */
export function deviationNoteBlock(d: DeviationNoteState, hasScan: boolean, busy: boolean): string | null {
  if (!hasScan) return 'Load a scan before placing a note.'
  if (busy || d.nominalBusy || d.alignStatus === 'running' || d.mapStatus === 'running' || d.referenceStatus === 'running') return 'Wait for the current operation to finish before placing a note.'
  // The main viewport remains the scan at left in split mode. The independent
  // reference half cannot create notes: its click handler does not call the
  // shared scan-side placement adapter.
  if (d.picking || d.marking) return 'Finish alignment picking or surface marking before placing a note.'
  if (d.animate) return 'Stop deformation animation before placing a note on the actual surface.'
  if (d.mapOn === 'reference' && !d.split) return 'Select the scan-side map to place a note. Reference-side notes are not supported yet.'
  if (!d.showScan) return 'Show the scan before placing a note.'
  return null
}

export function placementBlockNow(): string | null {
  const model = useStore.getState()
  const re = useReverse.getState()
  return deviationNoteBlock(useDeviation.getState(), model.fileName !== null, model.busy || re.building || reEditorOpen(re))
}

/** PickHit.point and .normal are already in the scan/part frame. The existing
 * notes and their pins follow the part transform; do not apply it twice. */
export function placeDeviationNote(scene: SceneManager, x: number, y: number): void {
  const blocked = placementBlockNow()
  if (blocked) { useStore.getState().setStatus(blocked); return }
  const host = scene.layerHost()
  const hit = host.pickScan(x, y)
  if (!hit || !hit.point.every(Number.isFinite)) {
    useStore.getState().setStatus('Click the visible scan surface, not the reference or empty space. Escape cancels.')
    return
  }
  // Raycasting can hit triangles clipped out of the rendered image.
  host.partGroup.updateWorldMatrix(true, false)
  const world = new Vector3(...hit.point).applyMatrix4(host.partGroup.matrixWorld)
  if (host.clipPlanes()?.some((plane) => plane.distanceToPoint(world) < -1e-7)) {
    useStore.getState().setStatus('That surface is clipped out. Choose a visible point or adjust the section first.')
    return
  }
  pinNoteOnScan(hit)
}
