// SPDX-License-Identifier: AGPL-3.0-only
// Host composition of existing editor locks, replay tokens and archive recovery.
import type { BoundEditorSource, EditorApplyDisplayOptions, EditorHistoryReplay, PreparedEditorHistory, RecoveredEditorSession } from '../../../src/plugins/workspaceEditors'
import type { WorkspaceEditorController } from '../../../src/plugins/workspaceEditorTypes'
import { abortIfNeeded, editorSha256 } from '../../../src/plugins/editorLifetime'
import { useReverse } from '../state/reStore'
import { useNotes } from '../state/noteStore'
import { reverseSession } from './reSession'
import { bindIndependentPluginReplay, qualifySurfaceHistory, qualifyAnnotatedSurfaceHistory, readStoredSurfaceHistory,
  withFrozenHistoryTransaction, type PluginHistoryPreparation, type PluginAnnotatedHistoryPreparation,
  type HistoryFreezeLease, type SurfaceHistoryRestoreController } from './surfaceEditHistory'
import { prepareHostSurfaceHistoryRecovery, type ArchivedSurfaceHistorySource, type HostHistoryRecovery } from './surfaceHistoryRecovery'

type HistoryController = WorkspaceEditorController & SurfaceHistoryRestoreController & {
  prepareHistoryRecipe(): Promise<PluginHistoryPreparation>
  prepareAnnotatedHistory(): Promise<PluginAnnotatedHistoryPreparation>
  freezeHistory(prepared: PluginHistoryPreparation): HistoryFreezeLease
  isHistoryRecipeStampCurrent(prepared: PluginHistoryPreparation): boolean
  isAnnotatedHistoryStampCurrent(prepared: PluginAnnotatedHistoryPreparation): boolean
}
const archivedSources = new WeakMap<BoundEditorSource, ArchivedSurfaceHistorySource>()
function historyController(controller: WorkspaceEditorController): HistoryController {
  const value = controller as Partial<HistoryController>
  if (typeof value.prepareHistoryRecipe !== 'function' || typeof value.prepareAnnotatedHistory !== 'function' ||
      typeof value.freezeHistory !== 'function' || typeof value.restoreHistoryBundle !== 'function' ||
      typeof value.isHistoryRecipeStampCurrent !== 'function' || typeof value.isAnnotatedHistoryStampCurrent !== 'function' ||
      typeof value.getPanelState !== 'function') throw new Error('Il controller non supporta la cronologia verificata.')
  return controller as HistoryController
}
function allowedRecipe(recipe: unknown): void {
  if (!recipe || typeof recipe !== 'object' || ![2, 3, 4, 5, 6].includes((recipe as { version: number }).version))
    throw new Error('La modifica non dispone di una ricetta riapribile supportata. La versione sperimentale v8 resta esclusa.')
}

export async function prepareWorkspaceSurfaceHistory(source: BoundEditorSource, value: WorkspaceEditorController,
  replay: EditorHistoryReplay, signal: AbortSignal, display?: EditorApplyDisplayOptions): Promise<PreparedEditorHistory> {
  const controller = historyController(value)
  source.assertCurrent(); abortIfNeeded(signal)
  const noteCount = controller.getSnapshot().draftNoteCount
  const prepared = noteCount ? await controller.prepareAnnotatedHistory() : await controller.prepareHistoryRecipe()
  source.assertCurrent(); abortIfNeeded(signal); allowedRecipe(prepared.recipe)
  const assertPreparedCurrent = () => {
    source.assertCurrent(); abortIfNeeded(signal)
    const valid = noteCount ? controller.isAnnotatedHistoryStampCurrent(prepared as PluginAnnotatedHistoryPreparation)
      : controller.isHistoryRecipeStampCurrent(prepared)
    if (!valid) throw new Error('La ricetta non corrisponde più alla superficie e alle note correnti.')
  }
  // The legacy serializer evaluates in the same worker and schedules a fresh
  // preview. For notes that also updates native anchors/revisions. Wait for the
  // plugin's provenance guard, which checks the exact net and durable note data.
  const waitPrepared = () => new Promise<void>((resolve, reject) => {
    let stop = () => {}, finished = false
    const finish = (error?: unknown) => {
      if (finished) return
      finished = true; stop(); signal.removeEventListener('abort', aborted); clearTimeout(timer)
      if (error) reject(error); else resolve()
    }
    const aborted = () => finish(new DOMException('Ripresa annullata.', 'AbortError'))
    const timer = setTimeout(() => finish(new Error('La preview della ricetta non ha concluso la convalida.')), 30000)
    const check = () => {
      try {
        source.assertCurrent(); abortIfNeeded(signal)
        const validation = controller.getSnapshot().validation
        if (validation.kind === 'pending') return
        if (validation.kind !== 'valid') throw new Error('La preview della ricetta non è valida.')
        assertPreparedCurrent(); finish()
      } catch (error) { finish(error) }
    }
    signal.addEventListener('abort', aborted, { once: true })
    stop = controller.subscribe(check)
    if (finished) stop(); else check()
  })
  await waitPrepared()
  assertPreparedCurrent()
  let consumed = false
  return {
    assertPreparedCurrent,
    withStaged: (exported, publish) => {
      if (consumed) return Promise.reject(new Error('La preparazione della cronologia è già stata utilizzata.'))
      consumed = true
      const transaction = () => withFrozenHistoryTransaction(controller, prepared, async gate => {
        const current = () => { source.assertCurrent(); abortIfNeeded(signal); gate.assertCurrent() }
        current()
        const lockedSnapshot = controller.getSnapshot()
        const session = reverseSession()
        if (!session) throw new Error('Sessione CAD non disponibile.')
        const annotated = exported.annotated
        const cad = exported.cad
        if (!!annotated === !!cad || !!annotated !== (noteCount > 0))
          throw new Error('Esportazione e ricetta della cronologia non coincidono.')
        const step = (annotated?.prepared.step ?? cad!.step).slice()
        const independent = bindIndependentPluginReplay(replay, current)
        const common = { source, prepared, resultStep: step, signal, replay: independent,
          isStampCurrent: () => { current(); return true } }
        const qualified = annotated
          ? await qualifyAnnotatedSurfaceHistory({ ...common, prepared: prepared as PluginAnnotatedHistoryPreparation, annotationPlan: annotated })
          : await qualifySurfaceHistory({ ...common, noteCount })
        current()
        const staged = await session.stageEditorCopy(new TextDecoder('utf-8', { fatal: true }).decode(step),
          annotated?.prepared.name ?? cad!.name, current, signal,
          display?.hideSourceAfterApply ? { hideSourceBodyId: source.displayBodyId ?? source.binding.bodyId } : undefined,
          annotated, gate.bindQualified(qualified), archivedSources.get(source))
        try {
          current()
          return await publish(staged, qualified.record.resultStepSha256, lockedSnapshot)
        } finally { staged.dispose() }
      })
      // Annotated export refreshes the native witness. Resolving unchanged UV
      // notes may advance epochs; only the plugin's exact net/note provenance
      // guard can authorize the new lock. Any user mutation is refused by it.
      if (noteCount) return waitPrepared().then(transaction)
      try { assertPreparedCurrent(); return transaction() }
      catch (error) { return Promise.reject(error) }
    },
  }
}

export async function recoverWorkspaceSurfaceHistory(visible: BoundEditorSource, replay: EditorHistoryReplay,
  createSession: (source: BoundEditorSource) => Promise<WorkspaceEditorController>, signal: AbortSignal): Promise<RecoveredEditorSession> {
  visible.assertCurrent(); abortIfNeeded(signal)
  const featureId = Math.floor(visible.binding.bodyId)
  const feature = useReverse.getState().features.find(item => item.id === featureId)
  if (!feature || feature.kind !== 'import' || !feature.surfaceEditHistory)
    throw new Error('Questo corpo non contiene una modifica riapribile salvata.')
  const record = readStoredSurfaceHistory(feature.surfaceEditHistory)
  allowedRecipe(record.recipe)
  let recovered: Extract<HostHistoryRecovery<HistoryController>, { status: 'ready' }> | undefined
  let source: BoundEditorSource | undefined
  const result = await prepareHostSurfaceHistoryRecovery({
    featureId, signal, currentResult: visible, assertCurrent: visible.assertCurrent,
    replay: bindIndependentPluginReplay(replay, visible.assertCurrent),
    makeFreshSession: async (bytes, bodyKey) => {
      visible.assertCurrent(); abortIfNeeded(signal)
      const digest = await editorSha256(bytes)
      visible.assertCurrent(); abortIfNeeded(signal)
      if (bodyKey !== record.source.bodyKey || digest !== record.source.stepSha256)
        throw new Error('La sorgente archiviata non corrisponde alla ricetta verificata.')
      source = {
        // The result body is only a viewport/document lease. Geometry uses the
        // authentic archived upstream body key and bytes, never the result.
        binding: Object.freeze({ ...visible.binding, bodyId: record.source.bodyId, bodyKey, stepSha256: digest }),
        step: bytes.slice(), displayBodyId: visible.binding.bodyId,
        assertCurrent: () => { visible.assertCurrent(); recovered?.assertCurrent() },
        subscribe: listener => {
          const a = visible.subscribe(listener), b = useNotes.subscribe(listener)
          return () => { a(); b() }
        },
      }
      const controller = await createSession(source)
      try { return historyController(controller) }
      catch (error) { await controller.dispose('open-failed'); throw error }
    },
    awaitValidated: async controller => {
      abortIfNeeded(signal)
      if (controller.getSnapshot().validation.kind !== 'valid') throw new Error('La preview ripristinata non è valida.')
    },
  })
  if (result.status !== 'ready') throw new Error(result.reason)
  recovered = result
  try {
    result.assertCurrent()
    if (!source || !result.archiveSource) throw new Error('La provenienza della sorgente archiviata non è disponibile.')
    archivedSources.set(source, result.archiveSource)
    return { source, controller: result.session, assertCurrent: result.assertCurrent, adopt: result.adopt, release: result.release }
  } catch (error) { await result.release(); throw error }
}
