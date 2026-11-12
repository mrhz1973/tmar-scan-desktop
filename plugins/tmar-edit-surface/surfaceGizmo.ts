// SPDX-License-Identifier: AGPL-3.0-only
// Pure, read-only gizmo geometry shared by rendering and pointer hit testing.
import * as THREE from 'three'
import type { Net, Point } from './brep'
import { localFrame, type DragMode } from './localFrame'

export type GizmoAxis = 0 | 1 | 2
export const GIZMO_AXES = [0, 1, 2] as const
export const GIZMO_AXIS_COLORS = [0xff5555, 0x58d16c, 0x4d91ff] as const
const WORLD: readonly Point[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]

export interface GizmoHandle { pole: number; axis: GizmoAxis; direction: Point }
export type GizmoHit = GizmoHandle & { distancePx: number }
export type GizmoRect = Pick<DOMRectReadOnly, 'left' | 'top' | 'width' | 'height'>

export function gizmoAxisLabel(mode: DragMode, axis: GizmoAxis): string {
  return (mode === 'local' ? ['U', 'V', 'N'] : ['X', 'Y', 'Z'])[axis]
}

/** Never create a manipulator on any protected pole. */
export function gizmoHandles(net: Net, selected: readonly number[], locked: readonly number[],
  hiddenPoles: readonly number[], mode: DragMode): GizmoHandle[] {
  if (mode === 'screen') return []
  const blocked = new Set([...locked, ...hiddenPoles]), seen = new Set<number>()
  const result: GizmoHandle[] = []
  for (const pole of selected) {
    if (!Number.isInteger(pole) || pole < 0 || pole >= net.poles.length || blocked.has(pole) || seen.has(pole)) continue
    seen.add(pole)
    const basis = mode === 'local' ? localFrame(net, pole) : WORLD
    if (!basis) continue
    for (const axis of GIZMO_AXES) {
      const vector = basis[axis]
      if (vector.length !== 3 || !vector.every(Number.isFinite) || Math.hypot(...vector) < 1e-10) continue
      const scale = Math.hypot(...vector)
      result.push({ pole, axis, direction: vector.map(x => x / scale) as Point })
    }
  }
  return result
}

/** Multiple selected editable poles translate as one rigid control-net group. */
export function gizmoDragTargets(pole: number, selected: readonly number[], locked: readonly number[]): number[] {
  if (locked.includes(pole)) return []
  return (selected.includes(pole) ? selected : [pole]).filter((id, i, ids) =>
    Number.isInteger(id) && id >= 0 && !locked.includes(id) && ids.indexOf(id) === i)
}

type Picker = {
  net: Net; selected: readonly number[]; locked: readonly number[]; hiddenPoles: readonly number[]
  mode: DragMode; camera: THREE.Camera; rect: GizmoRect
  radius: number; clientX: number; clientY: number
}

/** Project the *same* arrows shown by the viewer into CSS pixels. A click on
 * the pole center (first 5 px) remains selection rather than axis dragging. */
export function pickGizmoArrow(input: Picker): GizmoHit | null {
  const { net, selected, locked, hiddenPoles, mode, camera, rect, radius, clientX, clientY } = input
  if (!Number.isFinite(radius) || radius <= 0 || !Number.isFinite(clientX) || !Number.isFinite(clientY) ||
    !(rect.width > 0) || !(rect.height > 0)) return null
  let picked: GizmoHit | null = null
  for (const handle of gizmoHandles(net, selected, locked, hiddenPoles, mode)) {
    const point = net.poles[handle.pole]
    const a = new THREE.Vector3(...point).project(camera)
    const b = new THREE.Vector3(...point).addScaledVector(new THREE.Vector3(...handle.direction), radius * 0.22).project(camera)
    if (![...a.toArray(), ...b.toArray()].every(Number.isFinite) || Math.abs(a.z) > 1 || Math.abs(b.z) > 1) continue
    const x0 = rect.left + (1 + a.x) * rect.width / 2
    const y0 = rect.top + (1 - a.y) * rect.height / 2
    const dx = (b.x - a.x) * rect.width / 2
    const dy = (a.y - b.y) * rect.height / 2
    const length = Math.hypot(dx, dy)
    if (length < 9) continue
    const x = clientX - x0, y = clientY - y0
    const along = (x * dx + y * dy) / length
    const distancePx = Math.abs(x * dy - y * dx) / length
    if (along < 5 || along > length + 4 || distancePx > 6) continue
    if (!picked || distancePx < picked.distancePx) picked = { ...handle, distancePx }
  }
  return picked
}
