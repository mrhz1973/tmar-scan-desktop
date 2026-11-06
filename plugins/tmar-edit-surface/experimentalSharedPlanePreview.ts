// SPDX-License-Identifier: AGPL-3.0-only
// Research-only wiring; the real host must supply lifecycle/source revision checks.
import type { Net } from './brep'
import type { ExperimentalSharedPlaneSession } from './experimentalSharedPlaneSession'
import type { WorkspacePreview } from './workspacePreview'

export class ExperimentalSharedPlanePreview {
  private generation=0
  private closed=false
  private ready=false
  constructor(private readonly session:ExperimentalSharedPlaneSession,private readonly preview:WorkspacePreview) {}

  async prepare(step:string,face:number):Promise<Net> {
    if(this.closed) throw new Error('Anteprima chiusa.')
    const generation=++this.generation
    this.ready=false
    this.preview.clear()
    const net=await this.session.prepare(step,face)
    if(this.closed || generation!==this.generation) throw new Error('Preparazione superata.')
    this.ready=true
    return net
  }

  async update(net:Net):Promise<void> {
    if(this.closed || !this.ready) throw new Error('Prepara prima la faccia.')
    const generation=++this.generation
    let result:Awaited<ReturnType<ExperimentalSharedPlaneSession['evaluate']>>
    try {result=await this.session.evaluate(net,true)}
    catch(error) {
      if(!this.closed && generation===this.generation) try {this.preview.setVisible(false)} catch { /* Preserve the CAD failure. */ }
      throw error
    }
    if(this.closed || generation!==this.generation) throw new Error('Anteprima superata.')
    try {
      if(!result.faceMeshes || result.previewFace===undefined) throw new Error('Anteprima non verificabile.')
      this.preview.setPreview({faceMeshes:result.faceMeshes},result.previewFace)
      this.preview.setVisible(true)
    } catch(error) {
      try {this.preview.setVisible(false)} catch { /* Preserve the display failure. */ }
      throw error
    }
  }

  dispose():void {
    if(this.closed) {this.preview.dispose();return}
    this.closed=true;this.ready=false;this.generation++
    try {this.session.dispose()} finally {this.preview.dispose()}
  }
}
