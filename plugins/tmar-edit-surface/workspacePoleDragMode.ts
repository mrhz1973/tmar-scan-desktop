// SPDX-License-Identifier: AGPL-3.0-only
import type { DragMode } from './localFrame'

/**
 * Directly grabbing an already-selected yellow control point follows the
 * camera-facing screen plane. The first grab of a new/unselected pole keeps
 * its existing constrained drag, so precise XYZ/U/V/N and reference snapping
 * retain their pre-existing contract. Clicking a coloured gizmo arrow,
 * selecting an edge/cell, or dragging the whole face also stays constrained.
 *
 * The caller must check CAD locks and hidden poles before starting a gesture.
 */
export function workspacePoleDragMode(
  current: DragMode, onArrow: boolean, onWholeFace: boolean,
  pickedCount: number, alreadySelected: boolean,
): DragMode {
  return !onArrow && !onWholeFace && pickedCount === 1 && alreadySelected ? 'screen' : current
}
