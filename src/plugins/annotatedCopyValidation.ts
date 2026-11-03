// SPDX-License-Identifier: AGPL-3.0-only
import type { AnnotatedTicketV1, PreparedAnnotatedCopyV1 } from './annotatedCopyTypes'
import { editorSha256 } from './editorLifetime'
const vec=(x:unknown,n:number):x is number[]=>Array.isArray(x)&&x.length===n&&x.every(y=>typeof y==='number'&&Number.isFinite(y))
const stable=(x:unknown):string=>{
  if(x===null||typeof x!=='object')return JSON.stringify(x)
  if(Array.isArray(x))return '['+x.map(stable).join(',')+']'
  return '{'+Object.entries(x).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+stable(v)).join(',')+'}'
}
export async function validateAnnotatedCopy(raw:PreparedAnnotatedCopyV1,ticket:AnnotatedTicketV1) {
  if(!raw||raw.kind!=='annotated-cad-copy'||raw.annotationVersion!==1||raw.operationId!==ticket.operationId||
    raw.units!=='mm'||raw.coordinateFrame!=='part'||raw.notesRevision!==ticket.notesRevision||
    stable(raw.source)!==stable(ticket.source)||stable(raw.stamp)!==stable(ticket.stamp)||
    !(raw.step instanceof Uint8Array)||!raw.step.byteLength||raw.step.byteLength>128_000_000||
    typeof raw.name!=='string'||!raw.name.trim()||raw.name.length>240||
    !Array.isArray(raw.witnesses)||raw.witnesses.length!==1||!Array.isArray(raw.notes)||!raw.notes.length||raw.notes.length>200)
    throw Error('Pacchetto annotato non coerente con la bozza congelata.')
  // Own ALL payload fields before awaiting digest or staging.
  const prepared=structuredClone(raw),w=prepared.witnesses[0],ids=new Set<string>()
  if(w.kind!=='occt-face-brep'||typeof w.key!=='string'||!w.key||typeof w.brep!=='string'||!w.brep||w.brep.length>16_000_000||
     !Number.isSafeInteger(w.diagnosticFaceIndex)||w.diagnosticFaceIndex<0||stable(w.stamp)!==stable(ticket.stamp))throw Error('Testimone della faccia non valido.')
  for(const note of prepared.notes){
    const t=note.target
    if(typeof note.draftId!=='string'||!note.draftId||ids.has(note.draftId)||typeof note.text!=='string'||!note.text.trim()||note.text.length>100_000||
       (note.done!==undefined&&typeof note.done!=='boolean')||(note.reply!==undefined&&(typeof note.reply!=='string'||note.reply.length>100_000))||
       !t||t.kind!=='copy-face'||t.witnessKey!==w.key||!vec(t.sourceUV,2)||!vec(t.resolvedAt,3)||!vec(t.orientedNormal,3)||
       Math.abs(Math.hypot(...t.orientedNormal)-1)>1e-6||stable(t.resolvedStamp)!==stable(ticket.stamp))throw Error('Una nota non è risolta sulla faccia finale: nessuna nota verrà scartata implicitamente.')
    ids.add(note.draftId)
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(prepared.step)
  const encoded = new TextEncoder().encode(text)
  if (encoded.length !== prepared.step.length || encoded.some((byte, i) => byte !== prepared.step[i]))
    throw Error('Lo STEP annotato deve essere UTF-8 senza BOM: i byte salvati devono coincidere con quelli verificati.')
  const artifactSha256=await editorSha256(prepared.step)
  const witnessSha256=await editorSha256(new TextEncoder().encode(w.brep))
  if(w.finalStepSha256!==artifactSha256||w.brepSha256!==witnessSha256)throw Error('Hash STEP/testimone non corrispondente al pacchetto.')
  const envelopeSha256=await editorSha256(new TextEncoder().encode(stable({...prepared,step:artifactSha256})))
  return {prepared,artifactSha256,witnessSha256,envelopeSha256}
}
