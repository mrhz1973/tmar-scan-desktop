// SPDX-License-Identifier: AGPL-3.0-only
import type { KnotInsertion } from './refineClampedNet'

/** An isolated candidate generator, not a CAD or trim-safety certificate.
 * Inputs are UV bounding boxes of the outer face and one inner contour. */
export function adaptiveTrimPlan(outer: readonly [number,number,number,number], inner: readonly [number,number,number,number]): KnotInsertion[] {
  if (![...outer,...inner].every(Number.isFinite)) throw new Error('Dominio non finito.')
  const [u0,u1,v0,v1]=outer, [iu0,iu1,iv0,iv1]=inner
  const su=u1-u0, sv=v1-v0
  if (!(su>0 && sv>0 && iu0>=u0 && iu1<=u1 && iv0>=v0 && iv1<=v1 && iu1>iu0 && iv1>iv0))
    throw new Error('Contorno interno non qualificabile.')
  const candidates=[
    {axis:'U' as const,gap:iu0-u0,edge:u0,sign:1,span:su,other0:v0,other1:v1},
    {axis:'U' as const,gap:u1-iu1,edge:u1,sign:-1,span:su,other0:v0,other1:v1},
    {axis:'V' as const,gap:iv0-v0,edge:v0,sign:1,span:sv,other0:u0,other1:u1},
    {axis:'V' as const,gap:v1-iv1,edge:v1,sign:-1,span:sv,other0:u0,other1:u1},
  ].filter(c=>c.gap>1e-7*Math.max(1,c.span) && 1.25*c.gap<c.span*.25)
  candidates.sort((a,b)=>b.gap-a.gap)
  const c=candidates[0]
  if(!c) throw new Error('Nessuna fascia interna qualificabile.')
  const otherAxis=c.axis==='U'?'V':'U', midpoint=(c.other0+c.other1)/2
  const low=Math.max(c.other0,midpoint-3*c.gap), high=Math.min(c.other1,midpoint+3*c.gap)
  const plan:KnotInsertion[]=[]
  for(let i=1;i<=24;i++) {
    plan.push({axis:c.axis,value:c.edge+c.sign*1.25*c.gap*i/25,count:1})
    plan.push({axis:otherAxis,value:low+(high-low)*i/25,count:1})
  }
  // The starting exact planar net has nine uniform knots in each axis.
  // Reject numerical coincidences rather than silently changing multiplicity.
  for(const item of plan) {
    const lo=item.axis==='U'?u0:v0, hi=item.axis==='U'?u1:v1, span=hi-lo
    if(!Number.isFinite(item.value)||!(item.value>lo&&item.value<hi) ||
      Array.from({length:9},(_,j)=>lo+span*j/8).some(k=>Math.abs(k-item.value)<=1e-12*span))
      throw new Error('Nodi del raffinamento non qualificabili.')
  }
  return plan
}
