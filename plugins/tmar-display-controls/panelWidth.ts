// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand'
export const PANEL_MIN = 260, PANEL_MAX = 720, PANEL_DEFAULT = 336, DIVIDER_WIDTH = 12
const STORAGE_KEY = 'tmar.layout.panelWidth.v1'
export function panelLimits(available: number) {
  return { min: PANEL_MIN, max: Math.max(PANEL_MIN, Math.min(PANEL_MAX, available - 320 - DIVIDER_WIDTH)) }
}
export function effectivePanelWidth(value: number, available: number): number {
  const { min, max } = panelLimits(available)
  return Math.round(Math.max(min, Math.min(max, Number.isFinite(value) ? value : PANEL_DEFAULT)))
}
function readWidth(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const width = raw === null ? PANEL_DEFAULT : Number(raw)
    return Number.isFinite(width) && width >= PANEL_MIN && width <= PANEL_MAX ? width : PANEL_DEFAULT
  } catch { return PANEL_DEFAULT }
}
export const usePanelWidth = create<{ width: number; setWidth: (width: number, persist?: boolean) => void }>((set) => ({
  width: readWidth(),
  setWidth(width, persist = true) {
    if (!Number.isFinite(width)) return
    const next = Math.round(Math.max(PANEL_MIN, Math.min(PANEL_MAX, width)))
    if (persist) { try { localStorage.setItem(STORAGE_KEY, String(next)) } catch { /* Optional browser preference. */ } }
    set({ width: next })
  },
}))
