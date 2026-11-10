// SPDX-License-Identifier: AGPL-3.0-only
import type { HistoryDelta } from '../../../src/state/historyStore'
import type { PreparedAnnotatedCopyV1 } from '../../../src/plugins/annotatedCopyTypes'
import type { Note } from '../core/notes'
import type { FaceFingerprint } from '../core/topo'
import type { VerifiedCopyFace } from '../core/kernelAnnotatedNotes'
import { useNotes } from '../state/noteStore'
import { useReverse } from '../state/reStore'

export function annotationNoteDelta(input:{prepared:PreparedAnnotatedCopyV1;verified:VerifiedCopyFace;face:FaceFingerprint;bodyId:number;featureUuid:string;documentEpoch:string;stepSha256:string;witnessSha256:string}) {
  const {prepared,bodyId,featureUuid,documentEpoch}=input
  let currentBefore=useNotes.getState(),latest:Note[]=[],owned=new Set<string>(),published=false
  const isOwned=(n:Note|undefined)=>!!n?.attachment&&owned.has(n.attachment.noteUuid)
  const assertDocument=()=>{if(useReverse.getState().documentEpoch!==documentEpoch)throw Error('Documento diverso nella cronologia annotata.')}
  const delta:HistoryDelta & {capturePublication():void; publish():void; receipt():{draftId:string;noteUuid:string;displayId:number}[]}={
    capturePublication(){ assertDocument(); currentBefore=useNotes.getState() },
    publish(){
      assertDocument();if(published)throw Error('Note già pubblicate.')
      currentBefore=useNotes.getState()
      let id=Math.max(currentBefore.nextId,...currentBefore.notes.map(n=>n.id+1),1)
      latest=prepared.notes.map(note=>{
        const resolved=input.verified.notes.find(n=>n.draftId===note.draftId)
        if(!resolved)throw Error('Ancora annotata mancante.')
        const noteUuid=crypto.randomUUID();owned.add(noteUuid)
        return {id:id++,text:note.text,...(note.done!==undefined?{done:note.done}:{}),...(note.reply!==undefined?{reply:note.reply}:{}),
          at:resolved.at,normal:resolved.normal,on:[{kind:'face',body:bodyId,face:input.face}],
          attachment:{version:1,noteUuid,operationId:prepared.operationId,draftId:note.draftId,featureUuid,
            stepSha256:input.stepSha256,witnessSha256:input.witnessSha256,witnessUV:[...note.target.sourceUV],uv:resolved.uv,status:'verified'}} as Note
      })
      useNotes.setState({notes:[...currentBefore.notes,...latest],nextId:id,localNotesVisible:true,pinsShown:true})
      published=true
    },
    receipt:()=>latest.map(n=>({draftId:n.attachment!.draftId,noteUuid:n.attachment!.noteUuid,displayId:n.id})),
    preflight(redo){
      assertDocument();currentBefore=useNotes.getState()
      if(!redo){
        if(currentBefore.notes.some(n=>!isOwned(n)&&n.on.some(t=>'body'in t&&t.body===bodyId)))
          throw Error('Annullamento rifiutato: altre note dipendono dalla copia CAD.')
        // Explicitly deleted owned notes are absent and MUST NOT reappear on Redo.
        latest=currentBefore.notes.filter(isOwned).map(n=>structuredClone(n))
      }else{
        if(latest.some(n=>currentBefore.notes.some(x=>x.id===n.id||x.attachment?.noteUuid===n.attachment?.noteUuid)))
          throw Error('Ripetizione rifiutata: identità della nota già utilizzata.')
      }
    },
    apply(redo){
      const state=useNotes.getState()
      if(state!==currentBefore)throw Error('Le note sono cambiate durante il ripristino.')
      // The restored feature graph rebuilds asynchronously; advertise that before observers run.
      useReverse.setState({building:true})
      useNotes.setState({notes:redo?[...state.notes,...latest]:state.notes.filter(n=>!isOwned(n)),
        nextId:Math.max(state.nextId,...latest.map(n=>n.id+1),1),editing:state.editing&&isOwned(state.notes.find(n=>n.id===state.editing!.id))?null:state.editing})
    },
    rollback(){useNotes.setState(currentBefore,true)},
  }
  return delta
}
