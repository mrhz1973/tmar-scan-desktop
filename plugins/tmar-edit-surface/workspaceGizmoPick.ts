// SPDX-License-Identifier: AGPL-3.0-only
// Host-space hit testing for the coloured X/Y/Z or U/V/N handles.
// The workspace viewport can transform the CAD part; use its own projector,
// never the standalone modal camera's world-space projection.
import type { Net, Point } from './brep'
import type { DragMode } from './localFrame'
import { gizmoHandles, type GizmoAxis } from './surfaceGizmo'

export interface WorkspaceGizmoProjection {
  clientX: number
  clientY: number
  visible: boolean
}
export interface WorkspaceGizmoPick {
  pole: number
  axis: GizmoAxis
  distancePx: number
}
export interface WorkspaceGizmoPickInput {
  net: Net
  selected: readonly number[]
  locked: readonly number[]
  hiddenPoles: readonly number[]
  mode: DragMode
  radius: number
  clientX: number
  clientY: number
  projectPartPoint: (point: Point) => WorkspaceGizmoProjection
}

/** Match the THREE.ArrowHelper segments drawn by populateSurfaceCage. */
export function pickWorkspaceGizmoArrow(input: WorkspaceGizmoPickInput): WorkspaceGizmoPick | null {
  const { net, selected, locked, hiddenPoles, mode, radius, clientX, clientY, projectPartPoint } = input
  if (mode === 'screen' || !Number.isFinite(radius) || radius <= 0 ||
      !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null
  let best: WorkspaceGizmoPick | null = null
  for (const { pole, axis, direction } of gizmoHandles(net, selected, locked, hiddenPoles, mode)) {
    const start = projectPartPoint(net.poles[pole])
    const endPoint: Point = net.poles[pole].map((v, i) => v + direction[i] * radius * .22) as Point
    const end = projectPartPoint(endPoint)
    if (!start.visible || !end.visible || ![start.clientX, start.clientY, end.clientX, end.clientY].every(Number.isFinite)) continue
    const dx = end.clientX - start.clientX, dy = end.clientY - start.clientY
    const length = Math.hypot(dx, dy)
    if (length < 8) continue // View-aligned projection too short to select safely.
    const x = clientX - start.clientX, y = clientY - start.clientY
    const along = (x * dx + y * dy) / length
    if (along < 5 || along > length + 4) continue // Centre click remains point selection.
    const distancePx = Math.abs(x * dy - y * dx) / length
    if (distancePx > 6) continue
    if (!best || distancePx < best.distancePx) best = { pole, axis, distancePx }
  }
  return best
}
