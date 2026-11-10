// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react'
import { useUnits } from '../../src/app/useUnits'
import { changeSurfaceLengthUnits, createSurfaceLengthInput, editSurfaceLengthInput } from './surfaceDisplay'

/** Editable decimal prefixes and commas are preserved until the unit changes.
 * The canonical value does not inherit rounding from the displayed text. */
export function useSurfaceLengthInput(initialMillimetres: number): readonly [string, (text: string) => void, number | null] {
  const units = useUnits()
  const [input, setInput] = useState(() => createSurfaceLengthInput(initialMillimetres, units))
  const current = changeSurfaceLengthUnits(input, units)
  useEffect(() => { setInput(previous => changeSurfaceLengthUnits(previous, units)) }, [units])
  return [current.text, text => setInput(editSurfaceLengthInput(text, units)), current.millimetres]
}
