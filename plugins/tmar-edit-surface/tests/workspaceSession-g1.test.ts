// SPDX-License-Identifier: AGPL-3.0-only
// Controlled worker tests: session orchestration only, not native CAD/UI qualification.
import {afterEach,describe,expect,it,vi} from 'vitest'
import type {Net} from '../brep'
import type {G1PlaneResult,G1PublishedPlaneResult} from '../editorKernel'
import type {G1SupportCandidate} from '../g1SupportTopology'
import {proposePlaneTangency,validatePlaneTangencyResult,type PlaneTangencyRequest} from '../planeTangency'
import {SurfaceRuntime} from '../surfaceRuntime'
import {createWorkspaceSurfaceSession,type WorkspaceSurfaceSession} from '../workspaceSession'

type Message={id:number;action:string;net?:Net;constraintId?:number;selection?:unknown}
class ControlledWorker {
  onmessage:((event:MessageEvent<unknown>)=>void)|null=null
  onerror=null
  onmessageerror=null
  sent:Message[]=[]
  postMessage(message:Message){this.sent.push(message)}
  terminate=vi.fn()
  reply(result:unknown,id=this.sent.at(-1)!.id){this.onmessage?.({data:{id,result}} as MessageEvent<unknown>)}
  fail(error:string){this.onmessage?.({data:{id:this.sent.at(-1)!.id,error}} as MessageEvent<unknown>)}
}
const net=():Net=>{
  const poles:Net['poles']=[]
  for(let u=0;u<5;u++)for(let v=0;v<5;v++)poles.push([u,v,0])
  poles[7][2]=.25
  return {nu:5,nv:5,du:3,dv:3,poles,weights:poles.map(()=>1),rational:[0,0],ku:[0,.5,1],kv:[0,.5,1],mu:[4,1,4],mv:[4,1,4]}
}
const candidate:G1SupportCandidate={id:'support-1',stamp:{sourceId:'brep-sha256:'+'b'.repeat(64),sourceRevision:0,selectionRevision:1,faceIndex:0},
  supportFaceIndex:1,edgeIndex:0,side:'uMin',lengthMm:4,plane:{origin:[0,0,0],normal:[0,0,1]}}
const preview=(revision?:number)=>({valid:true,mesh:{} as G1PlaneResult['preview']['mesh'],faceMeshes:[{}] as G1PlaneResult['preview']['faceMeshes'],volume:0,maxBoundaryError:0,minimumNormalDot:1,...(revision===undefined?{}:{previewRevision:revision})})
const face={index:0,kind:'plane',reason:null,converted:true,enriched:false,openSheet:false,freeBoundary:false,trimLocks:[],hiddenPoles:[]}
const contexts:WorkspaceSurfaceSession[]=[]
async function flush(){for(let i=0;i<12;i++)await Promise.resolve()}
async function setup(){
  vi.useFakeTimers()
  const worker=new ControlledWorker(),runtime=new SurfaceRuntime(()=>worker as unknown as Worker),abort=new AbortController()
  let current=true
  const hash='a'.repeat(64),context={apiVersion:1,sessionId:'g1-session',source:{documentEpoch:'doc',sourceEpoch:1,bodyId:1,bodyKey:'body',buildVersion:1,kernelGeneration:1,frameRevision:1,stepSha256:hash,units:'mm',coordinateFrame:'part'},
    step:new Uint8Array([1,2,3]),capabilities:{apiVersion:1,enabled:true,commitKinds:['cad-copy']},signal:abort.signal,
    assertSourceCurrent:()=>{if(!current)throw Error('source changed')},own:(fn:()=>void)=>fn,reportFatal:vi.fn()}
  const creating=createWorkspaceSurfaceSession(context as never,(()=>({cancelGesture:()=>true,dispose:vi.fn()})) as never,{runtime,sha256:async()=>hash})
  await flush();worker.reply({faces:[face,{...face,index:1}],preview:{...preview(0),faceMeshes:[{},{}]}})
  const session=await creating;contexts.push(session)
  const choosing=session.chooseFace(0);worker.reply(net());await choosing
  await vi.advanceTimersByTimeAsync(90);expect(worker.sent.at(-1)?.action).toBe('evaluate');worker.reply(preview(1));await flush()
  session.setContinuity('G0')
  await vi.advanceTimersByTimeAsync(90)
  if(session.getSnapshot().validation.kind!=='valid'){worker.reply(preview(2));await flush()}
  expect(session.getSnapshot().validation.kind).toBe('valid')
  return {session,worker,invalidate:()=>{current=false}}
}
type Context=Awaited<ReturnType<typeof setup>>
function supportReplies(t:Context,plane:unknown){
  const planar=[...t.worker.sent].reverse().find(message=>message.action==='g1SupportCandidates')!
  const curved=[...t.worker.sent].reverse().find(message=>message.action==='g1CurvedSupportCandidates')!
  expect(planar).toBeDefined();expect(curved).toBeDefined()
  t.worker.reply(plane,planar.id)
  t.worker.reply({stamp:candidate.stamp,candidates:[]},curved.id)
}
async function load(t:Context){const pending=t.session.loadG1Supports();expect(t.worker.sent.some(message=>message.action==='g1SupportCandidates')).toBe(true);supportReplies(t,{stamp:candidate.stamp,candidates:[candidate]});await pending;t.session.chooseG1Support(candidate.id)}
function proposal(base:Net):G1PlaneResult{
  const request:PlaneTangencyRequest={net:base,edge:'U0',plane:{point:[0,0,0],normal:[0,0,1]},lockIndices:[],preserveTangentEdges:['U1','V0','V1'],distanceTolerance:1e-8}
  const out=proposePlaneTangency(request)
  return {net:out.net,changedIndices:out.changedIndices,choice:structuredClone(candidate),stamp:{...candidate.stamp},revisions:{edit:1,preview:1,anchorSelection:1},validation:validatePlaneTangencyResult(request,out.net),preview:preview()}
}
function published(result:G1PlaneResult,revision=3,current=result.net):G1PublishedPlaneResult{return {...result,net:structuredClone(current),constraintId:42,preview:{...preview(),previewRevision:revision}}}
async function apply(t:Context){
  await load(t)
  const out=proposal(t.session.getPanelState().net!)
  out.revisions.preview=t.session.getViewState().preview!.previewRevision!
  const pending=t.session.applyG1()
  expect(t.worker.sent.at(-1)?.action).toBe('proposeG1PlaneTangency')
  t.worker.reply(out);await flush();expect(t.worker.sent.at(-1)?.action).toBe('publishG1PlaneTangency')
  t.worker.reply(published(out));await pending;await flush()
  return out
}
afterEach(async()=>{for(const session of contexts.splice(0))await session.dispose('cancelled');vi.useRealTimers()})

describe('workspace session local planar G1 orchestration (controlled worker)',()=>{
  it('loads immutable candidates and requires explicit support selection',async()=>{
    const t=await setup()
    expect(t.session.getPanelState()).toMatchObject({canLoadG1:true,canApplyG1:false,g1Choice:null,g1Candidates:[]})
    const pending=t.session.loadG1Supports();expect(t.session.getPanelState().busy).toBe(true)
    supportReplies(t,{stamp:candidate.stamp,candidates:[candidate]});await pending
    const state=t.session.getPanelState()
    expect(state.g1Candidates).toEqual([candidate]);expect(state.g1Choice).toBeNull();expect(state.canApplyG1).toBe(false)
    const planar=state.g1Candidates[0]
    if(planar.kind==='compatible-bspline')throw Error('Expected planar fixture support')
    expect(Object.isFrozen(planar.plane.normal)).toBe(true)
    expect(()=>t.session.chooseG1Support('missing')).toThrow()
    t.session.chooseG1Support(candidate.id);expect(t.session.getPanelState().canApplyG1).toBe(true)
    expect(t.session.getPanelState().planeTangencyActive).toBe(false)
  })
  it('rejects a candidate stamp that does not match the selected face',async()=>{
    const t=await setup(),pending=t.session.loadG1Supports(),rejected=expect(pending).rejects.toThrow('Candidato G1 non verificabile.')
    supportReplies(t,{stamp:candidate.stamp,candidates:[{...candidate,stamp:{...candidate.stamp,faceIndex:1}}]})
    await rejected
    expect(t.session.getPanelState()).toMatchObject({busy:false,g1Candidates:[],g1Choice:null,canApplyG1:false})
  })
  it('discards a pending support response when the source becomes stale',async()=>{
    const t=await setup(),pending=t.session.loadG1Supports(),rejected=expect(pending).rejects.toThrow()
    t.invalidate();supportReplies(t,{stamp:candidate.stamp,candidates:[candidate]});await rejected
    expect(t.session.getPanelState().g1Candidates).toHaveLength(0)
    expect(t.session.getPanelState().canApplyG1).toBe(false)
  })
  it('invalidates a chosen support after a successful face change',async()=>{
    const t=await setup();await load(t)
    const pending=t.session.chooseFace(1,true);t.worker.reply(net());await pending
    expect(t.session.getPanelState()).toMatchObject({g1Candidates:[],g1Choice:null,canApplyG1:false,planeTangencyActive:false})
    expect(()=>t.session.chooseG1Support(candidate.id)).toThrow()
    await expect(t.session.applyG1()).rejects.toThrow()
  })
  it('publishes G1, restores it through undo/redo, and waits for its registered CAD witness',async()=>{
    const t=await setup(),before=structuredClone(t.session.getPanelState().net!),out=await apply(t)
    expect(t.session.getPanelState()).toMatchObject({planeTangencyActive:true,busy:false})
    expect(t.session.getPanelState().net!.poles[7][2]).toBe(0)
    expect(t.session.getSnapshot().validation.kind).toBe('valid')
    t.session.undo()
    expect(t.session.getPanelState().planeTangencyActive).toBe(false)
    expect(t.session.getPanelState().net).toEqual(before)
    expect(t.session.getSnapshot().validation.kind).not.toBe('valid')
    await vi.advanceTimersByTimeAsync(90);expect(t.worker.sent.at(-1)?.action).toBe('evaluate');t.worker.reply(preview(4));await flush()
    expect(t.session.getSnapshot().validation.kind).toBe('valid')
    t.session.redo()
    expect(t.session.getPanelState().planeTangencyActive).toBe(true)
    expect(t.session.getPanelState().net).toEqual(out.net)
    expect(t.session.getSnapshot().validation.kind).not.toBe('valid')
    await vi.advanceTimersByTimeAsync(90)
    expect(t.worker.sent.at(-1)).toMatchObject({action:'evaluateG1PlaneTangency',constraintId:42})
    t.worker.reply(published(out,5));await flush()
    expect(t.session.getSnapshot().validation.kind).toBe('valid')
  })
  it('preserves the draft when the G1 worker refuses the proposal',async()=>{
    const t=await setup();await load(t)
    const before=structuredClone(t.session.getPanelState().net),pending=t.session.applyG1(),rejected=expect(pending).rejects.toThrow('support refused')
    t.worker.fail('support refused');await rejected
    expect(t.session.getPanelState().net).toEqual(before)
    expect(t.session.getPanelState()).toMatchObject({planeTangencyActive:false,busy:false})
    expect(t.worker.sent.some(m=>m.action==='publishG1PlaneTangency')).toBe(false)
  })
})
