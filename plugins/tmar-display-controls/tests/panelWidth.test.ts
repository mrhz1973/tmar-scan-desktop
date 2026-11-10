// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { effectivePanelWidth, panelLimits, PANEL_DEFAULT } from '../panelWidth'

describe('bounded resizable panel', () => {
  it('keeps the requested width on a wide screen', () => expect(effectivePanelWidth(520, 1600)).toBe(520))
  it('keeps model space on a narrower window', () => expect(effectivePanelWidth(700, 900)).toBe(568))
  it('limits both extremes', () => { expect(effectivePanelWidth(-1, 1600)).toBe(260); expect(effectivePanelWidth(1000, 1600)).toBe(720) })
  it('uses a safe finite fallback', () => expect(effectivePanelWidth(NaN, 1600)).toBe(PANEL_DEFAULT))
  it('has ordered limits even before layout is measured', () => expect(panelLimits(0)).toEqual({ min: 260, max: 260 }))
})
