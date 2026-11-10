// SPDX-License-Identifier: AGPL-3.0-only
import type { Net, Point } from './brep'

export interface KnotInsertion { axis: 'U' | 'V'; value: number; count: number }
const fail = (): never => { throw new Error('Raffinamento NURBS clamped non valido o oltre il limite.') }

/** Validate independently of the editing guard, which deliberately forbids structural changes. */
function validate(n: Net, max: number): void {
  if (!Number.isInteger(max) || max < 1 || max > 1600 ||
      !Number.isInteger(n.nu) || !Number.isInteger(n.nv) || n.nu < 2 || n.nv < 2 || n.nu * n.nv > max ||
      !Array.isArray(n.rational) || n.rational.length !== 2 || n.rational.some(x => x !== 0 && x !== 1) ||
      (n.periodic !== undefined && (n.periodic.length !== 2 || n.periodic.some(x => x !== 0))) ||
      n.poles.length !== n.nu * n.nv || n.weights.length !== n.poles.length ||
      n.poles.some(p => p.length !== 3 || p.some(x => !Number.isFinite(x))) ||
      n.weights.some(w => !Number.isFinite(w) || w <= 0) ||
      (!n.rational.some(Boolean) && n.weights.some(w => w !== 1))) fail()
  for (const [degree, count, knots, mult] of [[n.du,n.nu,n.ku,n.mu], [n.dv,n.nv,n.kv,n.mv]] as const) {
    if (!Number.isInteger(degree) || degree < 1 || degree > 25 || count <= degree ||
        knots.length < 2 || knots.length !== mult.length ||
        knots.some((x,i) => !Number.isFinite(x) || (i > 0 && x <= knots[i-1])) ||
        mult.some((x,i) => !Number.isInteger(x) || x < 1 || x > degree + (i === 0 || i === mult.length-1 ? 1 : 0)) ||
        mult[0] !== degree+1 || mult.at(-1) !== degree+1 ||
        mult.reduce((sum,x) => sum+x,0) !== count+degree+1) fail()
  }
}

/**
 * Pure exact knot insertion (up to floating point roundoff), never a fit.
 * Keeps the original UV domain, degree and positive rational representation.
 * It changes pole indices and weights; callers must rebuild all protection/index
 * metadata. No topology, trim, recipe, worker or editor state is changed here.
 */
export function refineClampedNet(net: Net, insertions: readonly KnotInsertion[], maxPoles = 1600): Net {
  validate(net,maxPoles)
  // Preflight every insertion and final allocation before doing numerical work.
  const plans = { U: new Map(net.ku.map((x,i) => [x,net.mu[i]])), V: new Map(net.kv.map((x,i) => [x,net.mv[i]])) }
  let nu=net.nu, nv=net.nv
  for (const op of insertions) {
    if (!op || (op.axis !== 'U' && op.axis !== 'V') || !Number.isFinite(op.value) || !Number.isInteger(op.count) || op.count < 1) fail()
    const knots=op.axis === 'U' ? net.ku : net.kv, degree=op.axis === 'U' ? net.du : net.dv
    if (!(op.value > knots[0] && op.value < knots.at(-1)!)) fail()
    const mult=(plans[op.axis].get(op.value) ?? 0)+op.count
    if (mult > degree) fail()
    plans[op.axis].set(op.value,mult)
    if (op.axis === 'U') nu+=op.count; else nv+=op.count
    if (nu*nv > maxPoles) fail()
  }
  let n=structuredClone(net)
  for (const op of insertions) for (let repeat=0;repeat<op.count;repeat++) n=insertOnce(n,op.axis,op.value)
  validate(n,maxPoles)
  return n
}

function insertOnce(n: Net, axis: 'U' | 'V', t: number): Net {
  const isU=axis === 'U', knots=isU?n.ku:n.kv, mult=isU?n.mu:n.mv, degree=isU?n.du:n.dv
  const full=knots.flatMap((x,i) => Array<number>(mult[i]).fill(x))
  const k=full.findIndex((x,i) => x <= t && t < full[i+1]), s=mult[knots.indexOf(t)] ?? 0
  if (k < degree) fail()
  const count=isU?n.nu:n.nv, lines=isU?n.nv:n.nu
  const nu=n.nu+(isU?1:0), nv=n.nv+(isU?0:1), poles:Point[]=new Array(nu*nv), weights:number[]=new Array(nu*nv)
  for (let line=0;line<lines;line++) for (let i=0;i<=count;i++) {
    const old=(j:number) => isU?j*n.nv+line:line*n.nv+j
    const out=isU?i*nv+line:line*nv+i
    if (i <= k-degree || i > k-s) {
      const id=old(i <= k-degree ? i : i-1)
      poles[out]=[...n.poles[id]]; weights[out]=n.weights[id]
    } else {
      const denominator=full[i+degree]-full[i], alpha=(t-full[i])/denominator
      if (!Number.isFinite(denominator) || denominator <= 0 || !Number.isFinite(alpha) || alpha < 0 || alpha > 1) fail()
      const a=old(i), b=old(i-1), wa=alpha*n.weights[a], wb=(1-alpha)*n.weights[b], w=wa+wb
      const point=n.poles[a].map((x,d) => (wa*x+wb*n.poles[b][d])/w) as Point
      if (!Number.isFinite(w) || w <= 0 || point.some(x => !Number.isFinite(x))) fail()
      poles[out]=point; weights[out]=w
    }
  }
  const nextKnots=[...knots], nextMult=[...mult], existing=knots.indexOf(t)
  if (existing >= 0) nextMult[existing]++
  else { const index=knots.findIndex(x => x > t); nextKnots.splice(index,0,t); nextMult.splice(index,0,1) }
  return { ...n, nu,nv,poles,weights, ...(isU?{ku:nextKnots,mu:nextMult}:{kv:nextKnots,mv:nextMult}) }
}
