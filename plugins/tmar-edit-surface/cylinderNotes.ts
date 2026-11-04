// SPDX-License-Identifier: AGPL-3.0-only
import type { OcctKernel } from 'occt-wasm'
import type { Point } from './brep'
import { orientedSurfaceNormal, type DraftAnchor } from './editorKernel'

/** The face BREP must come from the exact validated worker revision; callers
 * must fence source, session and candidate before using a resolved anchor. */
export function resolveCylinderAnchor(k:OcctKernel,faceBrep:string,faceIndex:number,session:number,anchor:DraftAnchor) {
  if(anchor.face!==faceIndex || anchor.selectionRevision!==session || !Number.isFinite(anchor.u) || !Number.isFinite(anchor.v))
    throw new Error('Riferimento della nota estraneo alla faccia cilindrica.')
  const face=k.fromBREP(faceBrep)
  try {
    if(k.getShapeType(face)!=='face') throw new Error('Faccia cilindrica non valida.')
    const location=k.classifyPointOnFace(face,anchor.u,anchor.v)
    if(location!=='in' && location!=='on') throw new Error('Il punto cade fuori dalla faccia cilindrica.')
    const p=k.pointOnSurface(face,anchor.u,anchor.v),at:Point=[p.x,p.y,p.z]
    if(!at.every(Number.isFinite)) throw new Error('Posizione della nota non determinata.')
    return {at,normal:orientedSurfaceNormal(k,face,anchor.u,anchor.v)}
  } finally {k.release(face)}
}

export function cylinderAnchorFromPick(k:OcctKernel,faceBrep:string,faceIndex:number,session:number,point:Point) {
  if(point.length!==3 || !point.every(Number.isFinite)) throw new Error('Punto della nota non valido.')
  const face=k.fromBREP(faceBrep)
  try {
    const uv=k.uvFromPoint(face,{x:point[0],y:point[1],z:point[2]})
    const anchor={face:faceIndex,selectionRevision:session,u:uv.u,v:uv.v}
    const resolved=resolveCylinderAnchor(k,faceBrep,faceIndex,session,anchor)
    if(Math.hypot(...point.map((v,i)=>v-resolved.at[i]))>.16) throw new Error('Il punto selezionato è distante dalla faccia CAD.')
    return {anchor,...resolved}
  } finally {k.release(face)}
}
