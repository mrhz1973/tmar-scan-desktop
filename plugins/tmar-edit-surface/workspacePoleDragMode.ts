// SPDX-License-Identifier: AGPL-3.0-only
import type { DragMode } from './localFrame'

/**
 * A direct left-button grab of one control pole follows the current screen
 * plane, independently of the numerical XYZ/U/V/N mode. Clicking a coloured
 * gizmo arrow, selecting an edge/cell, or dragging the whole CAD face retains
 * the existing constrained gesture behaviour.
 *
 * The caller must check CAD locks and hidden poles before starting a gesture.
 */
export function workspacePoleDragMode(
  current: DragMode, onArrow: boolean, onWholeFace: boolean, pickedCount: number,
): DragMode {
  return !onArrow && !onWholeFace && pickedCount === 1 ? 'screen' : current
}
