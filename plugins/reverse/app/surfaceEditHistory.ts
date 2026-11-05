// SPDX-License-Identifier: AGPL-3.0-only
// Host-owned, opt-in history envelope. Never infer CAD validity from JSON or SHA alone.
// The ordinary import/copy remains authoritative until independent recipe replay passes.
import { abortIfNeeded, editorSha256 } from '../../../src/plugins/editorLifetime'
import type { SourceBinding } from '../../../src/plugins/workspaceEditorTypes'
import { stepFileKey, type ImportFeature, type StepFileRef } from '../core/features'

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
  readonly notePolicy: 'none'
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

export interface SurfaceHistorySource {
  readonly binding: SourceBinding
  readonly step: Uint8Array
  assertCurrent(): void
}

export interface QualifySurfaceHistory {
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
export function readStoredSurfaceHistory(value: unknown): StoredSurfaceEditHistoryV1 {
  const raw: unknown = structuredClone(value)
  if (!object(raw) || !hasKeys(raw, ['schema','version','source','recipe','recipeSha256','resultStepSha256','replayStepSha256','notePolicy']) ||
      raw.schema !== 'tmar.host.surface-edit-history' || raw.version !== 1 || raw.notePolicy !== 'none' ||
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
      ![2,3,4,5,6].includes(recipe.version as number) ||
      recipe.engine !== 'occt-wasm-5.7.1/brep-v3' ||
      recipe.units !== 'mm' || recipe.coordinateFrame !== 'imported-step' ||
      !object(recipe.source) || recipe.source.bodyId !== source.bodyKey ||
      !validHash(recipe.source.brepSha256))
    throw new Error('Ricetta CAD incompatibile con il corpo sorgente.')
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
  const record = readStoredSurfaceHistory(draftRecord)
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
  | {status:'verified';record:StoredSurfaceEditHistoryV1;replayedStep:string}

/** Fail closed: never change or discard the saved imported CAD copy on error. */
export async function reopenSurfaceHistory(
  feature: ImportFeature, stepFiles:Readonly<Record<string,string>>,
  replay:SurfaceHistoryReplay | undefined, signal:AbortSignal,
):Promise<SurfaceHistoryReopen> {
  if (feature.surfaceEditHistory === undefined) return {status:'copy-only',reason:'Nessuna ricetta associata.'}
  try {
    abortIfNeeded(signal)
    const record=readStoredSurfaceHistory(feature.surfaceEditHistory)
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
    if (feature.annotationSource) throw new Error('Note annotate: re-ancoraggio parametrico non ancora qualificato.')
    const step=await replay(sourceText,structuredClone(record.recipe),record.source.bodyKey,signal)
    abortIfNeeded(signal);assertStep(step)
    if (await editorSha256(utf8(canonicalReplayStep(step)))!==record.replayStepSha256)
      throw new Error('Replay differente dalla copia CAD salvata.')
    return {status:'verified',record,replayedStep:step}
  }catch(error){
    return {status:'copy-only',reason:error instanceof Error?error.message:String(error)}
  }
}
