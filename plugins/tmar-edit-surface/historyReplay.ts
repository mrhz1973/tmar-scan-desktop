// SPDX-License-Identifier: AGPL-3.0-only
import type { Preview } from './editorKernel'
import { readCurvedRecipe, readRecipe } from './recipe'
import { SurfaceWorkerClient } from './workerClient'
import { readAdaptiveLockedRecipe } from './adaptiveLockedRecipe'

export interface SurfaceReplaySource {
  readonly bodyKey: string
  readonly stepSha256: string
  readonly step: Uint8Array
  /** Host checks its live document/source epochs at every async boundary. */
  readonly assertCurrent: () => void
}

/** Independently replay and validate a saved recipe; never changes a workspace
 * session or publishes a host feature. The host still owns its transaction. */
export async function replaySurfaceHistory(source: SurfaceReplaySource, value: unknown, signal?: AbortSignal,
  makeWorker?: () => Worker): Promise<Preview & { step: string }> {
  const ensureCurrent = () => {
    if (signal?.aborted) throw new DOMException('Operazione annullata.', 'AbortError')
    source.assertCurrent()
  }
  ensureCurrent()
  const saved = structuredClone(value)
  const version = (saved as { version?: unknown } | null)?.version
  const recipe = version === 8 ? readAdaptiveLockedRecipe(saved) : version === 6 ? readCurvedRecipe(saved) : readRecipe(saved)
  const bodyKey = source.bodyKey, stepSha256 = source.stepSha256
  if (recipe.source.bodyId !== bodyKey) throw new Error('La ricetta appartiene a un altro corpo CAD.')
  const bytes = source.step.slice()
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer)),
    byte => byte.toString(16).padStart(2, '0')).join('')
  ensureCurrent()
  if (hash.toLowerCase() !== stepSha256.toLowerCase()) throw new Error('Il contenuto STEP non corrisponde alla sorgente.')
  const worker = new SurfaceWorkerClient(makeWorker)
  try {
    const reply = await worker.ask<Preview & {step?: unknown}>({ action: version === 8 ? 'replayAdaptiveLockedRecipe' : version === 6 ? 'replayCurvedRecipe' : 'replayRecipe',
      step: new TextDecoder().decode(bytes), recipe, bodyId: bodyKey }, signal)
    ensureCurrent()
    if (!reply || reply.valid !== true || typeof reply.step !== 'string' || !reply.step.trim())
      throw new Error('La verifica CAD non ha prodotto uno STEP valido.')
    return reply as Preview & {step:string}
  } finally { worker.dispose() }
}
