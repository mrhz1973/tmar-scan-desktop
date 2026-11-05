// SPDX-License-Identifier: AGPL-3.0-only
import { findSpan, calcBasisFunctionDerivatives } from 'three/examples/jsm/curves/NURBSUtils.js'
import type { Net, Point } from './brep'
import { refineClampedNet } from './refineClampedNet'

/** U0/U1 mean constant U; V0/V1 mean constant V. Indices are i*nv+j. */
export type NaturalEdge = 'U0' | 'U1' | 'V0' | 'V1'
export interface PlaneTangencyRequest {
  net: Net
  edge: NaturalEdge
  plane: { point: Point; normal: Point }
  lockIndices: readonly number[]
  /** Preserve the original first derivative of these OTHER natural edges. */
  preserveTangentEdges?: readonly NaturalEdge[]
  /** Model units. This numerical residual budget must be <= 1e-6. */
  distanceTolerance: number
}
export interface PlaneTangencyResult {
  net: Net
  changedIndices: number[]
  edgeRegularity: 'outward-rounded-interval-proof'
  proofLeaves: number
  maxPlaneCoefficientResidual: number
  sampledRegularity: { count: number; minSinAngle: number }
  sampledMaxBoundaryNormalSin: number
  /** Never infer global surface regularity or a certified G1 join from samples. */
  globalG1Certified: false
}
export interface PlaneTangencyValidation extends Omit<PlaneTangencyResult,'net'|'changedIndices'> {
  protectedPoleCount: number
}
const edges: NaturalEdge[] = ['U0', 'U1', 'V0', 'V1']
const fail = (reason: string): never => { throw new Error(`Tangenza piano rifiutata: ${reason}`) }
const dot = (a: readonly number[], b: readonly number[]) => a.reduce((s, x, i) => s + x*b[i], 0)
const sub = (a: Point, b: Point): Point => a.map((x, i) => x-b[i]) as Point
const cross = (a: Point, b: Point): Point => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]
const length = (a: Point) => Math.hypot(...a)
const finitePoint = (p: Point) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)
const absoluteBound = (value: I) => Math.max(Math.abs(value[0]),Math.abs(value[1]))

function row(n: Net, edge: NaturalEdge, inner = false): number[] {
  if (edge[0] === 'U') {
    const i = edge === 'U0' ? (inner ? 1 : 0) : n.nu-1-(inner ? 1 : 0)
    return Array.from({length:n.nv}, (_,j) => i*n.nv+j)
  }
  const j = edge === 'V0' ? (inner ? 1 : 0) : n.nv-1-(inner ? 1 : 0)
  return Array.from({length:n.nu}, (_,i) => i*n.nv+j)
}

// Minimal interval arithmetic. Each elementary floating-point operation is
// expanded by one representable value in both directions, including products
// used to construct homogeneous coordinates. No unrounded knot insertion is
// used by the continuous proof. Overflow and exhausted subdivisions fail closed.
type I = [number, number]
type H = [I, I, I, I]
const bits = new BigUint64Array(1), floats = new Float64Array(bits.buffer)
function next(x: number, up: boolean): number {
  if (Number.isNaN(x)) fail('aritmetica non finita')
  if (x === (up ? Infinity : -Infinity)) return x
  if (x === 0) return up ? Number.MIN_VALUE : -Number.MIN_VALUE
  floats[0] = x
  bits[0] = bits[0] + ((x > 0) === up ? 1n : -1n)
  return floats[0]
}
const scalar = (x: number): I => [x,x]
function enclosed(lo: number, hi: number): I {
  const result: I=[next(lo,false),next(hi,true)]
  if (!result.every(Number.isFinite)) fail('overflow nella prova continua')
  return result
}
const plus = (a: I, b: I): I => enclosed(a[0]+b[0],a[1]+b[1])
const minus = (a: I, b: I): I => enclosed(a[0]-b[1],a[1]-b[0])
function times(a: I, b: I): I {
  const p = [a[0]*b[0],a[0]*b[1],a[1]*b[0],a[1]*b[1]]
  if (!p.every(Number.isFinite)) fail('overflow nella prova continua')
  return enclosed(Math.min(...p),Math.max(...p))
}
function positiveDivide(a: I, b: I): I {
  if (!(b[0]>0)) fail('denominatore dei nodi non comprovabilmente positivo')
  return times(a,enclosed(1/b[1],1/b[0]))
}
const half = (a: H, b: H): H => a.map((x,i) => times(plus(x,b[i]),scalar(.5))) as H
function split(c: H[]): [H[], H[]] {
  const left = [c[0]], right = [c.at(-1)!]
  let level = c
  while (level.length > 1) {
    level = level.slice(1).map((p,i) => half(level[i],p))
    left.push(level[0]); right.unshift(level.at(-1)!)
  }
  return [left,right]
}
const hull = (c: H[]): H => [0,1,2,3].map(d => [Math.min(...c.map(h=>h[d][0])),Math.max(...c.map(h=>h[d][1]))]) as H
const derivative = (c: H[]): H[] => c.slice(1).map((h,i) => h.map((x,d)=>times(minus(x,c[i][d]),scalar(c.length-1))) as H)
function numerator(a: H, d: H): [I,I,I] {
  return [0,1,2].map(i=>minus(times(d[i],a[3]),times(a[i],d[3]))) as [I,I,I]
}
function intervalCross(a: [I,I,I], b: [I,I,I]): [I,I,I] {
  return [0,1,2].map(i=>minus(times(a[(i+1)%3],b[(i+2)%3]),times(a[(i+2)%3],b[(i+1)%3]))) as [I,I,I]
}

/** Exact B-spline -> Bernstein extraction enclosed at every arithmetic step.
 * The input knots are exact binary floating-point values. Inserting each inner
 * knot to multiplicity p yields overlapping p+1 control windows, one per closed
 * span. Never reuse the ordinary floating-point refinement as a proof oracle.
 */
function bernsteinSpans(rows: H[][], degree: number, knots: number[], mult: number[]): H[][][] {
  const full=knots.flatMap((x,i)=>Array<number>(mult[i]).fill(x))
  let controls=rows
  for (let node=1;node<knots.length-1;node++) {
    const t=knots[node]
    for (let s=mult[node];s<degree;s++) {
      const k=full.findIndex((x,i)=>x<=t&&t<full[i+1])
      if (k<degree) fail('estrazione degli span non valida')
      controls=controls.map(c=>Array.from({length:c.length+1},(_,i)=> {
        if (i<=k-degree) return c[i]
        if (i>k-s) return c[i-1]
        const alpha=positiveDivide(minus(scalar(t),scalar(full[i])),minus(scalar(full[i+degree]),scalar(full[i])))
        return c[i].map((x,d)=>plus(times(alpha,x),times(minus(scalar(1),alpha),c[i-1][d]))) as H
      }))
      full.splice(k+1,0,t)
    }
  }
  return knots.slice(1).map((_,span)=>controls.map(c=>c.slice(span*degree,span*degree+degree+1)))
}

/** Prove nonzero cross derivatives on the entire selected closed edge. */
function proveEdge(n: Net, edge: NaturalEdge, normal: Point, origin: Point): number {
  const boundary = row(n,edge), inside = row(n,edge,true)
  const homogeneous = (ids: number[]): H[] => ids.map(id => {
    // Translate first, also with outward rounding: reduces cancellation while
    // enclosing the exact input floating-point geometry, rather than its rounded translation.
    const w = scalar(n.weights[id])
    return [...n.poles[id].map((x,d)=>times(minus(scalar(x),scalar(origin[d])),w)),w] as H
  })
  let visits = 0, leaves = 0, orientation = 0
  const walk = (a: H[], b: H[], d: H[], depth: number): void => {
    if (++visits > 4095) fail('regolarità continua del bordo non comprovabile entro il budget')
    const c = intervalCross(numerator(hull(a),hull(d)),numerator(hull(a),hull(b)))
    const determinant = c.reduce((sum,x,i)=>plus(sum,times(x,scalar(normal[i]))),scalar(0))
    const sign = determinant[0] > 0 ? 1 : determinant[1] < 0 ? -1 : 0
    if (sign) {
      if (orientation && orientation !== sign) fail('inversione della normale lungo il bordo')
      orientation = sign; leaves++; return
    }
    if (depth === 14) fail('bordo degenere o regolarità continua non comprovabile')
    const [al,ar] = split(a), [bl,br] = split(b), [dl,dr] = split(d)
    walk(al,bl,dl,depth+1); walk(ar,br,dr,depth+1)
  }
  const alongU=edge[0]==='V', degree=alongU?n.du:n.dv
  const spans=bernsteinSpans([homogeneous(boundary),homogeneous(inside)],degree,alongU?n.ku:n.kv,alongU?n.mu:n.mv)
  // Each walk includes both endpoints. With the validated C1 knot
  // multiplicities the one-sided derivatives agree at every shared knot;
  // a single orientation across all spans also rules out a hidden fold.
  for (const [a,b] of spans) walk(a,b,derivative(a),0)
  return leaves
}

function sampleDerivatives(n: Net, u: number, v: number): [Point,Point] {
  const ku = n.ku.flatMap((x,i)=>Array<number>(n.mu[i]).fill(x)), kv = n.kv.flatMap((x,i)=>Array<number>(n.mv[i]).fill(x))
  const su = findSpan(n.du,u,ku), sv = findSpan(n.dv,v,kv)
  const bu = calcBasisFunctionDerivatives(su,u,n.du,1,ku), bv = calcBasisFunctionDerivatives(sv,v,n.dv,1,kv)
  const h: Point[] = [[0,0,0],[0,0,0],[0,0,0]], w = [0,0,0]
  for (let i=0;i<=n.du;i++) for (let j=0;j<=n.dv;j++) {
    const id=(su-n.du+i)*n.nv+sv-n.dv+j
    const c=[bu[0][i]*bv[0][j],bu[1][i]*bv[0][j],bu[0][i]*bv[1][j]]
    for (let d=0;d<3;d++) { const t=c[d]*n.weights[id]; w[d]+=t; for (let a=0;a<3;a++) h[d][a]+=t*n.poles[id][a] }
  }
  const p=h[0].map(x=>x/w[0])
  const result = [1,2].map(d=>h[d].map((x,a)=>(x-p[a]*w[d])/w[0]) as Point) as [Point,Point]
  if (!(w[0]>0) || !result.every(finitePoint)) fail('derivate campionate non finite')
  return result
}

function validatedRequest(request: PlaneTangencyRequest) {
  const {net,edge,plane,lockIndices,distanceTolerance} = request
  const n=refineClampedNet(net,[]) // Existing strict clamped/positive-weight validator, independent clone.
  if (!edges.includes(edge) || !finitePoint(plane.point) || !finitePoint(plane.normal) ||
      Math.abs(length(plane.normal)-1)>1e-12 || !Number.isFinite(distanceTolerance) ||
      distanceTolerance<=0 || distanceTolerance>1e-6) fail('piano normalizzato o tolleranza non validi')
  if (!Array.isArray(lockIndices) || lockIndices.some(i=>!Number.isInteger(i)||i<0||i>=n.poles.length)) fail('indice bloccato non valido')
  const protectedEdges=request.preserveTangentEdges??[]
  if (!Array.isArray(protectedEdges) || protectedEdges.some(e=>!edges.includes(e)||e===edge)) fail('vincolo di altro bordo non valido')
  for (const [degree,mult] of [[n.du,n.mu],[n.dv,n.mv]] as const)
    if (mult.slice(1,-1).some(m=>m>=degree)) fail('nodi interni privi di continuità C1')
  const fixed=new Set([...lockIndices,...edges.flatMap(e=>row(n,e)),...protectedEdges.flatMap(e=>row(n,e,true))])
  const residualBound=(p: Point)=> {
    const d=p.reduce((sum,x,a)=>plus(sum,times(minus(scalar(x),scalar(plane.point[a])),scalar(plane.normal[a]))),scalar(0))
    return absoluteBound(d)
  }
  return {n,fixed,residualBound,boundary:row(n,edge),inner:row(n,edge,true)}
}

/**
 * Pure proposal only: projects the first interior pole row onto an explicit
 * plane. The full perimeter, weights, knots, degrees and locks remain unchanged.
 * Positive weights + both pole rows on the plane imply tangent-plane containment
 * in exact arithmetic; the result records the actual coefficient residual.
 *
 * Continuous regularity is independently proven by interval Bernstein extraction
 * and subdivision on every closed knot span, including shared endpoints. Other
 * natural edges may protect their existing tangent rows; this is preservation,
 * not a claim that those edges were tangent before. No topology/trim information
 * exists here: the caller must establish that this is a natural, untrimmed edge.
 */
export function proposePlaneTangency(request: PlaneTangencyRequest): PlaneTangencyResult {
  const {net,plane,distanceTolerance}=request
  const {n,fixed,residualBound,boundary,inner}=validatedRequest(request)
  const distance=(p: Point)=>dot(sub(p,plane.point),plane.normal), n2=dot(plane.normal,plane.normal)
  if (boundary.some(id=>residualBound(n.poles[id])>distanceTolerance)) fail('bordo fuori dal piano; il perimetro è immutabile')
  const changedIndices: number[]=[]
  for (const id of inner) {
    const d=distance(n.poles[id])
    if (!Number.isFinite(d)) fail('distanza non finita')
    if (fixed.has(id)) {
      if (residualBound(n.poles[id])>distanceTolerance) fail(`vincolo incompatibile sul punto ${id}`)
      continue
    }
    if (d!==0) {
      n.poles[id]=n.poles[id].map((x,a)=>x-d*plane.normal[a]/n2) as Point
      if (!finitePoint(n.poles[id])) fail('overflow nella proiezione')
      if (n.poles[id].some((x,a)=>x!==net.poles[id][a])) changedIndices.push(id)
    }
  }
  return {net:n,changedIndices,...assessFinal(request,n,residualBound)}
}

function assessFinal(request: PlaneTangencyRequest, n: Net, residualBound: (p: Point)=>number): Omit<PlaneTangencyResult,'net'|'changedIndices'> {
  const {edge,plane,distanceTolerance}=request
  const maxPlaneCoefficientResidual=Math.max(...[...row(n,edge),...row(n,edge,true)].map(id=>residualBound(n.poles[id])))
  if (!(maxPlaneCoefficientResidual<=distanceTolerance)) fail('residuo del piano oltre tolleranza')
  const proofLeaves=proveEdge(n,edge,plane.normal,plane.point)
  let count=0, minSinAngle=Infinity, sampledMaxBoundaryNormalSin=0
  // Knot spans and their endpoints are sampled separately. These checks reject
  // observed interior singularities; they do NOT prove global regularity.
  const samples=(knots: number[])=>knots.slice(1).flatMap((end,i)=>Array.from({length:9},(_,j)=>knots[i]+(end-knots[i])*j/8))
  const us=samples(n.ku), vs=samples(n.kv)
  if (us.length*vs.length>100000) fail('budget dei campioni superato')
  for (const u of us) for (const v of vs) {
    const [du,dv]=sampleDerivatives(n,u,v), c=cross(du,dv), scale=length(du)*length(dv), sin=length(c)/scale
    if (!(scale>0) || !Number.isFinite(sin) || sin<1e-8) fail('superficie degenere nei campioni')
    minSinAngle=Math.min(minSinAngle,sin); count++
    if ((edge==='U0'&&u===n.ku[0])||(edge==='U1'&&u===n.ku.at(-1))||
        (edge==='V0'&&v===n.kv[0])||(edge==='V1'&&v===n.kv.at(-1))) {
      const error=length(cross(c,plane.normal))/(length(c)*length(plane.normal))
      if (!Number.isFinite(error)||error>1e-7) fail('normale del bordo non parallela al piano nei campioni')
      sampledMaxBoundaryNormalSin=Math.max(sampledMaxBoundaryNormalSin,error)
    }
  }
  return {edgeRegularity:'outward-rounded-interval-proof',proofLeaves,
    maxPlaneCoefficientResidual,sampledRegularity:{count,minSinAngle},sampledMaxBoundaryNormalSin,globalG1Certified:false}
}

/**
 * Validate the actual final in-memory kernel net against the pre-edit request.
 * This function never projects, repairs, mutates, or compares with a regenerated
 * proposal. Only the selected first interior row may move. All other poles,
 * the full perimeter, explicit locks and other protected tangent rows must stay
 * bit-for-bit identical, including signed zero. The plane residual alone uses
 * distanceTolerance. Knot/weight/degree/index structure must retain its numeric
 * values: reparametrization or weight normalization is unsupported.
 *
 * Kernel callers must separately verify topology, untrimmed natural-edge
 * eligibility, face identity, reimport geometry and transaction atomicity.
 * Kernel callers must pass the in-memory final net before BREP serialization;
 * serialization roundoff must not weaken these strict invariants. This is coefficient
 * and selected-edge validation, not a global G1 or topology certificate.
 */
export function validatePlaneTangencyResult(request: PlaneTangencyRequest, finalNet: Net): PlaneTangencyValidation {
  const {n:base,fixed,inner,residualBound}=validatedRequest(request)
  const final=refineClampedNet(finalNet,[])
  const sameValues=(a:readonly number[],b:readonly number[])=>a.length===b.length&&a.every((x,i)=>Object.is(x,b[i]))
  if (base.nu!==final.nu||base.nv!==final.nv||base.du!==final.du||base.dv!==final.dv||
      !sameValues(base.ku,final.ku)||!sameValues(base.kv,final.kv)||!sameValues(base.mu,final.mu)||!sameValues(base.mv,final.mv)||
      !sameValues(base.weights,final.weights)||!sameValues(base.rational,final.rational)||
      !sameValues(base.periodic??[0,0],final.periodic??[0,0])) fail('struttura, nodi o pesi modificati dal kernel')
  const editable=new Set(inner)
  let protectedPoleCount=0
  for (let id=0;id<base.poles.length;id++) if (!editable.has(id)||fixed.has(id)) {
    if (!sameValues(base.poles[id],final.poles[id])) fail(`punto protetto modificato dal kernel: ${id}`)
    protectedPoleCount++
  }
  return {...assessFinal(request,final,residualBound),protectedPoleCount}
}
