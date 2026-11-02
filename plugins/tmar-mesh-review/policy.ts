// SPDX-License-Identifier: AGPL-3.0-only
// Inspection must not compete with operations that own a click or disguise an
// uncommitted preview as the scan every workspace measures.
export interface MeshReviewState {
  tool: string | null
  status: string
  trimStatus: string
  editing: boolean
  confirming: boolean
  copyTriangles: number | null
  report: unknown
  view: string
  shownScan: boolean
  shownReduced: boolean
  shownPiece: boolean
  shownBodies: readonly string[]
  trimMade: unknown
}
export function meshReviewBlock(m: MeshReviewState, hasScan: boolean, busy: boolean, marking: boolean): string | null {
  if (!hasScan) return 'Load a mesh to inspect it.'
  if (busy || m.editing || m.status === 'running' || m.trimStatus === 'running' || m.confirming) return 'Finish the current mesh operation before inspecting or annotating.'
  if (marking || (m.tool !== null && m.tool !== 'reduce')) return 'Close the active mesh tool (Escape or its button) before using Zebra or placing notes. No edit is discarded.'
  return null
}
export function reducedShown(m: MeshReviewState): boolean {
  return m.report !== null && (m.tool === 'reduce' ? m.view === 'reduced' : m.tool === null && m.shownReduced)
}
export function meshTargetLabel(m: MeshReviewState): string {
  return reducedShown(m) ? 'Reduced mesh (preview)' : m.copyTriangles !== null ? 'Edited copy (preview)' : 'Scan in use'
}
export function meshNoteBlock(m: MeshReviewState, hasScan: boolean, busy: boolean, marking: boolean): string | null {
  const blocked = meshReviewBlock(m, hasScan, busy, marking)
  if (blocked) return blocked
  if (reducedShown(m)) return 'Notes attach to the scan in use. Switch from Reduced to Scan to place a note; the reduction is kept.'
  if (m.copyTriangles !== null) return 'This is an edited preview. Use for analysis only when ready to adopt it, or annotate the unchanged scan in Reverse engineer. Notes are not silently attached to a different mesh.'
  if (m.tool === null && !m.shownScan) return 'Show the scan before placing a note.'
  if (m.tool === null && (m.shownBodies.length > 0 || (m.trimMade !== null && m.shownPiece))) return 'Hide the overlaid bodies or trimmed piece before placing a scan note.'
  return null
}
