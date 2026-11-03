// SPDX-License-Identifier: AGPL-3.0-only
import type { OcctKernel, ShapeHandle } from 'occt-wasm'
import type { Point } from './brep'

export function sheetEdgePaths(k: OcctKernel, face: ShapeHandle): Point[][] {
  const outer = k.outerWire(face)
  try {
    const edges = k.getSubShapes(outer,'edge')
    try {
      return edges.map(edge=>{
        const {first,last}=k.curveParameters(edge)
        const steps=k.curveType(edge)==='line'?1:48
        return Array.from({length:steps+1},(_,i)=>{
          const p=k.curvePointAtParam(edge,first+(last-first)*i/steps)
          return [p.x,p.y,p.z] as Point
        })
      })
    } finally {edges.forEach(h=>k.release(h))}
  } finally {k.release(outer)}
}

/** Extrude the chosen boundary curve, then sew its ruled face to the
 * original sheet. The original surface is never refitted or overwritten. */
export function extendSheet(k: OcctKernel, face: ShapeHandle, index: number, delta: Point) {
  if (delta.length!==3 || !delta.every(Number.isFinite) || Math.hypot(...delta)<=1e-7)
    throw new Error('Indica uno spostamento del bordo diverso da zero.')
  const owned: ShapeHandle[]=[]
  const keep=(h:ShapeHandle)=>{owned.push(h);return h}
  const children=(s:ShapeHandle,type:'face'|'edge'|'shell'|'vertex')=>{
    const handles=k.getSubShapes(s,type);owned.push(...handles);return handles
  }
  try {
    const outer=keep(k.outerWire(face)), edges=children(outer,'edge')
    if(!Number.isInteger(index) || !edges[index]) throw new Error('Scegli un bordo esterno della superficie.')
    const edge=edges[index], strip=keep(k.extrude(edge,...delta))
    const addedArea=k.getSurfaceArea(strip)
    if(!k.isValid(strip) || !Number.isFinite(addedArea) || addedArea<=1e-8)
      throw new Error('La direzione scelta non crea una faccia valida.')
    const common=keep(k.common(face,strip))
    if(children(common,'face').length) throw new Error('La striscia si sovrappone alla superficie.')
    const section=keep(k.section(face,strip))
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
    const shell=keep(k.sew([face,strip],1e-7)), faces=children(shell,'face')
    if(!k.isValid(shell) || children(shell,'shell').length!==1 || faces.length!==2)
      throw new Error('Le due facce non formano una superficie cucita valida.')
    const left=children(faces[0],'edge'), right=children(faces[1],'edge')
    if(left.filter(a=>right.some(b=>k.isSame(a,b))).length!==1)
      throw new Error('Cucitura del bordo non univoca.')
    return {step:k.exportStep(shell), addedArea, totalArea:k.getSurfaceArea(shell)}
  } finally {owned.reverse().forEach(h=>k.release(h))}
}
