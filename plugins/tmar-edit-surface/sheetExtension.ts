// SPDX-License-Identifier: AGPL-3.0-only
import type { OcctKernel, ShapeHandle } from 'occt-wasm'
import type { Point } from './brep'

// Count incidences across all face wires, including inner loops. A seam
// has two incidences and cannot be selected again as a free outer edge.
function withBoundary<T>(k:OcctKernel,shape:ShapeHandle,read:(edges:ShapeHandle[],incidences:number[])=>T):T {
  const owned:ShapeHandle[]=[], unique:ShapeHandle[]=[], counts:number[]=[], outerFlags:boolean[]=[]
  try {
    const faces=k.getSubShapes(shape,'face');owned.push(...faces)
    for(const face of faces){
      const outer=k.outerWire(face);owned.push(outer)
      const wires=k.getSubShapes(face,'wire');owned.push(...wires)
      for(const wire of wires){
        const edges=k.getSubShapes(wire,'edge');owned.push(...edges)
        for(const edge of edges){
          const id=unique.findIndex(other=>k.isSame(edge,other))
          if(id<0){unique.push(edge);counts.push(1);outerFlags.push(k.isSame(wire,outer))}
          else counts[id]++
        }
      }
    }
    return read(unique.filter((_,i)=>counts[i]===1 && outerFlags[i]),counts)
  } finally {owned.reverse().forEach(h=>k.release(h))}
}
export interface StripMove {edge:number;delta:Point;path:Point[]}
export function sheetEdgePaths(k: OcctKernel, shape: ShapeHandle): Point[][] {
  return withBoundary(k,shape,edges=>edges.map(edge=>{
        const {first,last}=k.curveParameters(edge)
        const steps=k.curveType(edge)==='line'?1:48
        return Array.from({length:steps+1},(_,i)=>{
          const p=k.curvePointAtParam(edge,first+(last-first)*i/steps)
          return [p.x,p.y,p.z] as Point
        })
  }))
}

/** Extrude the chosen boundary curve, then sew its ruled face to the
 * original sheet. The original surface is never refitted or overwritten. */
export function extendSheet(k: OcctKernel, shape: ShapeHandle, index: number, delta: Point) {
  if (delta.length!==3 || !delta.every(Number.isFinite) || Math.hypot(...delta)<=1e-7)
    throw new Error('Indica uno spostamento del bordo diverso da zero.')
  const owned: ShapeHandle[]=[]
  const keep=(h:ShapeHandle)=>{owned.push(h);return h}
  const children=(s:ShapeHandle,type:'face'|'edge'|'shell'|'vertex')=>{
    const handles=k.getSubShapes(s,type);owned.push(...handles);return handles
  }
  try {
    const sourceFaces=children(shape,'face')
    return withBoundary(k,shape,(edges,incidences)=>{
    if(!Number.isInteger(index) || !edges[index]) throw new Error('Scegli un bordo esterno della superficie.')
    const edge=edges[index], strip=keep(k.extrude(edge,...delta))
    const addedArea=k.getSurfaceArea(strip)
    if(!k.isValid(strip) || !Number.isFinite(addedArea) || addedArea<=1e-8)
      throw new Error('La direzione scelta non crea una faccia valida.')
    const common=keep(k.common(shape,strip))
    if(children(common,'face').length) throw new Error('La striscia si sovrappone alla superficie.')
    const section=keep(k.section(shape,strip))
    const requireOnSeam=(vertex:ShapeHandle)=>{
      if(k.distanceBetween(vertex,edge)>1e-6) throw new Error('La striscia interseca la superficie fuori dal bordo scelto.')
    }
    children(section,'vertex').forEach(requireOnSeam)
    for(const cut of children(section,'edge')){
      const t=k.curveParameters(cut)
      for(let i=1;i<16;i++){
        const p=k.curvePointAtParam(cut,t.first+(t.last-t.first)*i/16)
        requireOnSeam(keep(k.makeVertex(p.x,p.y,p.z)))
      }
    }
    const shell=k.sew([...sourceFaces,strip],1e-7)
    try {
      if(!k.isValid(shell) || children(shell,'shell').length!==1 || children(shell,'face').length!==sourceFaces.length+1)
        throw new Error('Le facce non formano una superficie cucita valida.')
      withBoundary(k,shell,(_,counts)=>{
        const shared=(values:number[])=>values.filter(n=>n===2).length
        if(counts.some(n=>n>2) || shared(counts)!==shared(incidences)+1)
          throw new Error('Cucitura del bordo non univoca.')
      })
      return {shell,addedArea}
    } catch(e){k.release(shell);throw e}
    })
  } finally {owned.reverse().forEach(h=>k.release(h))}
}
