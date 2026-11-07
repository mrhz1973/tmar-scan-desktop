// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { parseNumericInput } from '../numericInput'

describe('parseNumericInput', () => {
  it('accepts decimal point and comma while preserving decimal entry prefixes', () => {
    expect(parseNumericInput('0.5')).toBe(0.5)
    expect(parseNumericInput('0,5')).toBe(0.5)
    expect(parseNumericInput('0.')).toBe(0)
    expect(parseNumericInput('0,')).toBe(0)
    expect(parseNumericInput('12,')).toBe(12)
    expect(parseNumericInput('1e-6')).toBe(1e-6)
    expect(parseNumericInput('1,2E+2')).toBe(120)
    expect(parseNumericInput('1e-')).toBeNull()
    expect(['0', '0.', '0.5'].map(parseNumericInput)).toEqual([0, 0, 0.5])
  })

  it('accepts signed values and refuses blank or incomplete input', () => {
    expect(parseNumericInput('-0,25')).toBe(-0.25)
    expect(parseNumericInput('+2')).toBe(2)
    expect(parseNumericInput('')).toBeNull()
    expect(parseNumericInput('-')).toBeNull()
    expect(parseNumericInput('.')).toBeNull()
  })

  it('rejects malformed or non-finite values', () => {
    expect(parseNumericInput('1,2,3')).toBeNull()
    expect(parseNumericInput('Infinity')).toBeNull()
    expect(parseNumericInput('1e999')).toBeNull()
  })
})
