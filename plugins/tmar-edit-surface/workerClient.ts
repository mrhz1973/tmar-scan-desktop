// SPDX-License-Identifier: AGPL-3.0-only
import type { Request } from './editor.worker'

/** Preserve the worker's action-specific request fields while the client owns ids. */
export type SurfaceWorkerPayload = Request extends infer R ? R extends Request ? Omit<R, 'id'> : never : never

interface Pending {
  resolve(value: unknown): void
  reject(error: Error): void
  cleanup(): void
}

/** One client owns one Edit Surface worker. Abort releases a caller but cannot
 * interrupt an OCCT operation already running in the worker. Its late reply is
 * ignored; callers must separately invalidate any affected CAD draft state. */
export class SurfaceWorkerClient {
  private worker: Worker | null
  private terminal: Error | null = null
  private serial = 0
  private readonly pending = new Map<number, Pending>()
  onFailure: ((error: Error) => void) | null = null

  constructor(factory: () => Worker = () => new Worker(new URL('./editor.worker.ts', import.meta.url), { type: 'module' })) {
    const worker = factory()
    this.worker = worker
    worker.onmessage = ({ data }: MessageEvent<unknown>) => {
      if (this.worker !== worker || !data || typeof data !== 'object') return
      const reply = data as { id?: unknown; result?: unknown; error?: unknown }
      if (typeof reply.id !== 'number') return
      const entry = this.pending.get(reply.id)
      if (!entry) return
      this.pending.delete(reply.id)
      entry.cleanup()
      if (typeof reply.error === 'string') entry.reject(new Error(reply.error))
      else entry.resolve(reply.result)
    }
    worker.onerror = (event: ErrorEvent) => {
      event.preventDefault?.()
      const detail = event.message ? `: ${event.message}` : '.'
      this.stop(new Error(`Motore CAD interrotto${detail} Chiudi e riapri Edit Surface.`), true)
    }
    worker.onmessageerror = () => this.stop(new Error('Risposta del motore CAD non leggibile. Chiudi e riapri Edit Surface.'), true)
  }

  /** A request retains its action-specific fields; replies are matched by id. */
  ask<T>(payload: SurfaceWorkerPayload, signal?: AbortSignal): Promise<T> {
    if (this.terminal || !this.worker) return Promise.reject(this.terminal ?? new Error('Motore CAD non disponibile.'))
    if (signal?.aborted) return Promise.reject(new DOMException('Operazione annullata.', 'AbortError'))
    const worker = this.worker
    const id = ++this.serial
    return new Promise<T>((resolve, reject) => {
      const abort = () => {
        const entry = this.pending.get(id)
        if (!entry) return
        this.pending.delete(id)
        entry.cleanup()
        entry.reject(new DOMException('Operazione annullata.', 'AbortError'))
      }
      const cleanup = () => signal?.removeEventListener('abort', abort)
      this.pending.set(id, { resolve: value => resolve(value as T), reject, cleanup })
      if (signal) {
        signal.addEventListener('abort', abort, { once: true })
        // Also handle an abort immediately before the listener was attached.
        if (signal.aborted) { abort(); return }
      }
      try { worker.postMessage({ ...payload, id }) }
      catch (error) {
        const entry = this.pending.get(id)
        if (!entry) return
        this.pending.delete(id)
        entry.cleanup()
        entry.reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  /** Idempotent: outstanding calls fail, and no worker is restarted. */
  dispose(): void { this.stop(new Error('Editor chiuso.'), false) }

  private stop(error: Error, notify: boolean): void {
    if (this.terminal) return
    this.terminal = error
    const worker = this.worker
    this.worker = null
    if (worker) {
      worker.onmessage = worker.onerror = worker.onmessageerror = null
      try { worker.terminate() } catch { /* Still release every waiting caller. */ }
    }
    const entries = [...this.pending.values()]
    this.pending.clear()
    for (const entry of entries) { entry.cleanup(); entry.reject(error) }
    if (notify) this.onFailure?.(error)
  }
}
