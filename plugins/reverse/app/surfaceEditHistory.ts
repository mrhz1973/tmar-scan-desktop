// SPDX-License-Identifier: AGPL-3.0-only
// Host-owned, opt-in history envelope. Never infer CAD validity from JSON or SHA alone.
// The ordinary import/copy remains authoritative until independent recipe replay passes.
import { abortIfNeeded, editorSha256 } from '../../../src/plugins/editorLifetime'
import type { SourceBinding } from '../../../src/plugins/workspaceEditorTypes'
import type { validateAnnotatedCopy } from '../../../src/plugins/annotatedCopyValidation'
import type { Note } from '../core/notes'
import { stepFileKey, type ImportFeature, type StepFileRef } from '../core/features'
import { assertHostAdaptiveLockedRecipeV8 } from './surfaceEditHistoryV8'

/** Immutable plugin UV association; the host's normal Note store remains authoritative
 * for note text, deletion and actual validated face attachments after Apply. */
export interface StoredSurfaceHistoryNote {
  readonly id: string
  readonly text: string
  readonly faceIndex: number
  readonly u: number
  readonly v: number
}
export interface StoredSurfaceHistoryAnnotationV1 {
  readonly version: 1
  readonly featureUuid: string
  readonly envelopeSha256: string
  readonly witnessSha256: string
  readonly noteDigestSha256: string
  readonly notes: readonly StoredSurfaceHistoryNote[]
}
export interface StoredSurfaceEditHistoryV1 {
  readonly schema: 'tmar.host.surface-edit-history'
  readonly version: 1
  readonly source: {
    readonly bodyId: number
    readonly bodyKey: string
    readonly file: StepFileRef
    readonly stepSha256: string
    readonly sourceReplaySha256: string
  }
  readonly recipe: unknown
  readonly recipeSha256: string
  readonly resultStepSha256: string
  /** Stable replay fingerprint: only known Open CASCADE export label serials are normalized. */
  readonly replayStepSha256: string
  readonly notePolicy: 'none' | 'annotated-v1'
  readonly annotation?: StoredSurfaceHistoryAnnotationV1
}

export interface QualifiedSurfaceHistory {
  readonly record: StoredSurfaceEditHistoryV1
  /** Exact source STEP, preserved separately from the edited result. */
  readonly sourceStep: string
}

export interface PluginHistoryPreparation {
  readonly recipe: unknown
  readonly sessionId: string
  readonly sourceKey: string
  readonly selectionEpoch: number
  readonly draftEpoch: number
}

/** Must use an independent CAD kernel / worker and reject unsupported v2-v6 versions. */
export type SurfaceHistoryReplay = (
  sourceStep: string, recipe: unknown, sourceBodyKey: string, signal: AbortSignal
) => Promise<string>

/** Optional plugin replay callback injected at the feature boundary.
 * The host remains independent from the named Edit Surface plugin. */
export type PluginIndependentReplay = (
  source: {readonly bodyKey:string;readonly stepSha256:string;
    readonly step:Uint8Array;assertCurrent():void},
  recipe: unknown, signal?: AbortSignal,
) => Promise<{valid:boolean;step:string}>
export function bindIndependentPluginReplay(
  replay:PluginIndependentReplay,assertCurrent:()=>void,
):SurfaceHistoryReplay {
  return async (sourceStep,recipe,sourceBodyKey,signal) => {
    abortIfNeeded(signal);assertCurrent()
    assertStep(sourceStep)
    const bytes=utf8(sourceStep)
    const stepSha256=await editorSha256(bytes)
    abortIfNeeded(signal);assertCurrent()
    const result=await replay({bodyKey:sourceBodyKey,stepSha256,
      step:bytes.slice(),assertCurrent},structuredClone(recipe),signal)
    abortIfNeeded(signal);assertCurrent()
    if (!result || result.valid!==true || typeof result.step!=='string')
      throw new Error('Il replay OCCT indipendente non ha fornito un CAD valido.')
    assertStep(result.step)
    return result.step
  }
}

export interface SurfaceHistorySource {
  readonly binding: SourceBinding
  readonly step: Uint8Array
  assertCurrent(): void
}

export interface PluginAnnotatedHistoryPreparation extends PluginHistoryPreparation {
  readonly notesRevision: number
  readonly notes: readonly StoredSurfaceHistoryNote[]
}
export type ValidatedAnnotatedHistoryCopy = Awaited<ReturnType<typeof validateAnnotatedCopy>>
export interface QualifyAnnotatedSurfaceHistory extends Omit<QualifySurfaceHistory, 'prepared' | 'noteCount'> {
  readonly prepared: PluginAnnotatedHistoryPreparation
  /** Result of the existing host validateAnnotatedCopy, NOT untrusted plugin metadata. */
  readonly annotationPlan: ValidatedAnnotatedHistoryCopy
}

/** Must be opted into by a host QA caller. No UI production call supplies this capability. */
export interface ExperimentalSurfaceHistoryOptions {
  readonly experimentalAdaptiveV8?: true
}
export interface QualifySurfaceHistory extends ExperimentalSurfaceHistoryOptions {
  readonly source: SurfaceHistorySource
  readonly prepared: PluginHistoryPreparation
  /** Plugin's current draft/selection/preview gate, checked around every await. */
  isStampCurrent(): boolean
  /** Final frozen/validated export against which independent replay is compared. */
  readonly resultStep: Uint8Array
  readonly noteCount: number
  readonly replay: SurfaceHistoryReplay
  readonly signal: AbortSignal
}

// A result must come from the replay-qualified path, not from copied JSON.
const qualifiedTokens = new WeakSet<object>()
const verifiedHistoryTokens = new WeakSet<object>()
const frozenHistoryTokens = new WeakMap<object, HistoryFreezeLease>()

/** The plugin owns the controller and its synchronous edit lock. A host
 * transaction keeps this lease through all asynchronous CAD operations and
 * checks isCurrent at the synchronous mutation boundary. */
export interface HistoryFreezeLease {
  isCurrent(): boolean
  release(): void
}
export interface HistoryFreezeOwner<P extends PluginHistoryPreparation> {
  freezeHistory(prepared:P): HistoryFreezeLease
}
export function assertFrozenHistoryCurrent(qualified:QualifiedSurfaceHistory):void {
  const lease=frozenHistoryTokens.get(qualified)
  if (!lease || !lease.isCurrent()) throw new Error('Freeze Edit Surface non attivo o scaduto: nessuna pubblicazione.')
}
export async function withFrozenHistoryTransaction<P extends PluginHistoryPreparation,R>(
  owner:HistoryFreezeOwner<P>, prepared:P,
  operation:(gate:{
    assertCurrent():void
    bindQualified<T extends QualifiedSurfaceHistory>(qualified:T):T
  })=>Promise<R>,
):Promise<R> {
  const lease=owner.freezeHistory(prepared)
  const assertCurrent=()=>{
    if (!lease.isCurrent()) throw new Error('Freeze Edit Surface revocato o non corrente.')
  }
  try {
    assertCurrent()
    return await operation({
      assertCurrent,
      bindQualified:<T extends QualifiedSurfaceHistory>(qualified:T):T=>{
        assertCurrent()
        if (!qualifiedTokens.has(qualified)) throw new Error('Ricetta non qualificata dal replay host.')
        frozenHistoryTokens.set(qualified,lease)
        return qualified
      },
    })
  } finally {
    // This also runs when staging, replay, note validation or publication fails.
    lease.release()
  }
}
export function claimQualifiedSurfaceHistory(input: QualifiedSurfaceHistory): QualifiedSurfaceHistory {
  if (!input || typeof input !== 'object' || !qualifiedTokens.delete(input))
    throw new Error('History payload senza replay indipendente verificato.')
  return input
}

function freezeHistoryValue<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    for (const child of Object.values(value)) freezeHistoryValue(child)
  }
  return value
}

const HEX = /^[a-f0-9]{64}$/
const RECORD_MAX_BYTES = 1_000_000
const STEP_MAX_BYTES = 128_000_000
const validHash = (x: unknown): x is string => typeof x === 'string' && HEX.test(x)
/** Exclude ONLY the volatile OCCT translator PRODUCT label serial, never CAD geometry.
 * Other STEP text changes (coordinates, edges, units, entities) remain significant. */
export function canonicalReplayStep(step: string): string {
  assertStep(step)
  const pattern=/'Open CASCADE STEP translator 8\.0 [0-9]+'/g
  const matches=[...step.matchAll(pattern)].map(x=>x[0])
  if (matches.length!==2 || matches[0]!==matches[1]) return step
  const dates=/(FILE_NAME\('Open CASCADE Shape Model',')\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(')/g
  const dateHits=[...step.matchAll(dates)]
  if (dateHits.length!==1) return step
  return step.replace(pattern, "'Open CASCADE STEP translator 8.0 [serial]'")
    .replace(dates, "$1[export-time]$2")
}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const hasKeys = (o: Record<string, unknown>, expected: readonly string[]) =>
  Object.keys(o).length === expected.length && expected.every(k => Object.prototype.hasOwnProperty.call(o, k))
const utf8 = (text: string) => new TextEncoder().encode(text)
const text = (bytes: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(bytes)
const stepLike = (value: string): boolean => /^\s*ISO-10303-21\s*;/i.test(value.slice(0, 256))
const assertStep = (s: string) => {
  if (typeof s !== 'string' || !stepLike(s) || utf8(s).byteLength > STEP_MAX_BYTES)
    throw new Error('STEP del contratto parametrico mancante, troppo grande o non valido.')
}

/** Hashable, sorted JSON. This is corruption detection, NOT an authenticated signature. */
export function canonicalHistoryJson(value: unknown): string {
  const seen = new WeakSet<object>()
  const canon = (v: unknown, depth: number): unknown => {
    if (depth > 40) throw new Error('Profondità della ricetta oltre il limite.')
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v !== 'object' || v === null) throw new Error('La ricetta deve essere JSON puro.')
    if (seen.has(v)) throw new Error('La ricetta contiene riferimenti ciclici.')
    seen.add(v)
    try {
      if (Array.isArray(v)) {
        if (v.length > 16_000) throw new Error('Ricetta troppo estesa.')
        return v.map(item => canon(item, depth + 1))
      }
      const names = Object.keys(v)
      if (names.length > 256) throw new Error('Ricetta troppo estesa.')
      const result: Record<string, unknown> = Object.create(null)
      for (const key of names.sort()) result[key] = canon((v as Record<string, unknown>)[key], depth + 1)
      return result
    } finally { seen.delete(v) }
  }
  const serialized = JSON.stringify(canon(value, 0))
  if (!serialized || utf8(serialized).byteLength > RECORD_MAX_BYTES)
    throw new Error('Ricetta vuota o oltre il limite di 1 MB.')
  return serialized
}

/** Host schema and source binding only. The recipe still MUST pass CAD replay. */
export function readStoredSurfaceHistory(value: unknown, options: ExperimentalSurfaceHistoryOptions = {}): StoredSurfaceEditHistoryV1 {
  const raw: unknown = structuredClone(value)
  if (!object(raw) || !['none','annotated-v1'].includes(raw.notePolicy as string) ||
      !hasKeys(raw, raw.notePolicy === 'none'
        ? ['schema','version','source','recipe','recipeSha256','resultStepSha256','replayStepSha256','notePolicy']
        : ['schema','version','source','recipe','recipeSha256','resultStepSha256','replayStepSha256','notePolicy','annotation']) ||
      raw.schema !== 'tmar.host.surface-edit-history' || raw.version !== 1 ||
      !validHash(raw.recipeSha256) || !validHash(raw.resultStepSha256) || !validHash(raw.replayStepSha256) ||
      !object(raw.source) || !hasKeys(raw.source,['bodyId','bodyKey','file','stepSha256','sourceReplaySha256']))
    throw new Error('Metadati history Edit Surface non supportati.')
  const source = raw.source
  // Body IDs are positive finite numbers, including 1 + n/1024 islands;
  // feature/face/index/revision IDs elsewhere remain integers.
  if (!Number.isFinite(source.bodyId) || (source.bodyId as number) <= 0 ||
      typeof source.bodyKey !== 'string' || !source.bodyKey.trim() || source.bodyKey.length > 1024 ||
      !validHash(source.stepSha256) || !validHash(source.sourceReplaySha256) || !object(source.file) ||
      !hasKeys(source.file, ['key','name','size']) ||
      typeof source.file.key !== 'string' || !/^[a-z0-9]+-[a-z0-9]+$/.test(source.file.key) ||
      typeof source.file.name !== 'string' || !source.file.name.trim() || source.file.name.length > 255 ||
      !Number.isSafeInteger(source.file.size) || (source.file.size as number) <= 0 ||
      (source.file.size as number) > STEP_MAX_BYTES)
    throw new Error('Sorgente STEP della ricetta non valida.')
  const recipe=raw.recipe
  if (!object(recipe) || recipe.schema !== 'tmar.surface-edit' ||
      (![2,3,4,5,6].includes(recipe.version as number) &&
         !(recipe.version === 8 && options.experimentalAdaptiveV8 === true)) ||
      recipe.engine !== 'occt-wasm-5.7.1/brep-v3' ||
      recipe.units !== 'mm' || recipe.coordinateFrame !== 'imported-step' ||
      !object(recipe.source) || recipe.source.bodyId !== source.bodyKey ||
      !validHash(recipe.source.brepSha256))
    throw new Error('Ricetta CAD incompatibile con il corpo sorgente.')
  if (recipe.version === 8) assertHostAdaptiveLockedRecipeV8(recipe)
  if (raw.notePolicy === 'annotated-v1') {
    const ann=raw.annotation
    if (!object(ann) || !hasKeys(ann,['version','featureUuid','envelopeSha256','witnessSha256','noteDigestSha256','notes']) ||
        ann.version!==1 || typeof ann.featureUuid!=='string' ||
        !/^[a-f0-9-]{36}$/i.test(ann.featureUuid) ||
        !validHash(ann.envelopeSha256) || !validHash(ann.witnessSha256) ||
        !validHash(ann.noteDigestSha256) ||
        !Array.isArray(ann.notes) || ann.notes.length<1 || ann.notes.length>200)
      throw new Error('Associazione history e note non valida.')
    const notes=ann.notes as unknown[]
    const ids=new Set<string>()
    for(const item of notes) {
      if (!object(item) || !hasKeys(item,['id','text','faceIndex','u','v']) ||
          typeof item.id!=='string' || !item.id.trim() || item.id.length>200 ||
          ids.has(item.id) || typeof item.text!=='string' ||
          !item.text.trim() || item.text.length>2000 ||
          item.faceIndex!==recipe.faceIndex ||
          typeof item.u!=='number' || !Number.isFinite(item.u) ||
          typeof item.v!=='number' || !Number.isFinite(item.v))
        throw new Error('Ancora UV della history non valida.')
      ids.add(item.id)
    }
  }
  // The digest check is asynchronous, in the qualification/reopen paths.
  canonicalHistoryJson(recipe)
  return raw as unknown as StoredSurfaceEditHistoryV1
}

export async function qualifySurfaceHistory(input: QualifySurfaceHistory): Promise<QualifiedSurfaceHistory> {
  const { source, prepared, signal } = input
  const current = () => {
    abortIfNeeded(signal)
    source.assertCurrent()
    if (!input.isStampCurrent()) throw new Error('La sessione o la bozza della ricetta non è più corrente.')
  }
  current()
  if (input.noteCount !== 0) throw new Error('La persistenza parametrica delle note non è ancora qualificata.')
  if (!(source.step instanceof Uint8Array) || !(input.resultStep instanceof Uint8Array) ||
      source.step.byteLength > STEP_MAX_BYTES || input.resultStep.byteLength > STEP_MAX_BYTES)
    throw new Error('STEP troppo grande o non disponibile.')
  if (!prepared || typeof prepared.sessionId !== 'string' || !prepared.sessionId.trim() ||
      typeof prepared.sourceKey !== 'string' || !prepared.sourceKey.trim() ||
      !Number.isSafeInteger(prepared.selectionEpoch) || !Number.isSafeInteger(prepared.draftEpoch))
    throw new Error('Identità della preparazione parametrica incompleta.')
  const b=source.binding
  const requiredSourceKey=JSON.stringify([b.documentEpoch,b.sourceEpoch,b.bodyId,b.bodyKey,
    b.buildVersion,b.kernelGeneration,b.frameRevision,b.stepSha256,b.units,b.coordinateFrame])
  if (prepared.sourceKey !== requiredSourceKey)
    throw new Error('Identità sorgente del plugin differente.')
  const original = text(source.step), result = text(input.resultStep)
  assertStep(original); assertStep(result)
  const sourceHash = await editorSha256(source.step)
  current()
  if (sourceHash !== source.binding.stepSha256)
    throw new Error('Impronta della sorgente STEP differente.')
  const copyRecipe = JSON.parse(canonicalHistoryJson(prepared.recipe)) as unknown
  const draftRecord = {
    schema: 'tmar.host.surface-edit-history' as const, version: 1 as const,
    source: { bodyId: source.binding.bodyId, bodyKey: source.binding.bodyKey,
      file: { key:stepFileKey(original), name:`surface-edit-source-${source.binding.bodyId}.step`,size:original.length },
      stepSha256:sourceHash, sourceReplaySha256:await editorSha256(utf8(canonicalReplayStep(original))) },
    recipe:copyRecipe,
    recipeSha256:await editorSha256(utf8(canonicalHistoryJson(copyRecipe))),
    resultStepSha256:await editorSha256(input.resultStep),
    replayStepSha256:await editorSha256(utf8(canonicalReplayStep(result))),
    notePolicy:'none' as const,
  }
  current()
  const record = readStoredSurfaceHistory(draftRecord, input)
  // Replay is not a hash or a preview flag: the injected provider MUST use
  // an independently validated CAD engine and reject unsupported recipes.
  const replayed = await input.replay(original, structuredClone(record.recipe), record.source.bodyKey, signal)
  current()
  assertStep(replayed)
  if (await editorSha256(utf8(canonicalReplayStep(replayed))) !== record.replayStepSha256) {
    throw new Error('Il replay parametrico non coincide con il CAD finale congelato.')
  }
  current()
  const qualified: QualifiedSurfaceHistory = Object.freeze({record:freezeHistoryValue(record),sourceStep:original})
  qualifiedTokens.add(qualified)
  return qualified
}

export type SurfaceHistoryReopen =
  | {status:'copy-only';reason:string}
  | {status:'verified';record:StoredSurfaceEditHistoryV1;replayedStep:string;sourceStep:string;
      /** Only a verified, unchanged host note store may be passed to plugin restoreHistoryNotes. */
      notesToRestore?:readonly StoredSurfaceHistoryNote[]}

/** Fail closed: never change or discard the saved imported CAD copy on error. */
export async function reopenSurfaceHistory(
  feature: ImportFeature, stepFiles:Readonly<Record<string,string>>,
  replay:SurfaceHistoryReplay | undefined, signal:AbortSignal,
  persistedNotes?:readonly Note[],
  options:ExperimentalSurfaceHistoryOptions = {},
):Promise<SurfaceHistoryReopen> {
  if (feature.surfaceEditHistory === undefined) return {status:'copy-only',reason:'Nessuna ricetta associata.'}
  try {
    abortIfNeeded(signal)
    const record=readStoredSurfaceHistory(feature.surfaceEditHistory,options)
    const sourceText=stepFiles[record.source.file.key], outputText=stepFiles[feature.file.key]
    if (sourceText===undefined || outputText===undefined) throw new Error('Archivio sorgente o CAD salvato mancante.')
    assertStep(sourceText);assertStep(outputText)
    if (stepFileKey(sourceText)!==record.source.file.key ||
        record.source.file.size!==sourceText.length ||
        await editorSha256(utf8(sourceText))!==record.source.stepSha256 ||
        await editorSha256(utf8(canonicalReplayStep(sourceText)))!==record.source.sourceReplaySha256)
      throw new Error('STEP sorgente differente o corrotto.')
    if (await editorSha256(utf8(outputText))!==record.resultStepSha256 ||
        await editorSha256(utf8(canonicalReplayStep(outputText)))!==record.replayStepSha256)
      throw new Error('Copia CAD salvata differente.')
    if (await editorSha256(utf8(canonicalHistoryJson(record.recipe)))!==record.recipeSha256)
      throw new Error('Ricetta salvata alterata.')
    abortIfNeeded(signal)
    if (!replay) throw new Error('Replay CAD indipendente non collegato: copia preservata.')
    if (record.notePolicy==='annotated-v1') {
      if (!record.annotation || await associationDigest(record)!==record.annotation.noteDigestSha256)
        throw new Error('Associazione ricetta/annotazione alterata.')
    } else if (feature.annotationSource) throw new Error('Copia annotata senza associazione parametrica.')
    const step=await replay(sourceText,structuredClone(record.recipe),record.source.bodyKey,signal)
    abortIfNeeded(signal);assertStep(step)
    if (await editorSha256(utf8(canonicalReplayStep(step)))!==record.replayStepSha256)
      throw new Error('Replay differente dalla copia CAD salvata.')
    const notesToRestore=record.notePolicy==='annotated-v1'
      ? persistedHistoryNotes(record,feature,persistedNotes) : undefined
    const verified=Object.freeze({status:'verified' as const,record:freezeHistoryValue(record),
      sourceStep:sourceText,replayedStep:step,
      ...(notesToRestore?{notesToRestore:freezeHistoryValue(notesToRestore)}:{})})
    verifiedHistoryTokens.add(verified)
    return verified
  }catch(error){
    return {status:'copy-only',reason:error instanceof Error?error.message:String(error)}
  }
}


/** The versioned, host-owned link binds notes to a recipe, the OCCT face
 * witness and the annotated-copy envelope. It is inert until a provider
 * independently replays and restores both CAD and notes in a new session. */
const associationContent = (record: StoredSurfaceEditHistoryV1,
  link: Omit<StoredSurfaceHistoryAnnotationV1,'noteDigestSha256'>) =>
  ({recipeSha256:record.recipeSha256, sourceStepSha256:record.source.stepSha256,
    resultStepSha256:record.resultStepSha256,featureUuid:link.featureUuid,
    envelopeSha256:link.envelopeSha256,witnessSha256:link.witnessSha256,notes:link.notes})

const associationDigest = async (record: StoredSurfaceEditHistoryV1): Promise<string> => {
  if (!record.annotation) throw new Error('Bundle di note history assente.')
  const {noteDigestSha256:_digest,...rest} = record.annotation
  return editorSha256(utf8(canonicalHistoryJson(associationContent(record,rest))))
}

/** Host must use validateAnnotatedCopy before passing a plan here. Its result
 * verifies STEP bytes + note witness. The recipe still requires independent
 * replay, while note UVs must match the immutable, frozen annotated payload. */
export async function qualifyAnnotatedSurfaceHistory(input: QualifyAnnotatedSurfaceHistory): Promise<QualifiedSurfaceHistory> {
  const {prepared,annotationPlan:plan,signal}=input
  abortIfNeeded(signal)
  input.source.assertCurrent()
  if (!input.isStampCurrent() || !prepared || !Number.isSafeInteger(prepared.notesRevision) ||
      !Array.isArray(prepared.notes) || !prepared.notes.length || prepared.notes.length>200)
    throw new Error('Le note o la ricetta non sono più correnti.')
  const recipe = prepared.recipe as {faceIndex?:unknown}
  const witness=plan?.prepared?.witnesses?.[0]
  if (!witness || !Number.isSafeInteger(witness.diagnosticFaceIndex) ||
      witness.diagnosticFaceIndex !== recipe?.faceIndex ||
      plan.prepared.notes.length !== prepared.notes.length ||
      !validHash(plan.artifactSha256) || !validHash(plan.witnessSha256) ||
      !validHash(plan.envelopeSha256))
    throw new Error('Testimone CAD o note non associabili alla ricetta.')
  const seen=new Set<string>()
  const preparedById=new Map<string,StoredSurfaceHistoryNote>()
  for(const note of prepared.notes) {
    if (!note || typeof note.id!=='string' || !note.id.trim() || seen.has(note.id) ||
        typeof note.text!=='string' || !note.text.trim() ||
        note.faceIndex!==recipe.faceIndex || !Number.isFinite(note.u) || !Number.isFinite(note.v))
      throw new Error('Ancora UV parametrica non valida.')
    seen.add(note.id)
    preparedById.set(note.id,{id:note.id,text:note.text,faceIndex:note.faceIndex,u:note.u,v:note.v})
  }
  for(const note of plan.prepared.notes){
    const match=preparedById.get(note.draftId)
    if (!match || note.text!==match.text ||
        note.target.sourceUV[0]!==match.u || note.target.sourceUV[1]!==match.v)
      throw new Error('Le note del ticket annotato non coincidono con la ricetta.')
  }
  const replayChecked=await qualifySurfaceHistory({
    source:input.source,prepared,isStampCurrent:input.isStampCurrent,
    resultStep:input.resultStep,noteCount:0,replay:input.replay,signal,
    experimentalAdaptiveV8:input.experimentalAdaptiveV8,
  })
  claimQualifiedSurfaceHistory(replayChecked) // never leave a second usable token
  if (plan.artifactSha256!==replayChecked.record.resultStepSha256 ||
      !input.isStampCurrent()) throw new Error('CAD o note modificati prima della qualificazione.')
  const notes=[...preparedById.values()]
  const baseLink={version:1 as const,featureUuid:crypto.randomUUID(),
    envelopeSha256:plan.envelopeSha256,witnessSha256:plan.witnessSha256,notes}
  const draft={...replayChecked.record,notePolicy:'annotated-v1' as const,
    annotation:{...baseLink,noteDigestSha256:''}}
  const digest=await editorSha256(utf8(canonicalHistoryJson(associationContent(draft,baseLink))))
  input.source.assertCurrent()
  if (!input.isStampCurrent()) throw new Error('Note o sorgente mutate dopo replay CAD.')
  const record=readStoredSurfaceHistory({...draft,annotation:{...baseLink,noteDigestSha256:digest}},input)
  const qualified:QualifiedSurfaceHistory=Object.freeze({
    record:freezeHistoryValue(record),sourceStep:replayChecked.sourceStep,
  })
  qualifiedTokens.add(qualified)
  return qualified
}

/** Validate the exact note payload that the host would stage with this recipe.
 * No edit is committed here; this check precedes an ordinary candidate CAD
 * stage, which remains the only transaction publisher. */
export async function verifyAnnotatedHistoryPlan(
  record:StoredSurfaceEditHistoryV1,plan:ValidatedAnnotatedHistoryCopy,
):Promise<void> {
  if (record.notePolicy!=='annotated-v1' || !record.annotation)
    throw new Error('History annotata assente.')
  const ann=record.annotation
  if (!plan || plan.artifactSha256!==record.resultStepSha256 ||
      plan.envelopeSha256!==ann.envelopeSha256 || plan.witnessSha256!==ann.witnessSha256 ||
      plan.prepared.witnesses.length!==1 ||
      plan.prepared.witnesses[0].diagnosticFaceIndex!==(record.recipe as {faceIndex:number}).faceIndex ||
      plan.prepared.notes.length!==ann.notes.length)
    throw new Error('Ticket annotato estraneo alla ricetta.')
  const refs=new Map(ann.notes.map(n=>[n.id,n]))
  for(const n of plan.prepared.notes){
    const match=refs.get(n.draftId)
    if (!match || match.text!==n.text || match.u!==n.target.sourceUV[0] || match.v!==n.target.sourceUV[1])
      throw new Error('Ancora di nota estranea alla ricetta.')
  }
  if (await associationDigest(record)!==ann.noteDigestSha256)
    throw new Error('Associazione history-note modificata.')
}

export function persistedHistoryNotes(record:StoredSurfaceEditHistoryV1,feature:ImportFeature,
  saved:readonly Note[]|undefined):readonly StoredSurfaceHistoryNote[] {
  const ann=record.annotation
  if (!ann || !saved || !feature.annotationSource ||
      feature.annotationSource.featureUuid!==ann.featureUuid ||
      feature.annotationSource.witnessSha256!==ann.witnessSha256)
    throw new Error('Associazione nota/feature non ripristinabile.')
  const result:StoredSurfaceHistoryNote[]=[]
  const unique=new Set<string>()
  for(const expected of ann.notes) {
    const matches=saved.filter(n=>n.attachment?.draftId===expected.id &&
      n.attachment.featureUuid===ann.featureUuid)
    if (matches.length!==1) throw new Error('Nota di history mancante o duplicata.')
    const note=matches[0],attached=note.attachment!
    if (attached.status!=='verified'|| !attached.noteUuid || unique.has(attached.noteUuid) ||
        attached.witnessSha256!==ann.witnessSha256 ||
        attached.witnessUV[0]!==expected.u || attached.witnessUV[1]!==expected.v ||
        !note.on.some(t=>t.kind==='face'&&t.body===feature.id) ||
        !note.text.trim())
      throw new Error('Ancora history/UV non verificata.')
    unique.add(attached.noteUuid)
    // Text is mutable through the normal Note UI; do not resurrect deleted
    // notes or revert legitimate edits to the original recipe snapshot.
    result.push({id:expected.id,text:note.text,faceIndex:expected.faceIndex,u:expected.u,v:expected.v})
  }
  return result
}


/** A freshly opened editor must be supplied by a host factory using the
 * archived upstream STEP, not the already-edited result body. This adapter
 * is opt-in and never installs a controller in the live UI by itself. */
export interface SurfaceHistoryRestoreController {
  /** Plugin f338d34+: restores a full bundle in a NEW controller, waits for
   * independent valid CAD preview and either rebinding all notes or closing
   * itself on a post-adoption failure. Older split restores are insufficient. */
  restoreHistoryBundle(bundle:{readonly recipe:unknown;readonly notes:unknown},signal?:AbortSignal):Promise<void>
  getSnapshot():{validation:{kind:string}}
  getPanelState():{notes:readonly {id:string;text:string}[]}
  dispose(reason:'host-error'|'cancelled'):Promise<void>
}

/** Replay authentication is held by an ephemeral, one-use token returned
 * from reopenSurfaceHistory. No caller-supplied "verified" JSON is accepted.
 * The host's actual session handoff must still coordinate viewport leases
 * and validate the document and source before installing this controller. */
export async function restoreVerifiedSurfaceHistory<T extends SurfaceHistoryRestoreController>(
  checked:Extract<SurfaceHistoryReopen,{status:'verified'}>,
  makeFreshSession:(source:Uint8Array,bodyKey:string,signal:AbortSignal)=>Promise<T>,
  awaitValidated:(session:T,signal:AbortSignal)=>Promise<void>,
  assertCurrent:()=>void,
  signal:AbortSignal,
):Promise<T> {
  if (!checked || checked.status!=='verified' || !verifiedHistoryTokens.delete(checked))
    throw new Error('Ripristino Edit Surface non verificato o già utilizzato.')
  if (checked.record.notePolicy==='annotated-v1' && !checked.notesToRestore?.length)
    throw new Error('Ripristino parametrico bloccato: mancano note con UV verificati.')
  let session:T|undefined
  const alive=()=>{abortIfNeeded(signal);assertCurrent()}
  try {
    alive()
    session=await makeFreshSession(utf8(checked.sourceStep),checked.record.source.bodyKey,signal)
    alive()
    const expectedNotes=checked.notesToRestore ?? []
    if (checked.record.notePolicy==='none' && expectedNotes.length)
      throw new Error('Note estranee alla ricetta non annotata.')
    // One plugin operation owns recipe adoption, the awaited CAD preview and
    // all-or-nothing UV rebinding. Host never installs a half-restored session.
    await session.restoreHistoryBundle({
      recipe:structuredClone(checked.record.recipe),notes:structuredClone(expectedNotes),
    },signal)
    alive()
    await awaitValidated(session,signal)
    alive()
    if (session.getSnapshot().validation.kind!=='valid')
      throw new Error('Il CAD ripristinato non dispone di una preview validata.')
    const liveNotes=session.getPanelState().notes
    if (liveNotes.length!==expectedNotes.length ||
        expectedNotes.some(expected=>!liveNotes.some(n=>n.id===expected.id && n.text===expected.text)))
      throw new Error('Le note della nuova sessione non coincidono con quelle verificate.')
    return session
  } catch(error) {
    if(session)try{await session.dispose('host-error')}catch{/* Preserve the original failure. */}
    throw error
  }
}


/** A complete, opt-in entrypoint for reopening an archived Edit Surface recipe.
 * The feature remains an ordinary CAD import until the host explicitly
 * installs a successful NEW controller. On every failure the saved STEP
 * and authoritative note store remain untouched and copy-only is returned. */
export type OpenedEditableSurfaceHistory<T extends SurfaceHistoryRestoreController> =
  | {readonly status:'copy-only';readonly reason:string}
  | {readonly status:'restored';readonly session:T;readonly record:StoredSurfaceEditHistoryV1}

export async function reopenAndRestoreSurfaceHistory<T extends SurfaceHistoryRestoreController>(
  feature:ImportFeature,
  savedFiles:Readonly<Record<string,string>>,
  savedNotes:readonly Note[]|undefined,
  replay:SurfaceHistoryReplay|undefined,
  makeFreshSession:(source:Uint8Array,bodyKey:string,signal:AbortSignal)=>Promise<T>,
  awaitValidated:(session:T,signal:AbortSignal)=>Promise<void>,
  assertCurrent:()=>void,
  signal:AbortSignal,
  options:ExperimentalSurfaceHistoryOptions = {},
):Promise<OpenedEditableSurfaceHistory<T>> {
  try {
    abortIfNeeded(signal);assertCurrent()
    const checked=await reopenSurfaceHistory(feature,savedFiles,replay,signal,savedNotes,options)
    abortIfNeeded(signal);assertCurrent()
    if (checked.status==='copy-only') return checked
    const session=await restoreVerifiedSurfaceHistory(checked,makeFreshSession,
      awaitValidated,assertCurrent,signal)
    // The caller decides when and whether to install the isolated controller
    // in the viewport. This function does not mutate project state.
    return {status:'restored',session,record:checked.record}
  }catch(error) {
    return {status:'copy-only',reason:error instanceof Error?error.message:String(error)}
  }
}
