// SPDX-License-Identifier: AGPL-3.0-only
/** Parse an editable decimal, allowing the keyboard's comma decimal separator. */
export function parseNumericInput(text: string): number | null {
  const normalized = text.trim().replace(',', '.')
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null
  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}
