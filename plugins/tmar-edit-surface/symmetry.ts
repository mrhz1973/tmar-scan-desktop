// SPDX-License-Identifier: AGPL-3.0-only
import type { Point } from './brep'

// Match in model coordinates so a rotated or reversed UV grid needs no special case.
// An ambiguous match cannot identify which control point the user intended.
export function mirrorPartners(poles: Point[], axis: number, offset: number): number[] {
  const tolerance = 1e-7
  const partners = poles.map(p => {
    const reflected = 2 * offset - p[axis]
    let partner = -1
    for (let i = 0; i < poles.length; i++) {
      if (!poles[i].every((x, d) => Math.abs(x - (d === axis ? reflected : p[d])) <= tolerance)) continue
      if (partner !== -1) return -1
      partner = i
    }
    return partner
  })
  return partners.map((j, i) => partners[j] === i ? j : -1)
}

export function mirrorEdit(start: Point[], requested: Point[], partners: number[], axis: number, offset: number, locked: number[]): Point[] {
  const result = start.slice(), fixed = new Set(locked)
  const changed = start.map((p, i) => p.some((x, d) => x !== requested[i][d]))
  for (let i = 0; i < start.length; i++) {
    if (!changed[i]) continue
    const j = partners[i]
    if (j < 0 || fixed.has(i) || fixed.has(j)) throw new Error('Modifica simmetrica impossibile: polo speculare assente, ambiguo o bloccato.')
    if (j < i && changed[j]) continue
    const a = requested[i].slice() as Point
    if (i === j) a[axis] = offset
    else if (changed[j]) {
      // When a group spans the plane, retain the symmetric part of its movement.
      for (let d = 0; d < 3; d++) a[d] = (a[d] + (d === axis ? 2 * offset - requested[j][d] : requested[j][d])) / 2
    }
    result[i] = a
    if (i !== j) { result[j] = [...a]; result[j][axis] = 2 * offset - a[axis] }
  }
  return result
}
