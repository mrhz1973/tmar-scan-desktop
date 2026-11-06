// SPDX-License-Identifier: AGPL-3.0-only
// Research-only adapter. Not a worker, UI, persistence or production API.
import type { Mesh, OcctKernel, ShapeHandle } from 'occt-wasm'
import type { Net } from './brep'
import { SurfaceEditorKernel } from './editorKernel'

// Sampled protection only: never a substitute for exact topology qualification.
export function verifyOtherFacesSampled(k:OcctKernel, original:readonly ShapeHandle[], candidate:readonly ShapeHandle[], target:number):void {
  const samples=(face:ShapeHandle)=>{
    const b=k.uvBounds(face), out:{x:number;y:number;z:number}[]=[]
    for(let i=0;i<=6;i++) for(let j=0;j<=6;j++) {
      const u=b.uMin+(b.uMax-b.uMin)*i/6,v=b.vMin+(b.vMax-b.vMin)*j/6
      if(['in','on'].includes(k.classifyPointOnFace(face,u,v))) out.push(k.pointOnSurface(face,u,v))
    }
    const edges=k.getSubShapes(face,'edge')
    try {for(const edge of edges) {
      const range=k.curveParameters(edge)
      if(!Number.isFinite(range.first)||!Number.isFinite(range.last)) throw new Error('Bordo non verificabile.')
      for(let i=0;i<=6;i++) out.push(k.curvePointAtParam(edge,range.first+(range.last-range.first)*i/6))
    }} finally {edges.forEach(edge=>k.release(edge))}
    if(out.length<3) throw new Error('Campioni insufficienti per verificare una faccia vicina.')
    return out
  }
  const match=(a:ShapeHandle,b:ShapeHandle)=>{
    if(k.surfaceType(a)!==k.surfaceType(b)||k.shapeOrientation(a)!==k.shapeOrientation(b)) return false
    const aa=k.getSurfaceArea(a),ab=k.getSurfaceArea(b)
    if(!Number.isFinite(aa)||!Number.isFinite(ab)||Math.abs(aa-ab)>Math.max(1e-7,aa*1e-8)) return false
    for(const [from,to] of [[a,b],[b,a]] as const) for(const p of samples(from)) {
      const vertex=k.makeVertex(p.x,p.y,p.z)
      try {const distance=k.distanceBetween(vertex,to);if(!Number.isFinite(distance)||distance>1e-6) return false} finally {k.release(vertex)}
    }
    return true
  }
  const remaining=new Set(candidate.map((_,i)=>i))
  for(let i=0;i<original.length;i++) if(i!==target) {
    const matches=[...remaining].filter(j=>match(original[i],candidate[j]))
    if(matches.length!==1) throw new Error('Faccia vicina alterata o corrispondenza ambigua.')
    remaining.delete(matches[0])
  }
  if(remaining.size!==1) throw new Error('Topologia delle facce non verificabile.')
}

export class ExperimentalSharedPlane {
  private source: ShapeHandle | null = null
  private faces: ShapeHandle[] = []
  private isolated: SurfaceEditorKernel | null = null
  private target = -1
  private sourceBefore = ''
  constructor(private readonly kernel: OcctKernel) {}

  open(step: string, target: number): Net {
    if (this.source !== null) throw new Error('Esperimento già aperto.')
    const k=this.kernel
    try {
      this.source=k.importStep(step)
      if(!k.isValid(this.source)) throw new Error('Solido sorgente non valido.')
      const solids=k.getSubShapes(this.source,'solid')
      try {if(solids.length!==1) throw new Error('Serve un solo solido.')}
      finally {solids.forEach(s=>k.release(s))}
      this.faces=k.getSubShapes(this.source,'face')
      if(!Number.isInteger(target) || target<0 || target>=this.faces.length || k.surfaceType(this.faces[target])!=='plane')
        throw new Error('Serve una faccia piana valida.')
      const wires=k.getSubShapes(this.faces[target],'wire');let edges:ShapeHandle[]=[]
      try {edges=k.getSubShapes(this.faces[target],'edge');if(wires.length!==1 || edges.length!==4) throw new Error('Serve una faccia a quattro bordi senza fori.')}
      finally {[...wires,...edges].forEach(s=>k.release(s))}
      this.isolated=new SurfaceEditorKernel(k)
      const opened=this.isolated.open(k.exportStep(this.faces[target]))
      if(opened.faces.length!==1) throw new Error('Faccia isolata non verificabile.')
      const net=this.isolated.select(0)
      this.target=target
      this.sourceBefore=k.toBREP(this.source)
      return structuredClone(net)
    } catch(error) {this.dispose();throw error}
  }

  evaluate(net: Net, includeMesh=false): {step:string; volume:number; mesh?:Mesh; faceMeshes?:Mesh[]} {
    if(this.source===null || !this.isolated || this.target<0) throw new Error('Apri prima una faccia.')
    const k=this.kernel, owned:ShapeHandle[]=[]
    const own=(shape:ShapeHandle)=>{owned.push(shape);return shape}
    try {
      const edit=this.isolated.evaluate(net,'G1',true)
      const modified=own(k.importStep(edit.step!)), modifiedFaces=k.getSubShapes(modified,'face');owned.push(...modifiedFaces)
      if(!k.isValid(modified) || modifiedFaces.length!==1) throw new Error('Faccia modificata non valida.')
      // OCCT sewing may update input subshapes. Never pass the retained source.
      const working=own(k.fromBREP(this.sourceBefore)), workingFaces=k.getSubShapes(working,'face');owned.push(...workingFaces)
      if(!k.isValid(working) || workingFaces.length!==this.faces.length) throw new Error('Copia CAD non verificabile.')
      // An index is only usable when reimport preserved each serialized face.
      for(let i=0;i<workingFaces.length;i++) if(k.toBREP(workingFaces[i])!==k.toBREP(this.faces[i]))
        throw new Error('Identità delle facce non verificabile nella copia CAD.')
      // Reject intersections away from the original shared boundary before sewing.
      const boundary=k.getSubShapes(workingFaces[this.target],'wire');owned.push(...boundary)
      const check=(p:{x:number;y:number;z:number})=>{
        const vertex=k.makeVertex(p.x,p.y,p.z)
        try {if(!boundary.some(wire=>k.distanceBetween(vertex,wire)<=1e-6))
          throw new Error('La faccia modificata interseca un’altra faccia fuori dal bordo originale.')}
        finally {k.release(vertex)}
      }
      for(const other of workingFaces.filter((_,i)=>i!==this.target)) {
        const section=own(k.section(modifiedFaces[0],other))
        const edges=k.getSubShapes(section,'edge');owned.push(...edges)
        const vertices=k.getSubShapes(section,'vertex');owned.push(...vertices)
        for(const vertex of vertices) {
          if(k.distanceBetween(vertex,workingFaces[this.target])>1e-6) throw new Error('Intersezione fuori dalla faccia originale.')
          if(!boundary.some(wire=>k.distanceBetween(vertex,wire)<=1e-6)) throw new Error('Intersezione fuori dal bordo originale.')
        }
        for(const edge of edges) {
          const range=k.curveParameters(edge)
          for(let i=0;i<=16;i++) check(k.curvePointAtParam(edge,range.first+(range.last-range.first)*i/16))
        }
      }
      const joined=own(k.sewAndSolidify([...workingFaces.filter((_,i)=>i!==this.target),modifiedFaces[0]],1e-7))
      const joinedFaces=k.getSubShapes(joined,'face');owned.push(...joinedFaces)
      const solids=k.getSubShapes(joined,'solid');owned.push(...solids)
      if(!k.isValid(joined) || solids.length!==1 || joinedFaces.length!==this.faces.length)
        throw new Error('Ricomposizione non valida o topologia alterata.')
      verifyOtherFacesSampled(k,this.faces,joinedFaces,this.target)
      const volume=k.getVolume(joined)
      if(!Number.isFinite(volume)||volume<=0) throw new Error('Volume non valido.')
      if(k.toBREP(this.source)!==this.sourceBefore) throw new Error('La sorgente CAD è cambiata durante la ricomposizione.')
      const step=k.exportStep(joined)
      const display=includeMesh?{mesh:k.tessellate(joined,{linearDeflection:.08,angularDeflection:.15}),
        faceMeshes:joinedFaces.map(face=>k.tessellate(face,{linearDeflection:.08,angularDeflection:.15}))}:{}
      return {step,volume,...display}
    } finally {
      owned.reverse().forEach(s=>k.release(s))
      let changed=false
      try {changed=this.source===null || k.toBREP(this.source)!==this.sourceBefore} catch {changed=true}
      if(changed) {this.dispose();throw new Error('Sorgente CAD non verificabile: esperimento chiuso.')}
    }
  }

  dispose(): void {
    this.isolated?.dispose();this.isolated=null
    this.faces.forEach(face=>this.kernel.release(face));this.faces=[]
    if(this.source!==null) this.kernel.release(this.source)
    this.source=null;this.target=-1;this.sourceBefore=''
  }
}
