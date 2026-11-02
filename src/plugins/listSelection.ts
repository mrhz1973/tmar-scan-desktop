// SPDX-License-Identifier: AGPL-3.0-only
// Ordered, ID-based selection shared by optional list extensions.
import { useEffect, useState } from 'react'
import { useHistory } from '../state/historyStore'
export interface ListSelection { ids: number[]; anchor: number | null }
export interface SelectionKeys { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }
export const emptySelection = (): ListSelection => ({ ids: [], anchor: null })
export function selectRow(current: ListSelection, order: readonly number[], id: number, keys: SelectionKeys): ListSelection {
  if (!order.includes(id)) return current
  const additive = keys.ctrlKey || keys.metaKey
  const retained = current.ids.filter((n) => order.includes(n))
  if (keys.shiftKey && current.anchor !== null && order.includes(current.anchor)) {
    const a = order.indexOf(current.anchor), b = order.indexOf(id)
    const range = order.slice(Math.min(a, b), Math.max(a, b) + 1)
    const wanted = new Set(additive ? [...retained, ...range] : range)
    return { ids: order.filter((n) => wanted.has(n)), anchor: current.anchor }
  }
  const wanted = new Set(additive ? retained : [])
  if (additive && wanted.has(id)) wanted.delete(id)
  else wanted.add(id)
  return { ids: order.filter((n) => wanted.has(n)), anchor: id }
}
export function useListSelection(order: readonly number[], epoch: unknown) {
  const [state, set] = useState<ListSelection>(emptySelection)
  const importing = useHistory((s) => s.importing)
  const key = order.join(',')
  useEffect(() => { set(emptySelection()) }, [epoch, importing])
  useEffect(() => {
    const valid = new Set(order)
    set((s) => s.ids.every((id) => valid.has(id)) && (s.anchor === null || valid.has(s.anchor)) ? s :
      { ids: s.ids.filter((id) => valid.has(id)), anchor: s.anchor !== null && valid.has(s.anchor) ? s.anchor : null })
  }, [key]) // Stable IDs: newly generated rows are never auto-selected.
  return {
    ids: state.ids.filter((id) => order.includes(id)),
    select: (id: number, keys: SelectionKeys) => set((s) => selectRow(s, order, id, keys)),
    all: () => set({ ids: [...order], anchor: order[0] ?? null }),
    clear: () => set(emptySelection()),
  }
}
