// SPDX-License-Identifier: AGPL-3.0-only
import type { Net } from './brep'

export type NetSelectionMode = 'auto' | 'points' | 'edges' | 'cells' | 'mixed'
type NetShape = Pick<Net, 'nu' | 'nv' | 'periodic'>
export function netEdges(n: NetShape): [number, number][] {
  const edges: [number, number][] = []
  for (let u = 0; u < n.nu; u++) for (let v = 0; v < n.nv; v++) {
    const i = u * n.nv + v
    if (u + 1 < n.nu) edges.push([i, i + n.nv])
    else if (n.periodic?.[0] && n.nu > 2) edges.push([i, v])
    if (v + 1 < n.nv) edges.push([i, i + 1])
    else if (n.periodic?.[1] && n.nv > 2) edges.push([i, u*n.nv])
  }
  return edges
}
export function netCells(n: NetShape): [number, number, number, number][] {
  const cells: [number, number, number, number][] = []
  const us = n.nu-1 + (n.periodic?.[0] && n.nu>2 ? 1 : 0)
  const vs = n.nv-1 + (n.periodic?.[1] && n.nv>2 ? 1 : 0)
  for(let u=0;u<us;u++) for(let v=0;v<vs;v++) {
    const nextU=(u+1)%n.nu, nextV=(v+1)%n.nv
    cells.push([u*n.nv+v,nextU*n.nv+v,nextU*n.nv+nextV,u*n.nv+nextV])
  }
  return cells
}
export function selectNetPoints(selected: number[], hit: number[], multi: boolean): number[] {
  const all = hit.every(i => selected.includes(i))
  if (!multi) return all ? selected : [...hit]
  return all ? selected.filter(i => !hit.includes(i)) : [...new Set([...selected, ...hit])]
}
