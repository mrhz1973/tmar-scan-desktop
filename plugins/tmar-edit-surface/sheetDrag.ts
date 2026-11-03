// SPDX-License-Identifier: AGPL-3.0-only
import * as THREE from 'three'
import type {Point} from './brep'

export interface StripDrag {
  paths: Point[][]
  axis: number
  edge: number
  delta: Point
  change(edge:number, delta:Point, final:boolean): void
}
export interface DirectStrip {
  paths: Point[][]
  axis: number
  revision: number
  begin(): boolean
  abort(): void
  unavailable(): void
  change(edge:number, delta:Point, final:boolean): void
}

// Shared by edge selection and the drag: an indicated edge cannot silently
// switch to a neighbouring edge when their projections are close.
export function pickSheetEdge(paths:Point[][],camera:THREE.Camera,rect:DOMRect,
  x:number,y:number,only=-1,limit=8) {
  const mouse=new THREE.Vector2(x,y),raycaster=new THREE.Raycaster()
  raycaster.setFromCamera(new THREE.Vector2((x-rect.left)*2/rect.width-1,1-(y-rect.top)*2/rect.height),camera)
  let best=limit, edge=-1, hit=new THREE.Vector3(), anchor=new THREE.Vector3()
  paths.forEach((path,id)=>{
    if(only>=0 && id!==only)return
    for(let i=1;i<path.length;i++){
      const a=new THREE.Vector3(...path[i-1]), b=new THREE.Vector3(...path[i])
      const screen=(v:THREE.Vector3)=>{const p=v.clone().project(camera);return new THREE.Vector2(rect.left+(1+p.x)*rect.width/2,rect.top+(1-p.y)*rect.height/2)}
      const start=screen(a), segment=screen(b).sub(start)
      if(segment.lengthSq()<1)continue
      const t=THREE.MathUtils.clamp(mouse.clone().sub(start).dot(segment)/segment.lengthSq(),0,1)
      const distance=start.addScaledVector(segment,t).distanceTo(mouse)
      if(distance<best){
        raycaster.ray.distanceSqToSegment(a,b,undefined,hit)
        // Screen-space interpolation is not affine in perspective. Use the
        // ray's closest point on the 3D edge for the handle anchor.
        anchor.copy(hit);best=distance;edge=id
      }
    }
  })
  return edge<0?null:{edge,hit,anchor}
}

export function drawStrip(tool:StripDrag) {
  const group=new THREE.Group()
  tool.paths.forEach((path,index)=>{
    const pts=path.map(p=>new THREE.Vector3(...p))
    const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({color:index===tool.edge?0xffce30:0x00e8d2,depthTest:false}))
    line.renderOrder=8; group.add(line)
    if(index!==tool.edge) return
    const positions:number[]=[], offset=new THREE.Vector3(...tool.delta)
    for(let i=1;i<pts.length;i++){
      const a=pts[i-1], b=pts[i], c=b.clone().add(offset), d=a.clone().add(offset)
      for(const v of [a,b,c,a,c,d]) positions.push(v.x,v.y,v.z)
    }
    const g=new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions,3))
    group.add(new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:0x46dcc3,side:THREE.DoubleSide,
      transparent:true,opacity:.7,depthWrite:false})))
  })
  return group
}

export function bindStripDrag(div:HTMLDivElement,camera:THREE.Camera,getTool:()=>StripDrag|null,blocked:()=>boolean,
  getDirect:()=>DirectStrip|null=()=>null){
  let drag:{id:number;edge:number;axis:number;hit:THREE.Vector3;start:number;offsetX:number;offsetY:number;change:StripDrag['change'];direct:DirectStrip|null}|null=null
  const raycaster=new THREE.Raycaster()
  const axisParameter=(x:number,y:number,hit:THREE.Vector3,axis:number)=>{
    const rect=div.getBoundingClientRect()
    raycaster.setFromCamera(new THREE.Vector2((x-rect.left)*2/rect.width-1,1-(y-rect.top)*2/rect.height),camera)
    const ray=raycaster.ray, offset=ray.origin.clone().sub(hit), cosine=ray.direction.getComponent(axis)
    const denominator=1-cosine*cosine
    return denominator<1e-6?null:(offset.getComponent(axis)-cosine*offset.dot(ray.direction))/denominator
  }
  const down=(e:PointerEvent)=>{
    if(drag || e.button!==0 || blocked())return
    const handle=e.target instanceof Element ? e.target.closest<HTMLElement>('[data-strip-direct-edge]') : null
    const direct=handle ? getDirect() : null
    const tool=getTool() ?? direct
    if(!tool)return
    const forced=handle ? Number(handle.dataset.stripDirectEdge) : -1
    if(handle && (!direct || !Number.isInteger(forced) || forced<0))return
    const values=handle?.dataset.stripDirectAnchor?.split(',').map(Number)
    const anchor=values?.length===3 && values.every(Number.isFinite) ? new THREE.Vector3(...values as [number,number,number]) : null
    const picked=anchor && forced<tool.paths.length ? {edge:forced,hit:anchor} : pickSheetEdge(tool.paths,camera,div.getBoundingClientRect(),e.clientX,e.clientY,forced,handle?Infinity:8)
    if(!picked)return
    const {edge,hit}=picked
    const rect=div.getBoundingClientRect(), projection=hit.clone().project(camera)
    // The visible D is offset from the edge; subtract the offset before
    // computing its motion, so it behaves as if grabbed at the real edge.
    const offsetX=handle ? e.clientX-(rect.left+(projection.x+1)*rect.width/2) : 0
    const offsetY=handle ? e.clientY-(rect.top+(1-projection.y)*rect.height/2) : 0
    const start=axisParameter(e.clientX-offsetX,e.clientY-offsetY,hit,tool.axis)
    if(start===null){direct?.unavailable();return}
    if(direct && !direct.begin())return
    e.stopPropagation();e.preventDefault();div.setPointerCapture(e.pointerId)
    drag={id:e.pointerId,edge,axis:tool.axis,hit,start,offsetX,offsetY,change:tool.change,direct}
  }
  const update=(e:PointerEvent,final:boolean)=>{
    if(!drag||e.pointerId!==drag.id)return
    e.stopPropagation()
    const d=drag, v:Point=[0,0,0]
    const position=axisParameter(e.clientX-d.offsetX,e.clientY-d.offsetY,d.hit,d.axis)
    if(position!==null)v[d.axis]=position-d.start
    if(final){
      drag=null;div.releasePointerCapture(e.pointerId)
      if(d.direct && Math.hypot(...v)<1e-7){d.direct.abort();return}
    }
    ;(getTool()?.change ?? d.change)(d.edge,v,final)
  }
  const move=(e:PointerEvent)=>update(e,false), up=(e:PointerEvent)=>update(e,true)
  const cancelGesture=()=>{
    if(!drag)return false
    const d=drag;drag=null
    if(div.hasPointerCapture(d.id))div.releasePointerCapture(d.id)
    if(d.direct)d.direct.abort()
    else (getTool()?.change ?? d.change)(-1,[0,0,0],false)
    return true
  }
  const cancel=(e:PointerEvent)=>{if(drag?.id===e.pointerId)cancelGesture()}
  div.addEventListener('pointerdown',down,true);div.addEventListener('pointermove',move,true)
  div.addEventListener('pointerup',up,true);div.addEventListener('pointercancel',cancel,true)
  return {cancel:cancelGesture,dispose:()=>{div.removeEventListener('pointerdown',down,true);div.removeEventListener('pointermove',move,true)
    div.removeEventListener('pointerup',up,true);div.removeEventListener('pointercancel',cancel,true)}}
}
