// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { SurfaceEditorKernel } from '../editorKernel'
import { prepareCylinder } from '../cylinderPreparation'
import { moveSmoothCylinderPole } from '../periodic'
import { CylinderPreviewSession } from '../cylinderPreviewSession'
import type { SurfaceWorkerPayload } from '../workerClient'

it('never accepts a delayed validation for a different candidate or closed session',async()=>{
  const editor=await SurfaceEditorKernel.load(),k=editor.kernel,primitive=k.makeCylinder(10,20)
  const source=k.importStep(k.exportStep(primitive)),faces=k.getSubShapes(source,'face')
  try {
    const index=faces.findIndex(f=>k.surfaceType(f)==='cylinder'),prepared=prepareCylinder(k,source,index)
    const pending:Array<{resolve:(value:unknown)=>void;reject:(reason:Error)=>void}>=[]
    const call=<T>(request:SurfaceWorkerPayload):Promise<T>=>{
      if(request.action==='evaluateCylinder')return new Promise((resolve,reject)=>pending.push({resolve:resolve as (value:unknown)=>void,reject}))
      return Promise.resolve({kind:'provisional',mesh:{}} as T)
    }
    const session=new CylinderPreviewSession(call,prepared,index)
    const first=moveSmoothCylinderPole(prepared.net,[.2,0,0]),second=moveSmoothCylinderPole(prepared.net,[.3,0,0])
    session.setCandidate(first)
    const old=session.validate()
    session.setCandidate(second)
    pending.shift()!.resolve({step:'OLD',mesh:{}})
    expect(await old).toBeNull();expect(session.getValidated()).toBeNull()
    const fresh=session.validate()
    pending.shift()!.resolve({step:'NEW',mesh:{}})
    expect((await fresh)?.step).toBe('NEW');expect(session.getValidated()?.step).toBe('NEW')
    const obsoleteError=session.validate();session.setCandidate(first)
    pending.shift()!.reject(new Error('obsolete'))
    expect(await obsoleteError).toBeNull()
    const late=session.validate();expect(session.getValidated()).toBeNull()
    session.dispose();pending.shift()!.resolve({step:'LATE',mesh:{}})
    expect(await late).toBeNull();expect(session.getValidated()).toBeNull()
  } finally {faces.forEach(f=>k.release(f));k.release(source);k.release(primitive);editor.dispose()}
},60000)
