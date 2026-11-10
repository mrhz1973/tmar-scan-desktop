// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import {
  changeSurfaceLengthUnits, createSurfaceLengthInput, editSurfaceLengthInput,
  formatSurfaceDisplacementUpper, formatSurfaceResidual,
} from '../surfaceDisplay'

describe('surface editor lengths in the selected display unit', () => {
  it('interprets decimal commas and signs in inches while returning physical millimetres', () => {
    expect(editSurfaceLengthInput('0,5', 'in')).toMatchObject({ text: '0,5', millimetres: 12.7 })
    expect(editSurfaceLengthInput('-0.5', 'in').millimetres).toBe(-12.7)
    expect(editSurfaceLengthInput('0,5', 'mm').millimetres).toBe(0.5)
  })

  it('keeps decimal prefixes editable and prevents invalid or overflowing edits from becoming actions', () => {
    for (const text of ['0.', '0,', '-0,']) {
      const input = editSurfaceLengthInput(text, 'in')
      expect(input.text).toBe(text)
      expect(Math.abs(input.millimetres!)).toBe(0)
    }
    for (const text of ['', '-', '.', '1e-', 'Infinity', '1e308']) {
      expect(editSurfaceLengthInput(text, 'in')).toMatchObject({ text, millimetres: null })
    }
  })

  it('preserves the exact physical value through repeated unit changes despite rounded input text', () => {
    let input = createSurfaceLengthInput(1, 'mm')
    for (let i = 0; i < 20; i++) {
      input = changeSurfaceLengthUnits(input, 'in')
      expect(input.text).toBe('0.03937')
      expect(input.millimetres).toBe(1)
      input = changeSurfaceLengthUnits(input, 'mm')
      expect(input.text).toBe('1')
      expect(input.millimetres).toBe(1)
    }
    input = editSurfaceLengthInput('0,5', 'in')
    expect(changeSurfaceLengthUnits(input, 'mm')).toMatchObject({ text: '12.7', millimetres: 12.7 })
  })

  it('never reinterprets incomplete text in another unit', () => {
    const input = editSurfaceLengthInput('1e-', 'mm')
    expect(changeSurfaceLengthUnits(input, 'mm')).toBe(input)
    expect(changeSurfaceLengthUnits(input, 'in')).toMatchObject({ text: '', millimetres: null })
  })

  it('converts small residuals without displaying them as a zero fixed-decimal length', () => {
    expect(formatSurfaceResidual(0.0000254, 'in')).toBe('1.00e-6 in')
    expect(formatSurfaceResidual(0.0000254, 'mm')).toBe('2.54e-5 mm')
  })
})

describe('surface displacement upper-bound display', () => {
  it('rounds outward in both unit systems, including a positive subnormal bound', () => {
    expect(formatSurfaceDisplacementUpper(0, 'mm')).toBe('0,000 mm')
    expect(formatSurfaceDisplacementUpper(0, 'in')).toBe('0,0000 in')
    expect(formatSurfaceDisplacementUpper(-0, 'in')).toBe('0,0000 in')
    expect(formatSurfaceDisplacementUpper(0.09800000000000002, 'mm')).toBe('0,099 mm')
    expect(formatSurfaceDisplacementUpper(0.09800000000000002, 'in')).toBe('0,0039 in')
    expect(formatSurfaceDisplacementUpper(Number.MIN_VALUE, 'mm')).toBe('0,001 mm')
    expect(formatSurfaceDisplacementUpper(Number.MIN_VALUE, 'in')).toBe('0,0001 in')
  })

  it('keeps exact unit boundaries and does not round a just-larger bound down', () => {
    expect(formatSurfaceDisplacementUpper(25.4, 'in')).toBe('1,0000 in')
    expect(formatSurfaceDisplacementUpper(25.400000000000002, 'in')).toBe('1,0001 in')
    expect(formatSurfaceDisplacementUpper(1, 'mm')).toBe('1,000 mm')
    expect(formatSurfaceDisplacementUpper(1.0000000000000002, 'mm')).toBe('1,001 mm')
  })

  it('refuses a non-finite or negative bound instead of presenting it as safe', () => {
    for (const bound of [-1, NaN, Infinity]) {
      expect(() => formatSurfaceDisplacementUpper(bound, 'in')).toThrow('Limite di spostamento non valido')
    }
  })
})
