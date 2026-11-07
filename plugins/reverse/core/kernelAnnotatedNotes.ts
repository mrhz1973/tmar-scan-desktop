// SPDX-License-Identifier: AGPL-3.0-only
// Conservative destination-face correspondence in the staged kernel. No mesh snap,
// face-index identity or nearest-centroid fallback. Ambiguity refuses the bundle.
import type { Vec3 } from '../../../src/core/types'
import type { DraftCopyFaceNoteV1 } from '../../../src/plugins/annotatedCopyTypes'
import type { OcctLike, XYZ } from './occtTypes'
import { HASH_BOUND } from './kernelOps'
export interface ResolvedCopyNote { draftId:string; uv:[number,number]; at:Vec3; normal:Vec3 }
export interface VerifiedCopyFace { hash:number; notes:ResolvedCopyNote[]; samples:number; toleranceMm:number }
const MM=1e-5, DOT=1-1e-6
const v=(p:XYZ):Vec3=>[p.x,p.y,p.z]
const xyz=(p:readonly number[]):XYZ=>({x:p[0],y:p[1],z:p[2]})
const dist=(a:readonly number[],b:readonly number[])=>Math.hypot(...a.map((x,i)=>x-b[i]))
const dot=(a:readonly number[],b:readonly number[])=>a.reduce((s,x,i)=>s+x*b[i],0)
function normal(k:OcctLike,face:number,u:number,w:number):Vec3 {
  const orientation=k.shapeOrientation(face)
  if(!['forward','reversed'].includes(orientation)) throw Error('Normale CAD non orientabile.')
  const p=v(k.surfaceNormal(face,u,w)),length=Math.hypot(...p)
  if(!p.every(Number.isFinite) || !Number.isFinite(length) || length<=1e-12) throw Error('Normale CAD non finita o degenere.')
  // occt-wasm 5.7.1 already applies the topological face orientation.
  return p.map(x=>x/length) as Vec3
}
// A coarse UV grid can miss the interior of a narrow trimmed face entirely.
// Refine deterministically, reusing the previous grid vertices, with a hard
// upper bound on kernel classifications. Boundary samples never count as
// interior evidence: an ambiguous or unsampled face must still fail closed.
const UV_STEPS=[8,16,32,64] as const
const MIN_INTERIOR_SAMPLES=12
function sampleFace(k:OcctLike,face:number):Vec3[] {
  const b=k.uvBounds(face),out:Vec3[]=[]
  if(!Object.values(b).every(Number.isFinite) || !(b.uMax>b.uMin && b.vMax>b.vMin))
    throw Error('Dominio CAD non limitato o degenere.')
  let interior=0
  for(let level=0;level<UV_STEPS.length;level++){
    const divisions=UV_STEPS[level]
    for(let i=0;i<=divisions;i++)for(let j=0;j<=divisions;j++){
      // All even/even indices were visited at the previous resolution.
      if(level>0 && i%2===0 && j%2===0)continue
      const u=b.uMin+(b.uMax-b.uMin)*i/divisions
      const vv=b.vMin+(b.vMax-b.vMin)*j/divisions
      if(k.classifyPointOnFace(face,u,vv)!=='in')continue
      const p=v(k.pointOnSurface(face,u,vv))
      if(!p.every(Number.isFinite))throw Error('Campione CAD interno non finito.')
      out.push(p);interior++
    }
    // Require more than the historical 3 sparse interior points: thin
    // annuli must be checked across a sufficiently sampled trimmed domain.
    if(interior>=MIN_INTERIOR_SAMPLES)break
  }
  if(interior<MIN_INTERIOR_SAMPLES)throw Error('Faccia troppo sottile o dominio non verificabile.')
  const edges=k.getSubShapes(face,'edge')
  try {for(const e of edges){
    const range=k.curveParameters(e)
    if(!Number.isFinite(range.first)||!Number.isFinite(range.last))throw Error('Bordo CAD non limitato.')
    for(let i=0;i<=8;i++){
      const p=v(k.curvePointAtParam(e,range.first+(range.last-range.first)*i/8))
      if(!p.every(Number.isFinite))throw Error('Campione bordo CAD non finito.')
      out.push(p)
    }
  }}
  finally{edges.forEach(e=>k.release(e))}
  return out
}
function agrees(k:OcctLike,a:number,b:number,points:Vec3[]):boolean {
  for(const p of points){
    const ua=k.uvFromPoint(a,xyz(p)),ub=k.uvFromPoint(b,xyz(p))
    if(!Number.isFinite(ub.u+ub.v)||!['in','on'].includes(k.classifyPointOnFace(b,ub.u,ub.v)))return false
    if(dist(v(k.pointOnSurface(b,ub.u,ub.v)),p)>MM || dot(normal(k,a,ua.u,ua.v),normal(k,b,ub.u,ub.v))<DOT)return false
  }
  return true
}
export function verifyCopyFace(k:OcctLike,body:number,brep:string,notes:readonly DraftCopyFaceNoteV1[]):VerifiedCopyFace {
  if(!brep || brep.length>16_000_000 || !notes.length || notes.length>200)throw Error('Testimone o numero note non valido.')
  const witness=k.fromBREP(brep); let handles:number[]=[]
  try {
    handles=k.getSubShapes(body,'face')
    if(k.getShapeType(witness)!=='face'||!k.isValid(witness))throw Error('Il testimone non è una singola faccia CAD valida.')
    const area=k.getSurfaceArea(witness),centre=v(k.getSurfaceCenterOfMass(witness)),samples=sampleFace(k,witness)
    const edges=k.subShapeCount(witness,'edge'),matches:number[]=[]
    for(const face of handles){
      if(k.surfaceType(face)!==k.surfaceType(witness)||k.subShapeCount(face,'edge')!==edges)continue
      if(Math.abs(k.getSurfaceArea(face)-area)>Math.max(1e-7,area*1e-7)||dist(v(k.getSurfaceCenterOfMass(face)),centre)>MM)continue
      try {if(agrees(k,witness,face,samples)&&agrees(k,face,witness,sampleFace(k,face)))matches.push(face)}catch{/* Degenerate candidates cannot prove a match. */}
    }
    if(matches.length!==1)throw Error(`Identità della faccia non univoca: ${matches.length} corrispondenze verificate.`)
    const face=matches[0]
    const resolved=notes.map(note=>{
      const target=note.target,[u,w]=target.sourceUV
      if(!['in','on'].includes(k.classifyPointOnFace(witness,u,w)))throw Error('Nota esterna al contorno o nel foro del testimone.')
      if(dist(v(k.pointOnSurface(witness,u,w)),target.resolvedAt)>MM||dot(normal(k,witness,u,w),target.orientedNormal)<DOT)
        throw Error('Posizione o normale della nota non corrisponde alla geometria finale.')
      const uv=k.uvFromPoint(face,xyz(target.resolvedAt))
      if(!['in','on'].includes(k.classifyPointOnFace(face,uv.u,uv.v)))throw Error('Nota fuori dalla faccia di destinazione o in un foro.')
      const at=v(k.pointOnSurface(face,uv.u,uv.v)),n=normal(k,face,uv.u,uv.v)
      if(dist(at,target.resolvedAt)>MM||dot(n,target.orientedNormal)<DOT)throw Error('Ancora di destinazione non verificata.')
      return {draftId:note.draftId,uv:[uv.u,uv.v] as [number,number],at,normal:n}
    })
    return {hash:k.hashCode(face,HASH_BOUND),notes:resolved,samples:samples.length,toleranceMm:MM}
  } finally{handles.forEach(h=>k.release(h));k.release(witness)}
}
