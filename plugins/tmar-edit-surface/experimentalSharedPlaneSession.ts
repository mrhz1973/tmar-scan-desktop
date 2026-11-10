// SPDX-License-Identifier: AGPL-3.0-only
// Session fence for the experimental stateless worker actions; not UI-integrated.
import type { Net } from './brep'
import type { Mesh } from 'occt-wasm'
import type { ExperimentalSharedPlaneIdentity } from './editor.worker'
import type { SurfaceWorkerClient } from './workerClient'

type Prepared={net:Net;identity:ExperimentalSharedPlaneIdentity}
export class ExperimentalSharedPlaneSession {
  private generation=0
  private closed=false
  private readonly abort=new AbortController()
  private source:{step:string;face:number;identity:ExperimentalSharedPlaneIdentity}|null=null
  constructor(private readonly worker:SurfaceWorkerClient) {}

  async prepare(step:string,face:number):Promise<Net> {
    if(this.closed) throw new Error('Sessione chiusa.')
    const generation=++this.generation
    this.source=null
    let result:Prepared
    try {result=await this.worker.ask<Prepared>({action:'prepareSharedPlaneExperimental',step,face},this.abort.signal)}
    catch(error) {if(this.closed || generation!==this.generation) throw new Error('Preparazione superata.');throw error}
    if(this.closed || generation!==this.generation) throw new Error('Preparazione superata.')
    if(!result?.identity || result.identity.face!==face || result.identity.version!==1 || !result.net)
      throw new Error('Preparazione non verificabile.')
    this.source={step,face,identity:structuredClone(result.identity)}
    return structuredClone(result.net)
  }

  async evaluate(net:Net,includeMesh=false):Promise<{step:string;volume:number;mesh?:Mesh;faceMeshes?:Mesh[];previewFace?:number}> {
    if(this.closed || !this.source) throw new Error('Prepara prima la faccia.')
    const generation=++this.generation, source=this.source
    let result:{step:string;volume:number;mesh?:Mesh;faceMeshes?:Mesh[];previewFace?:number}
    try {result=await this.worker.ask<typeof result>({action:'evaluateSharedPlaneExperimental',
      step:source.step,face:source.face,identity:source.identity,net:structuredClone(net),includeMesh},this.abort.signal)}
    catch(error) {if(this.closed || generation!==this.generation || this.source!==source) throw new Error('Risultato superato.');throw error}
    if(this.closed || generation!==this.generation || this.source!==source) throw new Error('Risultato superato.')
    if(typeof result?.step!=='string' || !result.step || !Number.isFinite(result.volume) || result.volume<=0)
      throw new Error('Risultato CAD non verificabile.')
    if(includeMesh && (!result.mesh || !Array.isArray(result.faceMeshes) || !result.faceMeshes.length ||
      !Number.isInteger(result.previewFace) || result.previewFace!<0 || result.previewFace!>=result.faceMeshes.length))
      throw new Error('Anteprima CAD non disponibile.')
    return result
  }

  dispose():void {if(this.closed)return;this.closed=true;this.source=null;this.generation++;this.abort.abort()}
}
