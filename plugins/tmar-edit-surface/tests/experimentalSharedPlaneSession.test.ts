// SPDX-License-Identifier: AGPL-3.0-only
import {expect,it} from 'vitest'
import type {Net} from '../brep'
import type {SurfaceWorkerClient,SurfaceWorkerPayload} from '../workerClient'
import {ExperimentalSharedPlaneSession} from '../experimentalSharedPlaneSession'

const net:Net={nu:2,nv:2,du:1,dv:1,poles:[[0,0,0],[0,1,0],[1,0,0],[1,1,0]],weights:[1,1,1,1],rational:[0,0],ku:[0,1],kv:[0,1],mu:[2,2],mv:[2,2]}
const identity=(face:number)=>({version:1 as const,face,sourceHash:'a'.repeat(64),baseHash:'b'.repeat(64)})
function fixture(){
  const requests:{payload:SurfaceWorkerPayload;resolve:(v:unknown)=>void;reject:(e:Error)=>void}[]=[]
  const worker={ask:(payload:SurfaceWorkerPayload,signal?:AbortSignal)=>new Promise((resolve,reject)=>{
    requests.push({payload,resolve,reject});signal?.addEventListener('abort',()=>reject(new Error('aborted')),{once:true})
  })} as unknown as SurfaceWorkerClient
  return {requests,session:new ExperimentalSharedPlaneSession(worker)}
}
it('discards replies from an old face, old edit and a closed session',async()=>{
  const {requests,session}=fixture()
  const old=session.prepare('old',0),oldRejected=expect(old).rejects.toThrow(/superata/)
  const fresh=session.prepare('new',1)
  requests[1].resolve({net,identity:identity(1)});const initial=await fresh
  requests[0].resolve({net,identity:identity(0)});await oldRejected
  initial.poles[0][0]=99
  const first=session.evaluate(net),firstRejected=expect(first).rejects.toThrow(/superato/)
  const second=session.evaluate(net)
  expect(requests[2].payload).toMatchObject({action:'evaluateSharedPlaneExperimental',step:'new',face:1,identity:identity(1)})
  requests[3].resolve({step:'STEP new',volume:1});await expect(second).resolves.toEqual({step:'STEP new',volume:1})
  requests[2].resolve({step:'STEP old',volume:1});await firstRejected
  const last=session.evaluate(net),lastRejected=expect(last).rejects.toThrow(/superato/)
  session.dispose();await lastRejected;requests[4].resolve({step:'late',volume:1})
  await expect(session.evaluate(net)).rejects.toThrow(/prepara/i)
})

it('marks an obsolete worker error as superseded',async()=>{
  const {requests,session}=fixture()
  const old=session.prepare('old',0),oldRejected=expect(old).rejects.toThrow(/superata/)
  const fresh=session.prepare('new',1)
  requests[0].reject(new Error('old worker failure'));await oldRejected
  requests[1].resolve({net,identity:identity(1)});await fresh
  const first=session.evaluate(net),firstRejected=expect(first).rejects.toThrow(/superato/)
  const second=session.evaluate(net)
  requests[2].reject(new Error('old evaluation failure'));await firstRejected
  requests[3].resolve({step:'valid',volume:1});await second
  session.dispose()
})
