// SPDX-License-Identifier: AGPL-3.0-only
import type {Net,Point} from './brep'
import {targetSurfacePoint,type SurfacePointTarget} from './surfacePointTarget'

export interface SimultaneousSurfaceTargets extends Omit<SurfacePointTarget,'u'|'v'|'target'> {
  points:readonly {u:number;v:number;target:Point}[]
}
/** Candidate computation refused before any CAD request or geometry commit.
 * A controller may keep its review list only while all ownership fences hold. */
export class SurfacePointTargetsCandidateRefusal extends Error {
  constructor(cause:unknown){
    super(cause instanceof Error?cause.message:String(cause),{cause})
    this.name='SurfacePointTargetsCandidateRefusal'
  }
}

/** Experimental finite point constraints, not region/global surface fitting.
 * Reuses the qualified single-point minimum-norm projection unchanged.
 * Cyclic orthogonal projections approach the intersection of the affine
 * constraints; acceptance always requires ALL residuals on the SAME net.
 * Slow/degenerate systems conservatively refuse after a fixed work limit.
 * The caller owns trim/anchor/reference validation and one CAD/history commit. */
export function targetSurfacePointsExperimental(source:Net,request:SimultaneousSurfaceTargets){
  const owned=structuredClone(request),{points,...options}=owned
  if(!Array.isArray(points)||points.length<2||points.length>8||!Number.isFinite(options.maxPoleDisplacement)||
    options.maxPoleDisplacement<=0||options.maxPoleDisplacement>1000)
    throw Error('Sono richiesti da due a otto vincoli e un budget finito entro 1000 mm.')
  if(points.some((p,i)=>!p||points.slice(0,i).some(q=>p.u===q.u&&p.v===q.v)))
    throw Error('Punti superficie duplicati o vincoli ambigui.')
  // Each call also independently validates the clamped basis, rational weights,
  // authorized poles, influence, finite targets and each requested UV domain.
  const initial=points.map(p=>targetSurfacePoint(source,{...options,...p}))
  const before=initial.map(r=>r.before)
  let net=initial[0].net,maxPoleDisplacement=0
  const checkBudget=()=>{
    maxPoleDisplacement=Math.max(...net.poles.map((p,i)=>Math.hypot(...p.map((x,d)=>x-source.poles[i][d]))))
    if(!Number.isFinite(maxPoleDisplacement)||maxPoleDisplacement>options.maxPoleDisplacement)
      throw Error('Spostamento cumulativo dei poli oltre il limite autorizzato.')
  }
  checkBudget()
  for(let pass=1;pass<=64;pass++){
    for(const p of points){
      net=targetSurfacePoint(net,{...options,...p}).net
      checkBudget()
    }
    // Probe the final common net through the same rational evaluator. Its
    // discarded candidate never enters the result or the caller's history.
    const after=points.map(p=>targetSurfacePoint(net,{...options,...p}).before)
    const residuals=after.map((p,i)=>Math.hypot(...p.map((x,d)=>x-points[i].target[d])))
    if(residuals.every(r=>Number.isFinite(r)&&r<=options.residualTolerance))
      return {net,before,after,residuals,maxPoleDisplacement,passes:pass}
  }
  throw Error('Vincoli simultanei non risolti entro il limite: nessun candidato pubblicabile.')
}
