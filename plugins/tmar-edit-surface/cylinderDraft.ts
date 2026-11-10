// SPDX-License-Identifier: AGPL-3.0-only
import type { Mesh, OcctKernel } from 'occt-wasm'
import type { Net, Point } from './brep'
import { evaluatePreparedCylinder } from './cylinderEvaluation'
import { moveSmoothCylinderPole } from './periodic'
import { SurfaceHistory } from './surfaceHistory'

/** Isolated experimental draft; the shared editor and Apply do not use it.
 * Every geometric history frame is CAD-validated before becoming current. */
export class CylinderDraft {
  private readonly prepared: {brep:string;net:Net}
  private readonly history = new SurfaceHistory()
  private result: {mesh:Mesh;step:string}
  constructor(private readonly kernel:OcctKernel, prepared:{brep:string;net:Net}, private readonly faceIndex:number) {
    this.prepared=structuredClone(prepared)
    this.result=evaluatePreparedCylinder(kernel,this.prepared,faceIndex,this.prepared.net)
    this.history.commit({net:this.prepared.net,locks:[],continuity:'G1',freeBoundary:false})
  }
  snapshot() {
    const frame=this.history.current!
    return {net:structuredClone(frame.net),locks:[...frame.locks],canUndo:this.history.canUndo,canRedo:this.history.canRedo,step:this.result.step}
  }
  setLocks(locks:number[]):void {
    const frame=this.history.current!
    if(locks.some(i=>!Number.isInteger(i)||i<0||i>=frame.net.poles.length)) throw new Error('Punto bloccato non valido.')
    this.history.commit({...frame,locks})
  }
  move(delta:Point):void {
    const frame=this.history.current!, affected=[2*frame.net.nv+2,3*frame.net.nv+2,4*frame.net.nv+2]
    if(affected.some(i=>frame.locks.includes(i))) throw new Error('Un punto necessario al movimento è bloccato.')
    const net=moveSmoothCylinderPole(frame.net,delta),result=evaluatePreparedCylinder(this.kernel,this.prepared,this.faceIndex,net)
    this.history.commit({...frame,net});this.result=result
  }
  step(delta:-1|1):boolean {
    const previous=this.history.current
    const frame=this.history.step(delta)
    if(!frame) return false
    if(frame.net===previous?.net) return true // Lock-only history does not change CAD geometry.
    try {this.result=evaluatePreparedCylinder(this.kernel,this.prepared,this.faceIndex,frame.net);return true}
    catch(error) {this.history.step(delta===-1?1:-1);throw error}
  }
}
