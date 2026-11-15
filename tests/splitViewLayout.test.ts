// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { boundSplitViewRatio, parseSplitViewRatio, splitViewLayout, SPLIT_VIEW_HANDLE, SPLIT_VIEW_PANE_MIN } from '../src/ui/splitViewLayout'

describe('comparison split layout policy', () => {
  it('defaults absent and invalid preferences to equal panes', () => {
    for (const raw of [null, '', ' ', 'NaN', 'Infinity', '-Infinity', 'undefined', '{}']) expect(parseSplitViewRatio(raw)).toBe(0.5)
  })
  it('bounds finite preferences without producing a collapsed pane', () => {
    expect(parseSplitViewRatio('0.65')).toBe(0.65)
    expect(boundSplitViewRatio(-10)).toBe(0.2)
    expect(boundSplitViewRatio(10)).toBe(0.8)
    expect(boundSplitViewRatio(NaN)).toBe(0.5)
  })
  it('leaves exactly the handle width between equal panes', () => {
    const s = splitViewLayout(1212, 0.5)
    expect(s.left).toBe(600); expect(s.right).toBe(600)
    expect(s.min).toBe(0.2); expect(s.max).toBe(0.8); expect(s.resizable).toBe(true)
  })
  it('clamps to a minimum readable pane without rewriting the preferred ratio', () => {
    const preferred = 0.75
    const narrow = splitViewLayout(612, preferred)
    expect(narrow.left).toBe(360); expect(narrow.right).toBe(240)
    expect(splitViewLayout(1612, preferred).ratio).toBe(preferred)
  })
  it('falls back to equal panes when the container cannot fit both minimums', () => {
    for (const width of [0, 5, 12, 320, 491, 492, NaN, Infinity, -1]) {
      const s = splitViewLayout(width, 0.8)
      expect(s.ratio).toBe(0.5); expect(s.left).toBe(s.right); expect(s.resizable).toBe(false)
    }
  })
  it('never overflows or collapses a pane for finite available widths', () => {
    for (let width = 13; width < 3000; width += 17) for (const preferred of [-1, 0.2, 0.5, 0.75, 3, NaN]) {
      const s = splitViewLayout(width, preferred)
      expect(s.left + s.right + SPLIT_VIEW_HANDLE).toBeCloseTo(width, 8)
      expect(s.left).toBeGreaterThan(0); expect(s.right).toBeGreaterThan(0)
      if (width >= 2 * SPLIT_VIEW_PANE_MIN + SPLIT_VIEW_HANDLE) {
        expect(s.left).toBeGreaterThanOrEqual(SPLIT_VIEW_PANE_MIN - 1e-10)
        expect(s.right).toBeGreaterThanOrEqual(SPLIT_VIEW_PANE_MIN - 1e-10)
      }
    }
  })
})
