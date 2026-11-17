// SPDX-License-Identifier: AGPL-3.0-only
// Layout preference only: never part of a model, camera pose or project archive.
export const SPLIT_VIEW_KEY = 'tmar.splitView.ratio'
export const SPLIT_VIEW_DEFAULT = 0.5
export const SPLIT_VIEW_HANDLE = 12
export const SPLIT_VIEW_PANE_MIN = 240

export function boundSplitViewRatio(value: number): number {
  return Number.isFinite(value) ? Math.max(0.2, Math.min(0.8, value)) : SPLIT_VIEW_DEFAULT
}

export function parseSplitViewRatio(raw: string | null): number {
  return raw === null || raw.trim() === '' ? SPLIT_VIEW_DEFAULT : boundSplitViewRatio(Number(raw))
}

/** Clamp the visible panes without overwriting a preference on a smaller screen. */
export function splitViewLayout(width: number, preferred: number) {
  const available = Number.isFinite(width) ? Math.max(0, width - SPLIT_VIEW_HANDLE) : 0
  const min = available > 0 ? Math.min(0.5, Math.max(0.2, SPLIT_VIEW_PANE_MIN / available)) : 0.5
  const max = 1 - min
  const ratio = Math.max(min, Math.min(max, boundSplitViewRatio(preferred)))
  return { available, min, max, ratio, left: available * ratio, right: available * (1 - ratio), resizable: max - min > 1e-6 }
}
