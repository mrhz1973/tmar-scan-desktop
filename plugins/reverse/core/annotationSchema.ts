// SPDX-License-Identifier: AGPL-3.0-only
import type { Note } from './notes'
import type { ImportFeature } from './features'
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const digest=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{64}$/i.test(v)
const short=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=512
export function validateAnnotationSource(value:unknown):asserts value is NonNullable<ImportFeature['annotationSource']> {
  const v=value as NonNullable<ImportFeature['annotationSource']>
  if(!v||v.version!==1||!uuid(v.featureUuid)||!digest(v.stepSha256)||!digest(v.witnessSha256)||typeof v.faceBrep!=='string'||!v.faceBrep||v.faceBrep.length>16_000_000)
    throw Error('Malformed project: annotated CAD source.')
}
export function validateAttachment(value:unknown):asserts value is NonNullable<Note['attachment']> {
  const v=value as NonNullable<Note['attachment']>
  if(!v||v.version!==1||!uuid(v.noteUuid)||!uuid(v.featureUuid)||!short(v.operationId)||!short(v.draftId)||!digest(v.stepSha256)||!digest(v.witnessSha256)||
     !Array.isArray(v.witnessUV)||v.witnessUV.length!==2||!v.witnessUV.every(Number.isFinite)||
     !Array.isArray(v.uv)||v.uv.length!==2||!v.uv.every(Number.isFinite)||!['verified','unresolved'].includes(v.status))
    throw Error('Malformed project: annotated note attachment.')
}
