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

/**
 * Experimental restricted move for the standard OCCT full-cylinder net,
 * whose weights are constant along V in each U row.
 * Coupled adjacent poles preserve the original derivative mismatch at both
 * internal double knots while the seam and end rows stay unchanged. Thus an
 * already C1 surface remains C1; this does not repair an existing crease.
 * This helper alone does not qualify trims, recipes or interactive editing.
 */
export function moveSmoothCylinderPole(n: Net, delta: Point): Net {
  const step = (n.ku[3]-n.ku[0])/3
  if (n.periodic?.join() !== '1,0' || n.nu !== 6 || n.nv !== 5 || n.du !== 2 || n.dv !== 3 ||
      n.ku.length !== 4 || n.mu.join() !== '2,2,2,2' || n.mv.join() !== '4,1,4' ||
      n.ku.some(x=>!Number.isFinite(x)) || n.rational.length !== 2 || n.rational.some(r=>r!==0 && r!==1) ||
      n.kv.length !== 3 || n.kv.some((x,i)=>!Number.isFinite(x) || (i>0 && x<=n.kv[i-1])) ||
      !Number.isFinite(step) || step <= 0 || Math.abs(n.ku[1]-n.ku[0]-step)>1e-10*step || Math.abs(n.ku[2]-n.ku[1]-step)>1e-10*step ||
      n.poles.length !== 30 || n.weights.length !== 30 || delta.length !== 3 || delta.some(x=>!Number.isFinite(x)) ||
      n.poles.some(p=>p.length !== 3 || p.some(x=>!Number.isFinite(x))) || n.weights.some(w=>!Number.isFinite(w) || w<=0) ||
      (!n.rational.some(Boolean) && n.weights.some(w=>w!==1)))
    throw new Error('Movimento periodico non supportato per questo reticolo.')
  for(let u=0;u<n.nu;u++) for(let v=1;v<n.nv;v++) {
    const a=n.weights[u*n.nv],b=n.weights[u*n.nv+v]
    if(Math.abs(a-b)>1e-12*Math.max(a,b)) throw new Error('Pesi periodici variabili lungo V non supportati.')
  }
  const indices=[2*n.nv+2,3*n.nv+2,4*n.nv+2], weights=[1,3,5].map(u=>n.weights[u*n.nv+2])
  if(!Number.isFinite(weights[0]+weights[1]) || !Number.isFinite(weights[1]+weights[2])) throw new Error('Pesi periodici fuori intervallo.')
  const factors=[weights[1]/(weights[0]+weights[1]),1,weights[1]/(weights[1]+weights[2])]
  if (factors.some(x=>!Number.isFinite(x))) throw new Error('Pesi periodici non validi.')
  const result=structuredClone(n)
  for(let i=0;i<indices.length;i++) for(let d=0;d<3;d++) {
    result.poles[indices[i]][d]+=delta[d]*factors[i]
    if(!Number.isFinite(result.poles[indices[i]][d])) throw new Error('Spostamento periodico non valido.')
  }
  return result
}
