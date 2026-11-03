// SPDX-License-Identifier: AGPL-3.0-only
import type { Net } from './brep'

export type NetSelectionMode = 'auto' | 'points' | 'edges' | 'cells' | 'mixed'
export function netEdges(n: Pick<Net, 'nu' | 'nv'>): [number, number][] {
  const edges: [number, number][] = []
  for (let u = 0; u < n.nu; u++) for (let v = 0; v < n.nv; v++) {
    const i = u * n.nv + v
    if (u + 1 < n.nu) edges.push([i, i + n.nv])
    if (v + 1 < n.nv) edges.push([i, i + 1])
  }
  return edges
}
export function selectNetPoints(selected: number[], hit: number[], multi: boolean): number[] {
  const all = hit.every(i => selected.includes(i))
  if (!multi) return all ? selected : [...hit]
  return all ? selected.filter(i => !hit.includes(i)) : [...new Set([...selected, ...hit])]
}
