// SPDX-License-Identifier: AGPL-3.0-only
// Pure OCCT BREP V3 rewrite: own support and own U-seam 3D curve only.
// Frozen source/candidate SHA-256 pins are verified by the separate runner.
import { encodeNet, surfaceTable, type Net, type Point } from './brep'

export type NativeV3Curve = { degree: number; poles: Point[]; knots: number[]; multiplicities: number[]; periodic: boolean; rational: boolean }
export type NativeV3Request = { face: 321 | 323; sourceBrep: string; candidateNet: Net; candidateSeam: NativeV3Curve }
export type NativeV3Result = { status: 'rewritten'; brep: string; face: 321 | 323; sourceSurfaceIndex: 1; sourceCurveIndex: 2; topologyAndPcurvesByteIdentical: true; protectedVRowsIdentical: true } | { status: 'inconclusive'; reason: string }
type Span = { start: number; end: number }
type Curve3D = Span & { degree: number; rational: number; periodic: number; poles: Point[]; knots: number[]; mult: number[] }
const same = (a: readonly number[], b: readonly number[]) => a.length===b.length && a.every((n,i)=>Object.is(n,b[i]))
const stop = (message: string): never => { throw Error(message) }
const numeric = (s: string) => /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(s) && Number.isFinite(Number(s))
function section(s: string, a: string, b: string) {
  const first = new RegExp('^'+a+' (\\d+)[ \\t]*\\r?\\n','m').exec(s)
  const last = new RegExp('^'+b+' (\\d+)[ \\t]*\\r?\\n','m').exec(s)
  if (!first || !last) throw new Error('missing-section-'+a)
  if (last.index<=first.index+first[0].length) throw new Error('overlapping-section-'+a)
  return {count:Number(first[1]),start:first.index+first[0].length,end:last.index}
}
function tokens(s: string, start: number, end: number) {
  return [...s.slice(start,end).matchAll(/\S+/g)].map(m=>{
    if(!numeric(m[0])) stop('nonfinite-or-unsupported-brep-token')
    return {v:Number(m[0]),start:start+m.index!,end:start+m.index!+m[0].length}
  })
}
function curveTable(s: string): Curve3D[] {
  const range=section(s,'Curves','Polygon3D')
  if(range.count!==3) stop('unexpected-curve3d-count')
  const data=tokens(s,range.start,range.end)
  let n=0
  const next=()=>{const v=data[n++]?.v; if(!Number.isFinite(v)) stop('incomplete-curve3d');return v!}
  const int=(min:number,max:number)=>{const v=next();if(!Number.isInteger(v)||v<min||v>max)stop('invalid-curve3d-header');return v}
  const result:Curve3D[]=[]
  for(let i=0;i<3;i++){
    const start=data[n]?.start,kind=int(1,9),rational=int(0,1),periodic=int(0,1)
    const degree=int(1,25),count=int(2,1000),nk=int(2,1000)
    if(kind!==7||start===undefined)stop('curve3d-not-supported')
    const poles:Point[]=[]
    for(let j=0;j<count;j++){poles.push([next(),next(),next()]);if(rational) next()}
    const knots:number[]=[],mult:number[]=[]
    for(let j=0;j<nk;j++){knots.push(next());mult.push(int(1,degree+1))}
    result.push({start,end:data[n-1].end,degree,rational,periodic,poles,knots,mult})
  }
  if(n!==data.length)stop('trailing-curve3d-tokens')
  return result
}
function ownPcurves(s:string, uEnd:number) {
  const r=section(s,'Curve2ds','Curves')
  if(r.count!==6) stop('unexpected-curve2d-count')
  const data=tokens(s,r.start,r.end)
  let n=0;const curves:number[][]=[]
  for(let i=0;i<6;i++){
    const kind=data[n]?.v,size=kind===1?5:kind===7?14:0
    if(!size||n+size>data.length)stop('curve2d-not-supported')
    const values=data.slice(n,n+size).map(x=>x.v)
    if(size===14 && !same(values.slice(0,6),[7,0,0,1,2,2]))stop('curve2d-bspline-not-supported')
    curves.push(values);n+=size
  }
  if(n!==data.length||!same(curves[2],[1,uEnd,0,0,1])||!same(curves[3],[1,0,0,0,1]))
    stop('own-u-seam-uv-pcurve-mismatch')
}
function topology(s:string,uEnd:number) {
  const h=/^TShapes (\d+)[ \t]*\r?\n/m.exec(s)
  if(!h) throw new Error('topology-header-missing')
  if(Number(h[1])!==7)stop('topology-size-not-expected')
  const part=s.slice(h.index+h[0].length)
  const entities=[...part.matchAll(/^(Ve|Ed|Wi|Fa)[ \t]*\r?$/gm)].map(m=>m[1])
  if(entities.join(',')!=='Ve,Ed,Ve,Ed,Ed,Wi,Fa')stop('unexpected-topology-entities')
  const faces=[...s.matchAll(/^Fa[ \t]*\r?\n\s*[01]\s+\S+\s+(\d+)\s+0[ \t]*\r?$/gm)]
  if(faces.length!==1||Number(faces[0][1])!==1)stop('ambiguous-own-face-support')
  const edges=[...s.matchAll(/^Ed[ \t]*\r?\n([^\r\n]+)\r?\n([\s\S]*?)^0[ \t]*\r?$/gm)]
  if(edges.length!==3)stop('unexpected-edge-count')
  const representations=edges[1][2].trim().split(/\r?\n/).map(s=>s.trim())
  if(representations.length!==2 || !/^1\s+2\s+0\s+0\s+1$/.test(representations[0]) ||
    !/^3\s+3\s+4C2\s+1\s+0\s+0\s+1$/.test(representations[1]))
    stop('own-u-seam-dual-uv-graph-mismatch')
  if(!edges[0][2].includes('1  1 0')||!edges[2][2].includes('1  3 0'))stop('outer-edge-provenance-missing')
  ownPcurves(s,uEnd)
}
function candidateGuard(source:Net, candidate:Net, seam:NativeV3Curve) {
  if(source.nu!==238||source.nv!==12||source.du!==3||source.dv!==5||
    !same(source.periodic??[],[1,0])||!same(source.rational,[0,0])||
    source.poles.length!==2856||source.weights.some(w=>!Object.is(w,1)))
      stop('unsupported-source-surface')
  if(!candidate||!seam||candidate.nu!==source.nu||candidate.nv!==source.nv||
    candidate.du!==source.du||candidate.dv!==source.dv||
    !same(candidate.periodic??[],[1,0])||!same(candidate.rational,[0,0])||
    !same(candidate.ku,source.ku)||!same(candidate.kv,source.kv)||
    !same(candidate.mu,source.mu)||!same(candidate.mv,source.mv)||
    !same(candidate.weights,source.weights)||candidate.poles.length!==source.poles.length||
    candidate.poles.some(p=>p.length!==3||p.some(x=>!Number.isFinite(x))))
      stop('candidate-support-metadata-or-poles-invalid')
  for(let u=0;u<source.nu;u++)for(const v of [0,source.nv-1])
    if(!same(source.poles[u*source.nv+v],candidate.poles[u*candidate.nv+v]))
      stop('protected-v-boundary-changed')
  if(seam.degree!==5||seam.rational!==false||seam.periodic!==false||
    seam.poles.length!==12||!same(seam.knots,candidate.kv)||
    !same(seam.multiplicities,candidate.mv)||
    seam.poles.some((p,v)=>!same(p,candidate.poles[v])))
      stop('seam-is-not-exact-candidate-u0')
}
const curveEncoding=(c:NativeV3Curve)=>['7 0 0 '+c.degree+' '+c.poles.length+' '+c.knots.length,
  ...c.poles.map(p=>p.join(' ')),
  ...c.knots.map((k,i)=>k+' '+c.multiplicities[i])].join('\n')
/** Caller must verify SHA-256 pins of source BREP and candidate files.
 * Refuses ambiguous topologies; does not launch kernel, sew or heal. */
export function rewriteDetachedTubeFaceV3(req:NativeV3Request):NativeV3Result {
  try {
    if(!req || (req.face!==321&&req.face!==323)||typeof req.sourceBrep!=='string'||
      req.sourceBrep.length>8_000_000||!/^\r?\n?CASCADE Topology V3, \(c\) Open Cascade\r?\n/.test(req.sourceBrep))
      stop('invalid-request')
    const source=req.sourceBrep, surfaces=surfaceTable(source)
    if(surfaces.length!==3||surfaces[0].kind!==9||!surfaces[0].periodicNet)
      stop('own-support-missing-or-unsupported')
    const own=surfaces[0],base=own.periodicNet!
    candidateGuard(base,req.candidateNet,req.candidateSeam)
    const end=req.face===321?237.3422596445:252.00932454753
    if(!Object.is(base.ku.at(-1),end))stop('wrong-face-u-endpoint')
    topology(source,end)
    const curves=curveTable(source),ownSeam=curves[1]
    if(ownSeam.degree!==5||ownSeam.periodic||ownSeam.rational||
      ownSeam.poles.length!==12||!same(ownSeam.knots,base.kv)||
      !same(ownSeam.mult,base.mv)||ownSeam.poles.some((p,v)=>!same(p,base.poles[v])))
      stop('source-u-seam-not-own-source-u0')
    if(!(ownSeam.end<own.start))stop('unexpected-record-order')
    const replacement3d=curveEncoding(req.candidateSeam),replacementNet=encodeNet(req.candidateNet)
    const output=source.slice(0,ownSeam.start)+replacement3d+
      source.slice(ownSeam.end,own.start)+replacementNet+source.slice(own.end)
    const decoded=surfaceTable(output)[0].periodicNet
    if(!decoded||!same(decoded.poles.flat(),req.candidateNet.poles.flat()))
      stop('binary64-coefficients-changed-by-encoding')
    const untouchedIn=source.slice(0,ownSeam.start)+source.slice(ownSeam.end,own.start)+source.slice(own.end)
    const untouchedOut=output.slice(0,ownSeam.start)+
      output.slice(ownSeam.start+replacement3d.length,ownSeam.start+replacement3d.length+own.start-ownSeam.end)+
      output.slice(ownSeam.start+replacement3d.length+own.start-ownSeam.end+replacementNet.length)
    if(untouchedIn!==untouchedOut)stop('non-target-brep-bytes-changed')
    topology(output,end)
    return {status:'rewritten',brep:output,face:req.face,sourceSurfaceIndex:1,sourceCurveIndex:2,
      topologyAndPcurvesByteIdentical:true,protectedVRowsIdentical:true}
  } catch(e) {return {status:'inconclusive',reason:e instanceof Error?e.message:String(e)}}
}
