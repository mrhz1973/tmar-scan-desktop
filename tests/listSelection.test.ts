// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { emptySelection, selectRow } from '../src/plugins/listSelection'
const rows = Array.from({ length: 100 }, (_, i) => i + 1)
describe('stable multi-selection', () => {
  it('plain click replaces selection', () => { expect(selectRow({ ids: [1, 4], anchor: 1 }, rows, 9, {})).toEqual({ ids: [9], anchor: 9 }) })
  it('Ctrl toggles non-adjacent rows', () => {
    const a = selectRow(emptySelection(), rows, 1, {})
    const b = selectRow(a, rows, 40, { ctrlKey: true })
    expect(b.ids).toEqual([1, 40])
    expect(selectRow(b, rows, 1, { ctrlKey: true }).ids).toEqual([40])
  })
  it('Cmd has the same additive behavior', () => { expect(selectRow({ ids: [3], anchor: 3 }, rows, 7, { metaKey: true }).ids).toEqual([3, 7]) })
  it('Shift selects the full logical range, not the viewport', () => { expect(selectRow({ ids: [1], anchor: 1 }, rows, 80, { shiftKey: true }).ids).toEqual(rows.slice(0, 80)) })
  it('reversed ranges preserve the anchor', () => { expect(selectRow({ ids: [8], anchor: 8 }, rows, 4, { shiftKey: true })).toEqual({ ids: [4, 5, 6, 7, 8], anchor: 8 }) })
  it('Ctrl+Shift adds a range and removes stale IDs', () => { expect(selectRow({ ids: [2, 999], anchor: 5 }, rows, 7, { ctrlKey: true, shiftKey: true }).ids).toEqual([2, 5, 6, 7]) })
  it('a removed anchor does not select an arbitrary range', () => { expect(selectRow({ ids: [2], anchor: 999 }, rows, 7, { shiftKey: true }).ids).toEqual([7]) })
  it('a missing row is a no-op', () => { const s = { ids: [3], anchor: 3 }; expect(selectRow(s, rows, 999, {})).toBe(s) })
})
