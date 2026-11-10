// SPDX-License-Identifier: AGPL-3.0-only
// Experimental HOST contract only. occt-wasm 5.7.1 has no native sewing history
// export; do not fabricate it with face hashes, indices or sampled matches.
// No caller may publish a CAD edit on the strength of this structural screen.
export interface NativeSewingFaceRelationV1 {
  readonly inputFace: number
  readonly outputFace: number | null
  readonly relation: 'unchanged' | 'modified' | 'deleted' | 'unresolved'
}

export interface NativeSewingTraceV1 {
  readonly schema: 'tmar.native-sewing-lineage'
  readonly version: 1
  /** Raw result immediately after sewing; healing/unification is a new stage. */
  readonly stage: 'post-sew-pre-heal'
  readonly provenance: 'BRepBuilderAPI_Sewing/ModifiedSubShape'
  readonly inputFaceCount: number
  readonly outputFaceCount: number
  readonly relations: readonly NativeSewingFaceRelationV1[]
}

export type SewingLineageScreen =
  | {
      readonly status: 'structural-only'
      /** Ephemeral face ordinals within this one native sewing operation. */
      readonly byInputFace: ReadonlyMap<number, number>
      readonly changedInputs: readonly number[]
      readonly protectedInputs: readonly number[]
    }
  | {readonly status: 'refused'; readonly reason: string}

const goodIndex=(value:unknown,upper:number):value is number=>
  Number.isSafeInteger(value) && typeof value==='number' && value>=0 && value<upper

/** Explicitly distinguish the current wrapper's missing capability from a
 *  successful native history. No TS-only substitute is enabled. */
export function supportsNativeSewingLineage(kernel: unknown):boolean {
  return !!kernel && typeof kernel==='object' &&
    typeof (kernel as {sewWithNativeHistory?:unknown}).sewWithNativeHistory==='function'
}

/**
 * Structural preflight on a trace that a future native C++/WASM binding must
 * produce inside the SAME sewing call. This is NOT proof that native data
 * is authentic, that BREP geometry is unchanged, or that pcurves match.
 *
 * V1 is deliberately strict: all faces must map one-to-one. Any split, merge,
 * deleted/unresolved neighbor, duplicate or unmapped result refuses the edit.
 */
export function screenNativeSewingLineage(
  trace:NativeSewingTraceV1,
  editedFace:number,
  protectedFaces:readonly number[],
):SewingLineageScreen {
  const refuse=(reason:string):SewingLineageScreen=>({status:'refused',reason})
  if(!trace || trace.schema!=='tmar.native-sewing-lineage' || trace.version!==1 ||
      trace.stage!=='post-sew-pre-heal' ||
      trace.provenance!=='BRepBuilderAPI_Sewing/ModifiedSubShape')
    return refuse('Provenienza/stadio di sewing nativo non qualificato.')
  const n=trace.inputFaceCount,m=trace.outputFaceCount
  if(!Number.isSafeInteger(n)||!Number.isSafeInteger(m)||n<1||m<1||n>10000||m>10000)
    return refuse('Dimensioni topologiche del sewing non valide.')
  if(n!==m)return refuse('Divisione o fusione di facce non supportata dal contratto v1.')
  if(!goodIndex(editedFace,n))return refuse('Faccia modificata non valida.')
  if(!Array.isArray(protectedFaces)||protectedFaces.length!==n-1 ||
      new Set(protectedFaces).size!==protectedFaces.length ||
      protectedFaces.some(f=>!goodIndex(f,n)||f===editedFace))
    return refuse('Elenco completo delle facce protette non valido.')
  if(!Array.isArray(trace.relations)||trace.relations.length!==n)
    return refuse('Relazioni native delle facce incomplete.')
  const seenIn=new Set<number>(),seenOut=new Set<number>()
  const mapped=new Map<number,number>(),changed:number[]=[]
  for(const item of trace.relations) {
    if(!item||!goodIndex(item.inputFace,n)||seenIn.has(item.inputFace))
      return refuse('Faccia sorgente nativa assente o duplicata.')
    seenIn.add(item.inputFace)
    if(item.relation!=='unchanged' && item.relation!=='modified')
      return refuse('Faccia rimossa, non associabile o con storia sconosciuta.')
    if(!goodIndex(item.outputFace,m) || seenOut.has(item.outputFace))
      return refuse('Faccia risultato non valida, mancante o ambigua.')
    seenOut.add(item.outputFace)
    mapped.set(item.inputFace,item.outputFace)
    if(item.relation==='modified')changed.push(item.inputFace)
  }
  if(seenIn.size!==n||seenOut.size!==m)
    return refuse('Sewing con facce di risultato non attribuite.')
  return {status:'structural-only',byInputFace:mapped,
    changedInputs:changed,protectedInputs:[...protectedFaces]}
}
