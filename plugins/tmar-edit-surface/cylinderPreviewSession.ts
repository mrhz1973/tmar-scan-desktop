// SPDX-License-Identifier: AGPL-3.0-only
import type { Mesh } from 'occt-wasm'
import type { Net } from './brep'
import { assertSmoothCylinderMove } from './periodic'
import { PreviewQueue } from './previewQueue'
import type { SurfaceWorkerPayload } from './workerClient'

type WorkerCall = <T>(payload:SurfaceWorkerPayload)=>Promise<T>
type Provisional = {kind:'provisional';mesh:Mesh;faceMeshes:Mesh[]}
type Validated = {mesh:Mesh;step:string}

/** Experimental session adapter: a preview is never an Apply authorization.
 * Validation output is delivered only if its candidate remains current. */
export class CylinderPreviewSession {
  private readonly base:Net
  private readonly queue:PreviewQueue<Net,Provisional>
  private revision=0
  private current:Net|null=null
  private validated:{revision:number;value:Validated}|null=null
  private disposed=false
  private validationAttempt=0
  private readonly listeners=new Set<()=>void>()
  private readonly unsubscribe:()=>void

  constructor(private readonly call:WorkerCall, base:Net, private readonly session:number) {
    this.base=structuredClone(base)
    this.queue=new PreviewQueue({evaluate:net=>call<Provisional>({action:'previewCylinder',session:this.session,net})})
    this.unsubscribe=this.queue.subscribe(()=>this.emit())
  }
  subscribe(listener:()=>void):()=>void {if(this.disposed)return ()=>{};this.listeners.add(listener);return ()=>{this.listeners.delete(listener)}}
  getPreview() {return this.queue.getSnapshot().preview}
  /** Null means no current candidate has passed the full CAD evaluation. */
  getValidated():Validated|null {return this.validated?.revision===this.revision ? structuredClone(this.validated.value) : null}
  setCandidate(net:Net):void {
    if(this.disposed) throw new Error('Editor chiuso.')
    assertSmoothCylinderMove(this.base,net)
    this.current=structuredClone(net);this.revision++;this.validationAttempt++;this.validated=null
    this.queue.schedule(this.current)
  }
  async validate():Promise<Validated|null> {
    if(this.disposed || !this.current) throw new Error('Scegli una modifica cilindrica.')
    const revision=this.revision,net=this.current,attempt=++this.validationAttempt
    this.validated=null;this.emit()
    let value:Validated
    try {value=await this.call<Validated>({action:'evaluateCylinder',session:this.session,net})}
    catch(error) {
      if(this.disposed || revision!==this.revision || net!==this.current || attempt!==this.validationAttempt) return null
      throw error
    }
    if(this.disposed || revision!==this.revision || net!==this.current || attempt!==this.validationAttempt) return null
    this.validated={revision,value:structuredClone(value)}
    this.emit()
    return structuredClone(value)
  }
  dispose():void {
    if(this.disposed)return
    this.disposed=true;this.revision++;this.validationAttempt++;this.current=null;this.validated=null
    this.unsubscribe();this.queue.dispose();this.listeners.clear()
  }
  private emit():void {for(const listener of this.listeners) listener()}
}
