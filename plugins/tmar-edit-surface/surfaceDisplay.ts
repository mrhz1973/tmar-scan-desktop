// SPDX-License-Identifier: AGPL-3.0-only
import { MM_PER_INCH, fromDisplay, lengthDecimals, lengthInputText, toDisplay, unitWord, type DisplayUnits } from '../../src/core/units'
import { parseNumericInput } from './numericInput'

/** Keep the physical value independently of rounded display text. A preference
 * change must never become a geometry edit, including after repeated toggles. */
export interface SurfaceLengthInput {
  readonly units: DisplayUnits
  readonly text: string
  readonly millimetres: number | null
}

export function createSurfaceLengthInput(millimetres: number, units: DisplayUnits): SurfaceLengthInput {
  return { units, text: lengthInputText(millimetres, units), millimetres }
}

export function editSurfaceLengthInput(text: string, units: DisplayUnits): SurfaceLengthInput {
  const parsed = parseNumericInput(text)
  const millimetres = parsed === null ? null : fromDisplay(parsed, units)
  return { units, text, millimetres: millimetres !== null && Number.isFinite(millimetres) ? millimetres : null }
}

export function changeSurfaceLengthUnits(input: SurfaceLengthInput, units: DisplayUnits): SurfaceLengthInput {
  if (input.units === units) return input
  return { units, text: input.millimetres === null ? '' : lengthInputText(input.millimetres, units), millimetres: input.millimetres }
}

export function formatSurfaceResidual(millimetres: number, units: DisplayUnits): string {
  return `${toDisplay(millimetres, units).toExponential(2)} ${unitWord(units)}`
}

/** Exact positive binary64 ratio, used only to round a displayed upper bound.
 * Ordinary nearest rounding could make the displayed displacement too small. */
function binaryRatio(value: number): readonly [bigint, bigint] {
  if (value === 0) return [0n, 1n]
  const view = new DataView(new ArrayBuffer(8))
  view.setFloat64(0, value)
  const bits = view.getBigUint64(0), exponent = Number(bits >> 52n)
  const mantissa = bits & ((1n << 52n) - 1n)
  const significand = exponent ? mantissa | (1n << 52n) : mantissa
  const shift = exponent ? exponent - 1075 : -1074
  return shift >= 0 ? [significand << BigInt(shift), 1n] : [significand, 1n << BigInt(-shift)]
}

/** Display-only conversion: the certified bound and all CAD criteria stay in
 * the original internal unit. Ceil the exact ratio at the displayed precision. */
export function formatSurfaceDisplacementUpper(bound: number, units: DisplayUnits): string {
  if (!Number.isFinite(bound) || bound < 0) throw Error('Limite di spostamento non valido.')
  const digits = lengthDecimals(3, units), scale = 10n ** BigInt(digits)
  const [numerator, denominator] = binaryRatio(bound)
  const [unitNumerator, unitDenominator] = binaryRatio(units === 'in' ? MM_PER_INCH : 1)
  const n = numerator * unitDenominator * scale, d = denominator * unitNumerator
  const ticks = (n + d - 1n) / d
  return `${ticks / scale},${String(ticks % scale).padStart(digits, '0')} ${unitWord(units)}`
}
