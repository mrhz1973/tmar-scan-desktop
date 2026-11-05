// SPDX-License-Identifier: AGPL-3.0-only
import type { OcctKernel, ShapeHandle } from 'occt-wasm'
import { planeNet, surfaceTable, type Net, type Point } from './brep'

export type NaturalSide = 'uMin' | 'uMax' | 'vMin' | 'vMax'
export interface G1SourceStamp { sourceId: string; sourceRevision: number; selectionRevision: number; faceIndex: number }
export interface G1SupportCandidate {
  id: string
  stamp: G1SourceStamp
  supportFaceIndex: number
  edgeIndex: number
  side: NaturalSide
  lengthMm: number
  plane: { origin: Point; normal: Point }
}
const EPS = 1e-8
const point = (p: { x: number; y: number; z: number }): Point => [p.x,p.y,p.z]
const distance = (a: Point,b: Point) => Math.hypot(...a.map((v,i)=>v-b[i]))
const sameStamp = (a:G1SourceStamp,b:G1SourceStamp) => a.sourceId===b.sourceId && a.sourceRevision===b.sourceRevision && a.selectionRevision===b.selectionRevision && a.faceIndex===b.faceIndex

/** Certifies only natural quadrilateral supports with straight, monotone
 * boundaries. Collinear positive-weight NURBS control polygons prove their
 * entire boundary lies on the line; UV sampling is deliberately not a proof. */
function boundaryPoles(k:OcctKernel,face:ShapeHandle): Record<NaturalSide,Point[]> {
  const text=k.toBREP(face), records=surfaceTable(text)
  const headers=[...text.matchAll(/^Fa\s*\n\s*([01])\s+([\deE+.-]+)\s+(\d+)\s+(\d+)\s*$/gm)]
  if(headers.length!==1 || Number(headers[0][4])!==0) throw new Error('Supporto con trasformazione o identità ambigua.')
  const record=records[Number(headers[0][3])-1], bounds=k.uvBounds(face)
  if(!record || !Object.values(bounds).every(Number.isFinite) || bounds.uMax<=bounds.uMin || bounds.vMax<=bounds.vMin) throw new Error('Supporto non determinato.')
  const n:Net|undefined=record.kind===1 ? planeNet(record,[bounds.uMin,bounds.uMax,bounds.vMin,bounds.vMax]) : record.net
  if(!n || n.mu[0]!==n.du+1 || n.mu.at(-1)!==n.du+1 || n.mv[0]!==n.dv+1 || n.mv.at(-1)!==n.dv+1)
    throw new Error('Serve un supporto clamped non periodico con bordi rettilinei.')
  if(n.poles.some(p=>!p.every(Number.isFinite)) || n.weights.some(w=>!Number.isFinite(w)||w<=0)) throw new Error('Supporto non finito.')
  return { uMin:n.poles.slice(0,n.nv),uMax:n.poles.slice((n.nu-1)*n.nv),
    vMin:Array.from({length:n.nu},(_,u)=>n.poles[u*n.nv]),vMax:Array.from({length:n.nu},(_,u)=>n.poles[u*n.nv+n.nv-1]) }
}
function matchesLine(k:OcctKernel,edge:ShapeHandle,poles:Point[]):boolean {
  if(k.curveType(edge)!=='line') return false
  const {first,last}=k.curveParameters(edge)
  if(!Number.isFinite(first)||!Number.isFinite(last)||last<=first) return false
  const a=point(k.curvePointAtParam(edge,first)),b=point(k.curvePointAtParam(edge,last)),start=poles[0],end=poles.at(-1)!
  if(!((distance(a,start)<=EPS&&distance(b,end)<=EPS)||(distance(b,start)<=EPS&&distance(a,end)<=EPS)))return false
  const d=end.map((v,i)=>v-start[i]),length2=d.reduce((s,v)=>s+v*v,0)
  if(length2<=EPS*EPS)return false
  let previous=-Infinity
  return poles.every(p=>{
    const t=p.reduce((s,v,i)=>s+(v-start[i])*d[i],0)/length2
    const on=distance(p,start.map((v,i)=>v+t*d[i]) as Point)<=EPS && t>=-EPS && t<=1+EPS && t>=previous-EPS
    previous=t;return on
  })
}

/** Borrowed source; every acquired OCCT handle is released before return.
 * sourceId must identify frozen source bytes, and revisions are host-owned.
 * Candidate IDs are valid only for that exact source/selection stamp. */
export function listG1SupportCandidates(k:OcctKernel,source:ShapeHandle,stamp:G1SourceStamp):G1SupportCandidate[] {
  if(!stamp.sourceId.trim() || ![stamp.sourceRevision,stamp.selectionRevision,stamp.faceIndex].every(x=>Number.isSafeInteger(x)&&x>=0))throw new Error('Identità sorgente non valida.')
  if(!k.isValid(source))throw new Error('Sorgente CAD non valida.')
  const owned:ShapeHandle[]=[]
  const own=(hs:ShapeHandle[])=>{owned.push(...hs);return hs}
  try {
    const faces=own(k.getSubShapes(source,'face')),selected=faces[stamp.faceIndex]
    if(!selected)throw new Error('Faccia selezionata assente.')
    if(!['forward','reversed'].includes(k.shapeOrientation(selected)))throw new Error('Orientamento della faccia non supportato.')
    for(let i=0;i<faces.length;i++)for(let j=0;j<i;j++)if(k.isSame(faces[i],faces[j]))throw new Error('Occorrenze faccia ambigue.')
    const wires=own(k.getSubShapes(selected,'wire'))
    if(wires.length!==1)throw new Error('Serve una faccia naturale senza fori.')
    const perFace=faces.map(f=>own(k.getSubShapes(f,'edge'))),edges=perFace[stamp.faceIndex]
    if(edges.length!==4)throw new Error('Serve un contorno naturale a quattro bordi.')
    const boundaries=boundaryPoles(k,selected),sides=Object.keys(boundaries) as NaturalSide[]
    const edgeSides=edges.map(e=>sides.filter(side=>matchesLine(k,e,boundaries[side])))
    if(edgeSides.some(s=>s.length!==1)||new Set(edgeSides.map(s=>s[0])).size!==4)throw new Error('Bordo naturale rettilineo non certificabile.')
    const choices:G1SupportCandidate[]=[]
    edges.forEach((edge,edgeIndex)=>{
      const incidence=perFace.flatMap((es,i)=>es.some(e=>k.isSame(e,edge))?[i]:[])
      if(incidence.length>2)throw new Error('Bordo non manifold: supporto ambiguo.')
      if(incidence.length!==2)return
      const supportFaceIndex=incidence.find(i=>i!==stamp.faceIndex)!,support=faces[supportFaceIndex]
      if(k.surfaceType(support)!=='plane')return
      const shared=own(k.sharedEdges(selected,support))
      if(!shared.some(e=>k.isSame(e,edge)))throw new Error('Adiacenza CAD incoerente.')
      const b=k.uvBounds(support),u=(b.uMin+b.uMax)/2,v=(b.vMin+b.vMax)/2
      const origin=point(k.pointOnSurface(support,u,v)),raw=point(k.surfaceNormal(support,u,v)),length=Math.hypot(...raw)
      const orientation=k.shapeOrientation(support)
      if(!origin.every(Number.isFinite)||!raw.every(Number.isFinite)||!Number.isFinite(length)||length<=EPS||!['forward','reversed'].includes(orientation))throw new Error('Piano di supporto non determinato.')
      const lengthMm=k.curveLength(edge)
      if(!Number.isFinite(lengthMm)||lengthMm<=EPS)throw new Error('Bordo degenere.')
      choices.push({id:JSON.stringify([stamp.sourceId,stamp.sourceRevision,stamp.selectionRevision,stamp.faceIndex,supportFaceIndex,edgeIndex]),stamp:{...stamp},supportFaceIndex,edgeIndex,side:edgeSides[edgeIndex][0],lengthMm,plane:{origin,normal:raw.map(x=>x/length) as Point}})
    })
    return choices
  } finally { for(const h of owned)k.release(h) }
}

/** Recomputes topology; never guesses a replacement by proximity or hash. */
export function resolveG1SupportCandidate(k:OcctKernel,source:ShapeHandle,current:G1SourceStamp,choice:G1SupportCandidate):G1SupportCandidate {
  if(!sameStamp(current,choice.stamp))throw new Error('Scelta del supporto scaduta.')
  const found=listG1SupportCandidates(k,source,current).find(c=>c.id===choice.id)
  if(!found || found.supportFaceIndex!==choice.supportFaceIndex || found.edgeIndex!==choice.edgeIndex || found.side!==choice.side)throw new Error('Scelta del supporto non disponibile.')
  return found
}
