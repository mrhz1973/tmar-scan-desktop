// SPDX-License-Identifier: AGPL-3.0-only
// Experimental: native clipping proof. Not wired into the editor yet.
import type { OcctKernel, ShapeHandle, Vec3 } from 'occt-wasm'
import type { Point } from './brep'
import { clippedRayInterval, type WorldClipPlane, type ClippedRayMargins } from './clippedRayInterval'

const tolerance=1e-6
const vec=(p:Point):Vec3=>({x:p[0],y:p[1],z:p[2]})
const tuple=(p:Vec3):Point=>[p.x,p.y,p.z]
const dot=(a:Point,b:Point)=>a.reduce((sum,x,i)=>sum+x*b[i],0)
const subtract=(a:Point,b:Point):Point=>a.map((x,i)=>x-b[i]) as Point
const distance=(a:Point,b:Point)=>Math.hypot(...subtract(a,b))
// The CAD tolerances below are in part millimetres. Qualify only rigid
// transforms so those tolerances and ray angles remain valid in world space.
const isRigid=(m:readonly number[])=>{
  if(!Array.isArray(m)||m.length!==16||!m.every(Number.isFinite))return false
  const axes:Point[]=[[m[0],m[1],m[2]],[m[4],m[5],m[6]],[m[8],m[9],m[10]]]
  return axes.every(a=>Math.abs(dot(a,a)-1)<=1e-8) &&
    Math.abs(dot(axes[0],axes[1]))<=1e-8 && Math.abs(dot(axes[0],axes[2]))<=1e-8 &&
    Math.abs(dot(axes[1],axes[2]))<=1e-8
}

/** Experimental proof for an already certified CAD boundary point. The clipping
 * planes and transform are in world coordinates. Ambiguous intersections and
 * intersections close to a clipping boundary fail closed. The front-clearance
 * check includes the full uncertainty band; it can conservatively refuse an
 * actually visible point, but must not skip a visible occluder.
 */
export function proveClippedBoundaryVisibility(k:OcctKernel,shape:ShapeHandle,point:Point,normal:Point,
  cameraOrigin:Point,partToWorld:readonly number[],planes:readonly WorldClipPlane[],margins:ClippedRayMargins,
  parallelDirection?:Point):{visible:boolean;reason:string} {
  if(![point,normal,cameraOrigin,...(parallelDirection?[parallelDirection]:[])].every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite)))
    return {visible:false,reason:'invalid-input'}
  if(!isRigid(partToWorld))return {visible:false,reason:'invalid-transform'}
  let origin=cameraOrigin
  if(parallelDirection){
    const length=Math.hypot(...parallelDirection)
    if(!parallelDirection.every(Number.isFinite)||Math.abs(length-1)>1e-8)return {visible:false,reason:'invalid-direction'}
    const along=dot(subtract(point,cameraOrigin),parallelDirection)
    if(along<=1e-4)return {visible:false,reason:'behind-camera'}
    origin=point.map((x,i)=>x-parallelDirection[i]*along) as Point
  }
  const delta=subtract(point,origin),depth=Math.hypot(...delta)
  if(!Number.isFinite(depth)||depth<1e-4||depth>1e6)return {visible:false,reason:'invalid-ray'}
  const direction=delta.map(x=>x/depth) as Point
  const normalLength=Math.hypot(...normal)
  if(!normal.every(Number.isFinite)||!Number.isFinite(normalLength)||normalLength<1e-12 ||
    Math.abs(dot(normal,direction))/normalLength<.1)return {visible:false,reason:'grazing'}
  const interval=clippedRayInterval({originPart:origin,targetPart:point,partToWorld,planes,margins})
  if(!interval)return {visible:false,reason:'invalid-clipping'}
  const owned:ShapeHandle[]=[],own=(h:ShapeHandle)=>{owned.push(h);return h}
  try{
    // OCCT section can populate topology caches on its input: isolate the source.
    const copy=own(k.fromBREP(k.toBREP(shape)))
    const ray=own(k.makeLineEdge(vec(interval.sectionStartPart),vec(interval.sectionEndPart)))
    const section=own(k.section(copy,ray))
    const edges=k.getSubShapes(section,'edge');owned.push(...edges)
    const vertices=k.getSubShapes(section,'vertex');owned.push(...vertices)
    if(edges.length||!vertices.length||vertices.length>128)return {visible:false,reason:'ambiguous-section'}
    const hits=vertices.map(vertex=>{
      const p=tuple(k.vertexPosition(vertex)),along=dot(subtract(p,origin),direction),t=along/depth
      const projected=origin.map((x,i)=>x+along*direction[i]) as Point
      if(!p.every(Number.isFinite)||t<interval.startParameter-tolerance/depth||
        distance(projected,p)>tolerance)throw Error('Intersezione CAD incoerente')
      return {p,t}
    }).sort((a,b)=>a.t-b.t)
    let anchors=0
    for(const hit of hits){
      if(hit.t<interval.certainlyClippedUntilParameter-tolerance/depth)continue
      if(hit.t<=interval.visibleStartParameter+tolerance/depth)return {visible:false,reason:'clip-band-ambiguous'}
      if(hit.t<1-tolerance/depth)return {visible:false,reason:'occluded'}
      if(distance(hit.p,point)>tolerance)return {visible:false,reason:'ambiguous-anchor'}
      anchors++
    }
    if(anchors!==1)return {visible:false,reason:'ambiguous-anchor'}
    const front=own(k.makeLineEdge(vec(interval.sectionStartPart),vec(interval.frontClearEndPart)))
    const clearance=k.distanceBetween(front,copy)
    if(!Number.isFinite(clearance)||clearance<=tolerance)return {visible:false,reason:'front-not-clear'}
    return {visible:true,reason:'clipped-native-section-and-clear-front'}
  }finally{
    let releaseError:unknown
    for(const handle of owned.reverse()){
      try{k.release(handle)}catch(error){releaseError ??= error}
    }
    if(releaseError)throw releaseError
  }
}
