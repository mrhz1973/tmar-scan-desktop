// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { gizmoHandles } from '../surfaceGizmo'
import { evaluatePoleLockState } from '../poleEditability'
import { pickWorkspaceGizmoArrow } from '../workspaceGizmoPick'

const fixture = (): Net => ({
  nu:5,nv:5,du:3,dv:3,
  poles:Array.from({length:25},(_,i):Point=>[Math.floor(i/5),i%5,0]),
  weights:Array(25).fill(1),rational:[0,0],
  ku:[0,.5,1],kv:[0,.5,1],mu:[4,1,4],mv:[4,1,4],
})
const locked = (n:Net, continuity:'G0'|'G1') =>
  evaluatePoleLockState(n,{continuity,freeBoundary:false,trimLocks:[],manualLocks:[],hiddenPoles:[]}).locked
// Deliberately *not* the world camera: the host owns transformed part coordinates.
const project = ([x,y,z]:Point) => ({clientX:160+46*x+24*z,clientY:230+47*y-31*z,visible:true})
const radius=4
function setup(mode:'axis'|'local'|'screen'='axis',selected:number[]=[12],continuity:'G0'|'G1'='G1') {
  const net=fixture(),block=locked(net,continuity)
  return {net,selected,locked:block,hiddenPoles:[],mode,radius,clientX:0,clientY:0,projectPartPoint:project}
}
describe('V5 host-space XYZ picking',()=>{
  it('independently hits X, Y and Z of a selected G1 control point',()=>{
    const config=setup()
    const handles=gizmoHandles(config.net,config.selected,config.locked,[],'axis')
    expect(handles).toHaveLength(3)
    for(const handle of handles){
      const start=project(config.net.poles[handle.pole])
      const point=config.net.poles[handle.pole].map((v,i)=>v+handle.direction[i]*radius*.22) as Point
      const end=project(point)
      const hit=pickWorkspaceGizmoArrow({...config,clientX:start.clientX+(end.clientX-start.clientX)*.85,
        clientY:start.clientY+(end.clientY-start.clientY)*.85})
      expect(hit?.pole).toBe(12)
      expect(hit?.axis).toBe(handle.axis)
    }
    const centre=project(config.net.poles[12])
    expect(pickWorkspaceGizmoArrow({...config,clientX:centre.clientX,clientY:centre.clientY})).toBeNull()
  })

  it('keeps selected G1 boundary points protected and handles multiple editable points',()=>{
    const state=setup('axis',[12,6,13],'G1')
    const hs=gizmoHandles(state.net,state.selected,state.locked,[],'axis')
    expect(hs.map(h=>h.pole)).toEqual([12,12,12])
    const noMove=setup('axis',[6])
    expect(gizmoHandles(noMove.net,noMove.selected,noMove.locked,[],'axis')).toHaveLength(0)
    const free=setup('axis',[12,13,0],'G0')
    expect(gizmoHandles(free.net,free.selected,free.locked,[],'axis')).toHaveLength(6)
  })

  it('uses the host projector and ignores screen, invisible, malformed and short projections',()=>{
    const state=setup()
    const first=project(state.net.poles[12])
    const a=pickWorkspaceGizmoArrow({...state,clientX:first.clientX+40,clientY:first.clientY})
    expect(a?.axis).toBe(0)
    expect(pickWorkspaceGizmoArrow({...state,mode:'screen',clientX:first.clientX+40,clientY:first.clientY})).toBeNull()
    expect(pickWorkspaceGizmoArrow({...state,clientX:first.clientX+40,clientY:first.clientY,
      projectPartPoint:()=>({clientX:0,clientY:0,visible:false})})).toBeNull()
    expect(pickWorkspaceGizmoArrow({...state,clientX:first.clientX+40,clientY:first.clientY,
      projectPartPoint:()=>({clientX:1,clientY:1,visible:true})})).toBeNull()
    expect(pickWorkspaceGizmoArrow({...state,clientX:NaN,clientY:0})).toBeNull()
  })

  it('distinguishes local basis labels and rejects hidden or explicitly locked poles',()=>{
    const state=setup('local')
    expect(gizmoHandles(state.net,[12],state.locked,[],'local')).toHaveLength(3)
    expect(gizmoHandles(state.net,[12],state.locked,[12],'local')).toHaveLength(0)
    expect(gizmoHandles(state.net,[12],[12],[],'local')).toHaveLength(0)
  })
})
