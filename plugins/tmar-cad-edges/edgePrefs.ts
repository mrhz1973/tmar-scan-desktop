// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand'
export interface EdgePrefs { enabled: boolean; color: string; width: number }
export const DEFAULT_EDGES: EdgePrefs = { enabled: true, color: '#171b20', width: 2 }
export const EDGE_PREFS_KEY = 'tmar.cadEdges.v1'
export function normalizeEdges(value: unknown): EdgePrefs {
  const v = value && typeof value === 'object' ? value as Partial<EdgePrefs> : {}
  return { enabled: typeof v.enabled === 'boolean' ? v.enabled : DEFAULT_EDGES.enabled,
    color: typeof v.color === 'string' && /^#[0-9a-f]{6}$/i.test(v.color) ? v.color : DEFAULT_EDGES.color,
    width: typeof v.width === 'number' && Number.isFinite(v.width) ? Math.max(1, Math.min(6, v.width)) : DEFAULT_EDGES.width }
}
const read = () => { try { return normalizeEdges(JSON.parse(localStorage.getItem(EDGE_PREFS_KEY) ?? 'null')) } catch { return { ...DEFAULT_EDGES } } }
export const useCadEdges = create<EdgePrefs & { update(patch: Partial<EdgePrefs>): void }>((set, get) => ({
  ...read(), update: (patch) => { const next = normalizeEdges({ ...get(), ...patch }); set(next)
    try { localStorage.setItem(EDGE_PREFS_KEY, JSON.stringify(next)) } catch { /* Display remains usable without storage. */ }
  },
}))
