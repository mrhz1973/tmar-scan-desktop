// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { assertNet, type Net, type Point } from '../brep'
import { createDragFrame } from '../dragFrame'
import { createSurfaceGesture } from '../surfaceGesture'
import { evaluatePoleLockState } from '../poleEditability'
import { GIZMO_AXES, GIZMO_AXIS_COLORS, gizmoAxisLabel, gizmoDragTargets,
  gizmoHandles, pickGizmoArrow } from '../surfaceGizmo'
import { populateSurfaceCage } from '../surfaceCage'

function fixture(): Net {
  const poles: Point[] = Array.from({length:25},(_,i)=>[Math.floor(i/5),i%5,0])
  return {nu:5,nv:5,du:3,dv:3,poles,weights:Array(25).fill(1),
    rational:[0,0],ku:[0,.5,1],kv:[0,.5,1],mu:[4,1,4],mv:[4,1,4]}
}
const locks=(n:Net,continuity:'G0'|'G1')=>
  evaluatePoleLockState(n,{continuity,freeBoundary:false,trimLocks:[],manualLocks:[],hiddenPoles:[]}).locked
function camera() {
  const cam=new THREE.PerspectiveCamera(40,1000/800,.1,200)
  cam.position.set(13,-11,16);cam.up.set(0,0,1)
  cam.lookAt(new THREE.Vector3(2,2,0));cam.updateProjectionMatrix();cam.updateMatrixWorld()
  return cam
}
const rect={left:110,top:70,width:1000,height:800}
const project=(v:THREE.Vector3,cam:THREE.Camera)=>{
  const ndc=v.clone().project(cam)
  return {x:rect.left+(ndc.x+1)*rect.width/2,y:rect.top+(1-ndc.y)*rect.height/2}
}
describe('three-axis per-pole 3D gizmo and group translation',()=>{
  it('draws red X / green Y / blue Z for each selected editable pole, never for locked ones',()=>{
    const net=fixture(),locked=locks(net,'G0')
    const a=gizmoHandles(net,[6,7,0,6],locked,[],'axis')
    expect(a.map(h=>[h.pole,h.axis])).toEqual([[6,0],[6,1],[6,2],[7,0],[7,1],[7,2]])
    expect(a.filter(h=>h.pole===0)).toHaveLength(0)
    expect(GIZMO_AXIS_COLORS).toEqual([0xff5555,0x58d16c,0x4d91ff])
    const group=new THREE.Group()
    populateSurfaceCage(group,{net,selected:[6,7,0],locked,hiddenPoles:[],showNet:false,
      dragMode:'axis',axis:2,mirrorAxis:0,mirrorOffset:0,mirrorPartners:null,radius:8})
    const arrows=group.children.filter(o=>o instanceof THREE.ArrowHelper) as THREE.ArrowHelper[]
    expect(arrows).toHaveLength(6)
    expect(arrows.map(a=>[a.userData.gizmoPole,a.userData.gizmoAxis])).toEqual(
      [[6,0],[6,1],[6,2],[7,0],[7,1],[7,2]])
    expect(arrows.map(a=>(a.line.material as THREE.LineBasicMaterial).color.getHex()))
      .toEqual([...GIZMO_AXIS_COLORS,...GIZMO_AXIS_COLORS])
  })

  it('projects and hits all three coloured world arrows independently',()=>{
    const net=fixture(),cam=camera(),selected=[12],locked=locks(net,'G1'),radius=8
    for(const axis of GIZMO_AXES) {
      const pole=new THREE.Vector3(...net.poles[12])
      const from=project(pole,cam),to=project(pole.clone().addScaledVector(
        new THREE.Vector3(...gizmoHandles(net,selected,locked,[],'axis')[axis].direction),radius*.22),cam)
      const x=from.x+(to.x-from.x)*.76,y=from.y+(to.y-from.y)*.76
      const hit=pickGizmoArrow({net,selected,locked,hiddenPoles:[],mode:'axis',camera:cam,rect,radius,clientX:x,clientY:y})
      expect(hit?.pole).toBe(12)
      expect(hit?.axis).toBe(axis)
      expect(gizmoAxisLabel('axis',axis)).toBe(['X','Y','Z'][axis])
      const center=pickGizmoArrow({net,selected,locked,hiddenPoles:[],mode:'axis',camera:cam,rect,
        radius,clientX:from.x,clientY:from.y})
      expect(center).toBeNull()
    }
  })

  it('moves multiple editable poles along the selected clicked axis only, then supports undo-style restore',()=>{
    const net=fixture(),cam=camera(),selected=[12,13,0],locked=locks(net,'G0'),radius=8
    const start=new THREE.Vector3(...net.poles[12]),axis=0
    const origin=project(start,cam),tip=project(start.clone().add(new THREE.Vector3(radius*.22,0,0)),cam)
    const at=.75,x=origin.x+(tip.x-origin.x)*at,y=origin.y+(tip.y-origin.y)*at
    // The group is selected, but the hit is unambiguously associated with pole 12.
    const hit=pickGizmoArrow({net,selected:[12],locked,hiddenPoles:[],mode:'axis',camera:cam,rect,radius,clientX:x,clientY:y})
    expect(hit?.axis).toBe(axis)
    const targets=gizmoDragTargets(hit!.pole,selected,locked)
    expect(targets).toEqual([12,13])
    const frame=createDragFrame({camera:cam,partWorld:new THREE.Matrix4(),rect,anchor:net.poles[12],
      clientX:x,clientY:y,mode:'axis',direction:hit!.direction,allowViewAlignedDepth:true})
    expect(frame).not.toBeNull()
    const gesture=createSurfaceGesture({frame:frame!,poles:net.poles,selected:targets,
      start:{pointerId:7,clientX:x,clientY:y},strength:1})
    expect(gesture).not.toBeNull()
    const to=project(start.clone().add(new THREE.Vector3(3.2,0,0)),cam)
    const next=gesture!.move({pointerId:7,clientX:to.x,clientY:to.y})
    expect(next.kind).toBe('preview')
    const saved=gesture!.up({pointerId:7,clientX:to.x,clientY:to.y})
    expect(saved.kind).toBe('commit')
    if(saved.kind!=='commit')return
    expect(Math.abs(saved.delta[0])).toBeGreaterThan(.05)
    expect(Math.abs(saved.delta[1])).toBeLessThan(1e-8)
    expect(Math.abs(saved.delta[2])).toBeLessThan(1e-8)
    expect(saved.poles[12][0]-net.poles[12][0]).toBeCloseTo(saved.delta[0],9)
    expect(saved.poles[13][0]-net.poles[13][0]).toBeCloseTo(saved.delta[0],9)
    expect(saved.poles[0]).toEqual(net.poles[0])
    expect(()=>assertNet(net,{...net,poles:saved.poles},'G0')).not.toThrow()
    const restored=net.poles.map(p=>[...p] as Point)
    expect(restored).toEqual(net.poles)
    expect(saved.poles).not.toEqual(restored)
    expect(gizmoDragTargets(0,selected,locked)).toEqual([])
  })

  it('retains local U/V/N arrows and hides the gizmo in screen mode',()=>{
    const net=fixture(),locked=locks(net,'G1')
    const local=gizmoHandles(net,[12],locked,[],'local')
    expect(local).toHaveLength(3)
    expect(local.map(h=>gizmoAxisLabel('local',h.axis))).toEqual(['U','V','N'])
    expect(local.every(h=>Math.abs(Math.hypot(...h.direction)-1)<1e-10)).toBe(true)
    expect(gizmoHandles(net,[12],locked,[],'screen')).toHaveLength(0)
    expect(gizmoHandles(net,[6],locked,[],'axis')).toHaveLength(0)
    const manual=gizmoHandles(net,[12],[12],[],'axis')
    expect(manual).toHaveLength(0)
  })
})
