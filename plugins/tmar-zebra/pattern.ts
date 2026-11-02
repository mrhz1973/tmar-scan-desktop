// SPDX-License-Identifier: AGPL-3.0-only
// Stripe pattern adapted from the owner's SurfaceLab zebra-pattern.js.

export type Orientation = 'horizontal' | 'vertical'
export const PATTERN_SIZE = 1024

/** Keep the stripe count tied to the reflected environment, not millimetres. */
export function stripePattern(level: number, orientation: Orientation, color: string): Uint8Array {
  if (!Number.isInteger(level) || level < 1 || level > 7) throw new Error('Stripe width must be between 1 and 7.')
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Stripe color must be a six-digit hex color.')
  const rgb = [1, 3, 5].map((at) => Number.parseInt(color.slice(at, at + 2), 16))
  const band = 2 ** (level + 2)
  const data = new Uint8Array(PATTERN_SIZE * PATTERN_SIZE * 4)
  for (let y = 0; y < PATTERN_SIZE; y++) {
    for (let x = 0; x < PATTERN_SIZE; x++) {
      const colored = Math.floor((orientation === 'vertical' ? x : y) / band) % 2 !== 0
      const at = (y * PATTERN_SIZE + x) * 4
      data[at] = colored ? rgb[0] : 210
      data[at + 1] = colored ? rgb[1] : 210
      data[at + 2] = colored ? rgb[2] : 210
      data[at + 3] = 255
    }
  }
  return data
}
