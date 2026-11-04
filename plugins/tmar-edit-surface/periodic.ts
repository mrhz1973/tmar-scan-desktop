// SPDX-License-Identifier: AGPL-3.0-only
import type { Net, Point } from './brep'

/**
 * Exactly elevate a periodic-U, linear-V rational surface and insert its
 * knots. Five rows expose one interior V row; six expose two independent rows,
 * without fitting the surface.
 * It does not establish seam/trim safety and does not enable editing.
 */
export function refineLinearPeriodicV(n: Net, rows: 5 | 6 = 5): Net {
  if ((rows !== 5 && rows !== 6) || n.periodic?.join() !== '1,0' || n.dv !== 1 || n.nv !== 2 ||
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
  const parameters = rows === 6 ? [0, 1/9, 1/3, 2/3, 8/9, 1] : [0, 1/6, 1/2, 5/6, 1]
  for (let u = 0; u < n.nu; u++) for (const t of parameters) {
    const a = u*2, b = a+1, w = (1-t)*n.weights[a] + t*n.weights[b]
    const p = [0,1,2].map(d => ((1-t)*n.poles[a][d]*n.weights[a] + t*n.poles[b][d]*n.weights[b]) / w) as Point
    if (!Number.isFinite(w) || w <= 0 || p.some(x => !Number.isFinite(x))) throw new Error('Raffinamento periodico numericamente non valido.')
    poles.push(p)
    weights.push(w)
  }
  const midpoint = n.kv[0]/2+n.kv[1]/2
  if (!(midpoint > n.kv[0] && midpoint < n.kv[1])) throw new Error('Intervallo periodico troppo piccolo per il raffinamento.')
  const a=n.kv[0], b=n.kv[1], one=a+(b-a)/3, two=b-(b-a)/3
  if (rows === 6 && !(one>a && two>one && two<b)) throw new Error('Intervallo periodico troppo piccolo per il raffinamento.')
  return { ...n, poles, weights, nv: rows, dv: 3, kv: rows === 6 ? [a,one,two,b] : [a,midpoint,b], mv: rows === 6 ? [4,1,1,4] : [4,1,4] }
}

/**
 * Experimental restricted move for the standard OCCT full-cylinder net,
 * whose weights are constant along V in each U row.
 * Coupled adjacent poles preserve the original derivative mismatch at both
 * internal double knots while the seam and end rows stay unchanged. Thus an
 * already C1 surface remains C1; this does not repair an existing crease.
 * This helper alone does not qualify trims, recipes or interactive editing.
 */
export function moveSmoothCylinderPole(n: Net, delta: Point, row = 2): Net {
  const step = (n.ku[3]-n.ku[0])/3
  if (n.periodic?.join() !== '1,0' || n.nu !== 6 || (n.nv !== 5 && n.nv !== 6) || n.du !== 2 || n.dv !== 3 ||
      !Number.isInteger(row) || row < 2 || row > n.nv-3 ||
      n.ku.length !== 4 || n.mu.join() !== '2,2,2,2' || n.mv.join() !== (n.nv === 5 ? '4,1,4' : '4,1,1,4') ||
      n.ku.some(x=>!Number.isFinite(x)) || n.rational.length !== 2 || n.rational.some(r=>r!==0 && r!==1) ||
      n.kv.length !== n.nv-2 || n.kv.some((x,i)=>!Number.isFinite(x) || (i>0 && x<=n.kv[i-1])) ||
      !Number.isFinite(step) || step <= 0 || Math.abs(n.ku[1]-n.ku[0]-step)>1e-10*step || Math.abs(n.ku[2]-n.ku[1]-step)>1e-10*step ||
      n.poles.length !== 6*n.nv || n.weights.length !== 6*n.nv || delta.length !== 3 || delta.some(x=>!Number.isFinite(x)) ||
      n.poles.some(p=>p.length !== 3 || p.some(x=>!Number.isFinite(x))) || n.weights.some(w=>!Number.isFinite(w) || w<=0) ||
      (!n.rational.some(Boolean) && n.weights.some(w=>w!==1)))
    throw new Error('Movimento periodico non supportato per questo reticolo.')
  for(let u=0;u<n.nu;u++) for(let v=1;v<n.nv;v++) {
    const a=n.weights[u*n.nv],b=n.weights[u*n.nv+v]
    if(Math.abs(a-b)>1e-12*Math.max(a,b)) throw new Error('Pesi periodici variabili lungo V non supportati.')
  }
  const indices=[2*n.nv+row,3*n.nv+row,4*n.nv+row], weights=[1,3,5].map(u=>n.weights[u*n.nv+row])
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

/** Validate a coupled move independently of the UI. This does not qualify a
 * source face and is not a replacement for the kernel/topology checks. */
export function assertSmoothCylinderMove(base: Net, candidate: Net): void {
  moveSmoothCylinderPole(base,[0,0,0])
  if (JSON.stringify({ ...base, poles: [] }) !== JSON.stringify({ ...candidate, poles: [] }) ||
      candidate.poles.length !== base.poles.length ||
      candidate.poles.some(p=>p.length!==3 || p.some(x=>!Number.isFinite(x))))
    throw new Error('Il reticolo periodico o i suoi parametri sono cambiati.')
  let expected=base
  const coupled=new Set<number>()
  for(let row=2;row<=base.nv-3;row++) {
    const center=3*base.nv+row, delta=base.poles[center].map((x,d)=>candidate.poles[center][d]-x) as Point
    expected=moveSmoothCylinderPole(expected,delta,row)
    coupled.add(2*base.nv+row);coupled.add(4*base.nv+row)
  }
  for(let i=0;i<base.poles.length;i++) for(let d=0;d<3;d++) {
    const distance=Math.abs(candidate.poles[i][d]-expected.poles[i][d])
    if(coupled.has(i) ? distance>1e-9 : distance!==0)
      throw new Error('Il movimento periodico non conserva i punti accoppiati e i bordi protetti.')
  }
}

/** Build the coupled proposal from a captured gesture frame. A viewport may
 * report only the dragged centre pole; other unexpected changes are refused. */
export function canonicalizeCylinderGesture(base: Net, candidate: Net): Net {
  moveSmoothCylinderPole(base,[0,0,0])
  if (JSON.stringify({ ...base, poles: [] }) !== JSON.stringify({ ...candidate, poles: [] }) ||
      candidate.poles.length !== base.poles.length ||
      candidate.poles.some(p=>p.length!==3 || p.some(x=>!Number.isFinite(x))))
    throw new Error('Il reticolo periodico o i suoi parametri sono cambiati.')
  let expected=base
  const coupled=new Set<number>(), centers=new Set<number>()
  for(let row=2;row<=base.nv-3;row++) {
    const center=3*base.nv+row,delta=base.poles[center].map((x,d)=>candidate.poles[center][d]-x) as Point
    expected=moveSmoothCylinderPole(expected,delta,row)
    centers.add(center);coupled.add(2*base.nv+row);coupled.add(4*base.nv+row)
  }
  for(let i=0;i<base.poles.length;i++) for(let d=0;d<3;d++) {
    if(centers.has(i)) continue
    const value=candidate.poles[i][d]
    if(coupled.has(i) ? Math.abs(value-base.poles[i][d])>1e-9 && Math.abs(value-expected.poles[i][d])>1e-9 : value!==base.poles[i][d])
      throw new Error('Il gesto modifica altri punti del reticolo periodico.')
  }
  return expected
}
