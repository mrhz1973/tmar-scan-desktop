// SPDX-License-Identifier: AGPL-3.0-only
// Research-only wiring; the real host must supply lifecycle/source revision checks.
import type { Net } from './brep'
import type { ExperimentalSharedPlaneSession } from './experimentalSharedPlaneSession'
import type { WorkspacePreview } from './workspacePreview'
import { PreviewQueue } from './previewQueue'

export class ExperimentalSharedPlanePreview {
  private generation=0
  private closed=false
  private ready=false
  private readonly queue:PreviewQueue<Net,Awaited<ReturnType<ExperimentalSharedPlaneSession['evaluate']>>>
  private presented=0
  private presentationFailure:unknown=null
  constructor(private readonly session:ExperimentalSharedPlaneSession,private readonly preview:WorkspacePreview) {
    this.queue=new PreviewQueue({evaluate:net=>this.session.evaluate(net,true)})
    this.queue.subscribe(()=>this.presentQueued())
  }

  getSnapshot = () => this.queue.getSnapshot()
  subscribe = (listener:()=>void) => this.queue.subscribe(listener)
  /** CAD validity and successful presentation are separate conditions. */
  get displayedRevision():number {return this.presented}
  get displayError():unknown {return this.presentationFailure}

  /** Interactive input: a running calculation finishes, only the latest waits. */
  schedule(net:Net):number {
    if(this.closed || !this.ready) throw new Error('Prepara prima la faccia.')
    this.generation++
    this.presentationFailure=null
    return this.queue.schedule(structuredClone(net))!
  }

  private presentQueued():void {
    if(this.closed || !this.ready)return
    const state=this.queue.getSnapshot(), result=state.preview
    if(state.error && state.error.revision===state.current?.revision) {
      this.presented=0
      try {this.preview.setVisible(false)} catch (error) {this.presentationFailure=error}
      return
    }
    if(!result || result.stale || state.validRevision!==result.revision || result.revision===this.presented)return
    try {
      if(!result.value.faceMeshes || result.value.previewFace===undefined) throw new Error('Anteprima non verificabile.')
      this.preview.setPreview({faceMeshes:result.value.faceMeshes},result.value.previewFace)
      this.preview.setVisible(true);this.presented=result.revision;this.presentationFailure=null
    } catch (error) {
      this.presented=0
      this.presentationFailure=error
      try {this.preview.setVisible(false)} catch (cleanup) {this.presentationFailure=new AggregateError([error,cleanup],'Anteprima e ripristino non riusciti.')}
    }
  }

  async prepare(step:string,face:number):Promise<Net> {
    if(this.closed) throw new Error('Anteprima chiusa.')
    const generation=++this.generation
    this.ready=false
    this.presented=0
    this.presentationFailure=null
    this.queue.invalidate({clearPreview:true})
    this.preview.clear()
    const net=await this.session.prepare(step,face)
    if(this.closed || generation!==this.generation) throw new Error('Preparazione superata.')
    this.ready=true
    return net
  }

  async update(net:Net):Promise<void> {
    if(this.closed || !this.ready) throw new Error('Prepara prima la faccia.')
    this.queue.invalidate({clearPreview:true})
    this.presented=0
    const generation=++this.generation
    let result:Awaited<ReturnType<ExperimentalSharedPlaneSession['evaluate']>>
    try {result=await this.session.evaluate(net,true)}
    catch(error) {
      if(!this.closed && generation===this.generation) throw this.hideAfterFailure(error)
      throw error
    }
    if(this.closed || generation!==this.generation) throw new Error('Anteprima superata.')
    try {
      if(!result.faceMeshes || result.previewFace===undefined) throw new Error('Anteprima non verificabile.')
      this.preview.setPreview({faceMeshes:result.faceMeshes},result.previewFace)
      this.preview.setVisible(true)
      this.presentationFailure=null
    } catch(error) {
      throw this.hideAfterFailure(error)
    }
  }

  private hideAfterFailure(error:unknown):unknown {
    this.presented=0
    this.presentationFailure=error
    try {this.preview.setVisible(false)} catch (cleanup) {
      this.presentationFailure=new AggregateError([error,cleanup],'Anteprima e ripristino non riusciti.')
    }
    return this.presentationFailure
  }

  dispose():void {
    if(this.closed) {this.preview.dispose();return}
    this.closed=true;this.ready=false;this.generation++;this.presented=0;this.presentationFailure=null
    const failures:unknown[]=[]
    try {this.queue.dispose()} catch(error) {failures.push(error)}
    try {this.session.dispose()} catch(error) {failures.push(error)}
    try {this.preview.dispose()} catch(error) {failures.push(error)}
    if(failures.length) throw new AggregateError(failures,'Chiusura anteprima non completa.')
  }
}
