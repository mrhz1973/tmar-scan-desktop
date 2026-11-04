// SPDX-License-Identifier: AGPL-3.0-only
import type { Net, Point } from './brep'

/**
 * Exactly elevate a periodic-U, linear-V rational surface and insert its
 * midpoint knot. This exposes one interior V row without fitting the surface.
 * It does not establish seam/trim safety and does not enable editing.
 */
export function refineLinearPeriodicV(n: Net): Net {
  if (n.periodic?.join() !== '1,0' || n.dv !== 1 || n.nv !== 2 ||
      !Number.isInteger(n.nu) || n.nu < 2 || !Number.isInteger(n.du) || n.du < 1 || n.du >= n.nu ||
      n.ku.length < 2 || n.ku.length !== n.mu.length ||
      n.ku.some((k,i) => !Number.isFinite(k) || (i > 0 && k <= n.ku[i-1])) ||
      n.mu.some(m => !Number.isInteger(m) || m < 1 || m > n.du+1) ||
      n.rational.length !== 2 || n.rational.some(r => r !== 0 && r !== 1) ||
      n.mv.join() !== '2,2' || n.kv.length !== 2 ||
      !Number.isFinite(n.kv[0]) || !Number.isFinite(n.kv[1]) || n.kv[1] <= n.kv[0] ||
      n.poles.length !== n.nu * 2 || n.weights.length !== n.poles.length ||
      n.poles.some(p => p.length !== 3 || p.some(x => !Number.isFinite(x))) ||
      n.weights.some(w => !Number.isFinite(w) || w <= 0) ||
      (!n.rational.some(Boolean) && n.weights.some(w => w !== 1)))
    throw new Error('Reticolo periodico non supportato per il raffinamento esatto.')
  const poles: Point[] = [], weights: number[] = []
  for (let u = 0; u < n.nu; u++) for (const t of [0, 1/6, 1/2, 5/6, 1]) {
    const a = u*2, b = a+1, w = (1-t)*n.weights[a] + t*n.weights[b]
    const p = [0,1,2].map(d => ((1-t)*n.poles[a][d]*n.weights[a] + t*n.poles[b][d]*n.weights[b]) / w) as Point
    if (!Number.isFinite(w) || w <= 0 || p.some(x => !Number.isFinite(x))) throw new Error('Raffinamento periodico numericamente non valido.')
    poles.push(p)
    weights.push(w)
  }
  const midpoint = n.kv[0]/2+n.kv[1]/2
  if (!(midpoint > n.kv[0] && midpoint < n.kv[1])) throw new Error('Intervallo periodico troppo piccolo per il raffinamento.')
  return { ...n, poles, weights, nv: 5, dv: 3, kv: [n.kv[0], midpoint, n.kv[1]], mv: [4,1,4] }
}
