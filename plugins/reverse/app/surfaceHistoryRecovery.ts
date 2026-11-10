// SPDX-License-Identifier: AGPL-3.0-only
// HOST-only, opt-in archive recovery. Does not install an editor in the UI,
// register a procedural feature or change the Edit Surface plugin contract.
import { useShell } from '../../../src/state/shellStore'
import { useStore } from '../../../src/state/store'
import { useReverse } from '../state/reStore'
import { useNotes } from '../state/noteStore'
import { editorSha256 } from '../../../src/plugins/editorLifetime'
import {
  readStoredSurfaceHistory, reopenAndRestoreSurfaceHistory,
  canonicalReplayStep, canonicalHistoryJson,
  type StoredSurfaceEditHistoryV1, type SurfaceHistoryReplay,
  type SurfaceHistoryRestoreController, type SurfaceHistorySource,
} from './surfaceEditHistory'

/** Host capability created only after archive replay and live-result agreement. */
export interface ArchivedSurfaceHistorySource {
  readonly record: StoredSurfaceEditHistoryV1
  readonly resultBodyId: number
  assertCurrent(): void
}
const archiveSources = new WeakMap<object, Readonly<{ source: string; resultBodyId: number; replayStepSha256: string }>>()
export function assertArchivedSurfaceHistorySource(source: ArchivedSurfaceHistorySource,
  next: StoredSurfaceEditHistoryV1): Readonly<{ resultBodyId: number; replayStepSha256: string }> {
  const expected = archiveSources.get(source)
  if (!expected || canonicalHistoryJson(source.record.source) !== expected.source ||
      canonicalHistoryJson(next.source) !== expected.source || source.resultBodyId !== expected.resultBodyId ||
      source.record.replayStepSha256 !== expected.replayStepSha256)
    throw new Error('Provenienza archiviata non verificata per questa sorgente.')
  source.assertCurrent()
  return expected
}

export interface HostHistoryRecoveryRequest<T extends SurfaceHistoryRestoreController> {
  /** ID of an active archived ImportFeature, not a body-list index. */
  readonly featureId: number
  readonly replay: SurfaceHistoryReplay | undefined
  /** Must create a NEW session against the exact archived upstream STEP. */
  readonly makeFreshSession: (step: Uint8Array, bodyKey: string, signal: AbortSignal) => Promise<T>
  readonly awaitValidated: (session: T, signal: AbortSignal) => Promise<void>
  readonly signal: AbortSignal
  /** Optional caller-owned lease; never replaces host source/document fencing. */
  readonly assertCurrent?: () => void
  /** Native current result, independently read under the host body lease. */
  readonly currentResult?: SurfaceHistorySource
}

export type HostHistoryRecovery<T extends SurfaceHistoryRestoreController> =
  | { readonly status: 'copy-only'; readonly reason: string }
  | {
      /** Validated off-screen session, NOT installed in the user viewport. */
      readonly status: 'ready'
      readonly session: T
      readonly record: StoredSurfaceEditHistoryV1
      readonly archiveSource?: ArchivedSurfaceHistorySource
      /** Recheck immediately before a future host-owned viewport handoff. */
      readonly assertCurrent: () => void
      /** Always dispose if no owner adopts the session. Idempotent. */
      readonly release: () => Promise<void>
      /** Transfer disposal to the workspace session, exactly once. */
      readonly adopt: () => void
    }

const copyOnly = (reason: string): HostHistoryRecovery<never> => ({ status: 'copy-only', reason })
const message = (error: unknown): string => error instanceof Error ? error.message : String(error)

/**
 * Read and validate one saved parametric sidecar without changing host stores.
 * The caller must explicitly supply the independent OCCT replay and plugin
 * fresh-session factory. The default excludes experimental v8. For a plain
 * CAD copy (or ANY uncertainty) the saved copy remains authoritative.
 */
export async function prepareHostSurfaceHistoryRecovery<T extends SurfaceHistoryRestoreController>(
  request: HostHistoryRecoveryRequest<T>,
): Promise<HostHistoryRecovery<T>> {
  try {
    if (request.signal.aborted) return copyOnly('Ripristino annullato.')
    if (!Number.isSafeInteger(request.featureId) || request.featureId <= 0)
      return copyOnly('ID feature parametrica non valido.')
    const before = useReverse.getState()
    if (useShell.getState().workspace !== 'reverse' || before.building || before.playback ||
        before.rolledBack.length > 0)
      return copyOnly('Il progetto Reverse non è pronto per un ripristino isolato.')
    const matches = before.features.filter(feature => feature.id === request.featureId)
    if (matches.length !== 1 || matches[0].kind !== 'import' ||
        matches[0].surfaceEditHistory === undefined)
      return copyOnly('Feature CAD con recipe parametrica univoca non disponibile.')
    const feature = matches[0]
    if (!before.bodies.some(body => Math.floor(body.id) === feature.id))
      return copyOnly('Il corpo risultante dalla feature non è disponibile.')
    let history: StoredSurfaceEditHistoryV1
    try { history = readStoredSurfaceHistory(feature.surfaceEditHistory) }
    catch (error) { return copyOnly(message(error)) }
    // V8 remains deliberately disabled here; do not opt in by untrusted JSON.
    if (!([2, 3, 4, 5, 6] as number[]).includes((history.recipe as {version?:number}).version ?? 0))
      return copyOnly('Versione recipe non ammessa in ripristino host.')

    const notes = useNotes.getState().notes
    const notesBefore = JSON.stringify(notes)
    const model = useStore.getState()
    const assertCurrent = (): void => {
      if (request.signal.aborted) throw new Error('Ripristino annullato.')
      const re = useReverse.getState(), currentNotes = useNotes.getState().notes
      const scan = useStore.getState()
      if (useShell.getState().workspace !== 'reverse' ||
          re.documentEpoch !== before.documentEpoch || re.buildVersion !== before.buildVersion ||
          re.bodiesVersion !== before.bodiesVersion || re.features !== before.features ||
          re.rolledBack !== before.rolledBack || re.stepFiles !== before.stepFiles ||
          re.playback !== before.playback || re.building || re.bodies !== before.bodies ||
          re.features.find(item => item.id === feature.id) !== feature ||
          currentNotes !== notes || JSON.stringify(currentNotes) !== notesBefore ||
          scan.fileName !== model.fileName || scan.appliedAlignment !== model.appliedAlignment ||
          scan.elements !== model.elements || scan.sections !== model.sections ||
          scan.vertexCount !== model.vertexCount || scan.triangleCount !== model.triangleCount)
        throw new Error('Documento, sorgente o note cambiati durante il ripristino parametrico.')
      request.assertCurrent?.()
    }
    assertCurrent()
    const checkResult = async () => {
      const current = request.currentResult
      if (!current) return
      current.assertCurrent(); assertCurrent()
      if (Math.floor(current.binding.bodyId) !== feature.id || !before.bodies.some(body => body.id === current.binding.bodyId))
        throw new Error('La lease non appartiene al risultato parametrico selezionato.')
      const text = new TextDecoder('utf-8', { fatal: true }).decode(current.step)
      const digest = await editorSha256(new TextEncoder().encode(canonicalReplayStep(text)))
      current.assertCurrent(); assertCurrent()
      if (digest !== history.replayStepSha256)
        throw new Error('Il corpo visibile è diverso dal risultato archiviato: ripresa rifiutata.')
    }
    await checkResult()
    const result = await reopenAndRestoreSurfaceHistory(
      feature, before.stepFiles, notes, request.replay, request.makeFreshSession,
      request.awaitValidated, assertCurrent, request.signal,
    )
    if (result.status === 'copy-only') return result
    try { await checkResult(); assertCurrent() }
    catch (error) {
      try { await result.session.dispose('host-error') } catch { /* Preserve source error. */ }
      return copyOnly(message(error))
    }
    let released = false, adopted = false
    const assertRecoveredCurrent = () => {
      if (released) throw new Error('La sessione recuperata è già stata rilasciata.')
      assertCurrent(); request.currentResult?.assertCurrent()
    }
    const archiveSource = request.currentResult ? Object.freeze({ record: result.record,
      resultBodyId: request.currentResult.binding.bodyId, assertCurrent: assertRecoveredCurrent }) : undefined
    if (archiveSource) archiveSources.set(archiveSource, Object.freeze({
      source: canonicalHistoryJson(result.record.source), resultBodyId: archiveSource.resultBodyId,
      replayStepSha256: result.record.replayStepSha256,
    }))
    return {
      status: 'ready', record: result.record, session: result.session,
      ...(archiveSource ? { archiveSource } : {}),
      assertCurrent: assertRecoveredCurrent,
      adopt: () => {
        assertRecoveredCurrent()
        if (adopted) throw new Error('La sessione recuperata è già stata adottata.')
        adopted = true
      },
      release: async () => {
        if (released || adopted) return
        released = true
        await result.session.dispose('cancelled')
      },
    }
  } catch (error) {
    return copyOnly(message(error))
  }
}
