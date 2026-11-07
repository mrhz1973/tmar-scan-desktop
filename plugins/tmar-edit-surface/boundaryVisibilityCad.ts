// SPDX-License-Identifier: AGPL-3.0-only
// Conservative native visibility proof, executed by the serialized editor worker.
import type { OcctKernel,ShapeHandle,Vec3 } from 'occt-wasm'
import {surfaceTable,type Point} from './brep'
import {wholeBoundaryIndices,wholeBoundaryPath,WHOLE_BOUNDARY_SEGMENTS,type WholeBoundarySide} from './wholeBoundary'
import {refineClampedNet} from './refineClampedNet'

const tolerance=1e-6,endpointMargin=1e-5
const tuple=(p:Vec3):Point=>[p.x,p.y,p.z]
const vec=(p:Point):Vec3=>({x:p[0],y:p[1],z:p[2]})
const distance=(a:Point,b:Point)=>Math.hypot(...a.map((x,d)=>x-b[d]))
const dot=(a:Point,b:Point)=>a.reduce((s,x,d)=>s+x*b[d],0)
export interface BoundaryVisibilityCadResult {
  visible:boolean
  reason:string
  point:Point
  firstDepthMm:number|null
  anchorDepthMm:number
  frontDistanceMm:number|null
  intersectionCount:number
  projectionDistanceMm:number
  pickerSegment:number
}
export interface BoundaryCadCandidate {side:WholeBoundarySide;seed:Point;segment:number}
export interface VerifiedBoundaryPick {readonly side:WholeBoundarySide;readonly point:Point}

/** Conservative B-rep segment/face query on a disposable native copy.
 * Requires the caller's current, validated single natural open face. Uncertain
 * sections and grazing rays refuse. No tessellation allowance is used.
 */
export function queryBoundaryVisibilityCad(k:OcctKernel,source:ShapeHandle,side:WholeBoundarySide,
  seed:Point,cameraOrigin:Point,segment:number,parallelDirection?:Point):BoundaryVisibilityCadResult {
  if(!['U0','U1','V0','V1'].includes(side) || !Number.isInteger(segment)||segment<0||segment>=WHOLE_BOUNDARY_SEGMENTS ||
    [seed,cameraOrigin].some(p=>p.length!==3||!p.every(Number.isFinite)))throw Error('Query CAD del bordo non valida.')
  const text=k.toBREP(source)
  const header=[...text.matchAll(/^Fa\s*\n\s*([01])\s+([\deE+.-]+)\s+(\d+)\s+(\d+)\s*$/gm)]
  const tolerances=[...text.matchAll(/^(?:Ed|Ve)\s*\n\s*([\deE+.-]+)/gm)].map(m=>Number(m[1]))
  if(header.length!==1 || header[0][4]!=='0' || !tolerances.length ||
    [...tolerances,Number(header[0][2])].some(t=>!Number.isFinite(t)||t<0||t>tolerance))throw Error('Tolleranze o trasformazioni CAD non qualificabili.')
  const owned:ShapeHandle[]=[],own=(h:ShapeHandle)=>{owned.push(h);return h}
  const children=(h:ShapeHandle,type:'wire'|'edge'|'vertex')=>{const a=k.getSubShapes(h,type);owned.push(...a);return a}
  try{
    const face=own(k.fromBREP(text)),wires=children(face,'wire')
    if(!k.isValid(face)||wires.length!==1)throw Error('Serve una sola faccia naturale senza fori.')
    const edges=children(wires[0],'edge'),b=k.uvBounds(face)
    if(edges.length!==4)throw Error('Servono quattro bordi naturali.')
    const parsed=surfaceTable(text)[Number(header[0][3])-1]?.net
    if(!parsed)throw Error('Serve il supporto NURBS nativo qualificato.')
    const net=refineClampedNet(parsed,[])
    const sameParameter=(x:number,z:number)=>Math.abs(x-z)<=Math.min(1e-10,32*Number.EPSILON*Math.max(1,Math.abs(x),Math.abs(z)))
    if(!sameParameter(b.uMin,net.ku[0])||!sameParameter(b.uMax,net.ku.at(-1)!)||!sameParameter(b.vMin,net.kv[0])||!sameParameter(b.vMax,net.kv.at(-1)!))throw Error('Dominio non naturale.')
    const path=wholeBoundaryPath(net,side),a=path[segment],z=path[segment+1]
    const chord=z.map((x,d)=>x-a[d]) as Point,lengthSquared=dot(chord,chord)
    if(lengthSquared<1e-18)throw Error('Segmento del picker degenere.')
    const along=dot(seed.map((x,d)=>x-a[d]) as Point,chord)/lengthSquared
    const chordPoint=a.map((x,d)=>x+Math.max(0,Math.min(1,along))*chord[d]) as Point
    if(distance(chordPoint,seed)>1e-7)throw Error('Seed non appartenente al segmento del picker dichiarato.')
    const at=(u:number,v:number)=>tuple(k.pointOnSurface(face,u,v))
    const endpoints:Record<WholeBoundarySide,[Point,Point]>={U0:[at(b.uMin,b.vMin),at(b.uMin,b.vMax)],U1:[at(b.uMax,b.vMin),at(b.uMax,b.vMax)],
      V0:[at(b.uMin,b.vMin),at(b.uMax,b.vMin)],V1:[at(b.uMin,b.vMax),at(b.uMax,b.vMax)]}
    const target=endpoints[side]
    if(distance(...target)<endpointMargin)throw Error('Estremi del bordo ambigui.')
    const matches=edges.filter(edge=>{
      const r=k.curveParameters(edge),a=tuple(k.curvePointAtParam(edge,r.first)),z=tuple(k.curvePointAtParam(edge,r.last))
      return (distance(a,target[0])<=tolerance&&distance(z,target[1])<=tolerance)||(distance(a,target[1])<=tolerance&&distance(z,target[0])<=tolerance)
    })
    if(matches.length!==1)throw Error('Bordo CAD non univoco.')
    // Reconstruct the exact natural isocurve from the support. Its parameter
    // is the varying UV coordinate by construction, independent of the
    // imported topological edge's own parameterization.
    const ids=wholeBoundaryIndices(net,side),varyV=side==='U0'||side==='U1',knots=varyV?net.kv:net.ku,mult=varyV?net.mv:net.mu,degree=varyV?net.dv:net.du
    const iso=own(k.makeBSplineEdge(ids.flatMap(i=>net.poles[i]),ids.map(i=>net.weights[i]),knots,mult,degree))
    const first=knots[0],last=knots.at(-1)!,t0=first+(last-first)*segment/WHOLE_BOUNDARY_SEGMENTS,t1=first+(last-first)*(segment+1)/WHOLE_BOUNDARY_SEGMENTS
    let piece=iso
    if(t0>first){const split=k.curveSplit(piece,t0);split.forEach(own);piece=split[1]}
    if(t1<last){const split=k.curveSplit(piece,t1);split.forEach(own);piece=split[0]}
    const projected=k.projectPointOnEdge(piece,vec(seed)),t=projected.parameter
    if(!Number.isFinite(t)||t<t0||t>t1)throw Error('Proiezione fuori dal tratto CAD autorizzato.')
    const point=tuple(k.curvePointAtParam(iso,t))
    if(!point.every(Number.isFinite)||distance(point,tuple(projected.point))>tolerance)throw Error('Proiezione CAD incoerente.')
    const u=side==='U0'?b.uMin:side==='U1'?b.uMax:t,v=side==='V0'?b.vMin:side==='V1'?b.vMax:t
    if(u<b.uMin||u>b.uMax||v<b.vMin||v>b.vMax||distance(at(u,v),point)>tolerance)throw Error('Parametrizzazione del bordo non qualificata.')
    const location=k.classifyPointOnFace(face,u,v)
    if(location!=='in'&&location!=='on')throw Error('Bordo fuori dalla faccia CAD.')
    const edgeDistance=k.distanceBetween(own(k.makeVertex(...point)),matches[0])
    if(!Number.isFinite(edgeDistance)||edgeDistance>tolerance)throw Error('Isocurva non corrispondente al bordo topologico.')
    let origin=cameraOrigin
    if(parallelDirection){
      const length=Math.hypot(...parallelDirection)
      if(!parallelDirection.every(Number.isFinite)||Math.abs(length-1)>1e-8)throw Error('Direzione ortografica non valida.')
      const along=dot(point.map((x,d)=>x-cameraOrigin[d]) as Point,parallelDirection)
      if(along<=endpointMargin*10)throw Error('Bordo dietro il piano della camera.')
      origin=point.map((x,d)=>x-parallelDirection[d]*along) as Point
    }
    const depth=distance(point,origin)
    if(!Number.isFinite(depth)||depth<endpointMargin*10||depth>1e6)throw Error('Segmento di vista CAD non qualificabile.')
    const direction=point.map((x,d)=>(x-origin[d])/depth) as Point,normal=tuple(k.surfaceNormal(face,u,v))
    if(!normal.every(Number.isFinite)||Math.abs(dot(normal,direction))<.1)throw Error('Vista tangente o normale CAD ambigua.')
    const viewSegment=own(k.makeLineEdge(vec(origin),vec(point.map((x,d)=>x+direction[d]*endpointMargin) as Point)))
    const section=own(k.section(face,viewSegment)),sectionEdges=children(section,'edge'),vertices=children(section,'vertex')
    if(sectionEdges.length||!vertices.length||vertices.length>128)throw Error('Intersezione CAD assente o non puntuale.')
    const hits=vertices.map(vertex=>{
      const p=tuple(k.vertexPosition(vertex)),offset=p.map((x,d)=>x-origin[d]) as Point,along=dot(offset,direction)
      const onRay=origin.map((x,d)=>x+along*direction[d]) as Point
      if(!p.every(Number.isFinite)||along<0||along>depth+endpointMargin+tolerance||distance(onRay,p)>tolerance)throw Error('Intersezione CAD incoerente.')
      return {point:p,depth:along}
    }).sort((a,z)=>a.depth-z.depth)
    const base={point,firstDepthMm:hits[0].depth,anchorDepthMm:depth,intersectionCount:hits.length,frontDistanceMm:null,
      projectionDistanceMm:distance(point,seed),pickerSegment:segment}
    if(hits[0].depth<depth-tolerance)return {...base,visible:false,reason:'occluded'}
    if(hits.length!==1||distance(hits[0].point,point)>tolerance)return {...base,visible:false,reason:'ambiguous-intersection'}
    const front=own(k.makeLineEdge(vec(origin),vec(point.map((x,d)=>x-direction[d]*endpointMargin) as Point)))
    const frontDistance=k.distanceBetween(front,face)
    if(!Number.isFinite(frontDistance)||frontDistance<=tolerance)return {...base,frontDistanceMm:frontDistance,visible:false,reason:'front-segment-not-clear'}
    return {...base,frontDistanceMm:frontDistance,visible:true,reason:'native-section-and-clear-front'}
  }finally{owned.reverse().forEach(h=>k.release(h))}
}
