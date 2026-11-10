// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Serial, coalescing queue for CAD preview evaluations.
 *
 * Scheduling does not debounce by resetting the timer: the first draft starts
 * a fixed delay, and later drafts replace its payload. This keeps a moving
 * pointer from starving the preview. Evaluations never overlap.
 */
export interface PreviewQueueJob<Draft, Identity> {
  readonly draft: Draft
  readonly identity: Identity
  readonly revision: number
  readonly epoch: number
}

export interface PreviewQueueResult<Preview, Identity> {
  readonly value: Preview
  readonly identity: Identity
  readonly revision: number
  readonly epoch: number
  /** True when this preview belongs to a draft older than the current one. */
  readonly stale: boolean
}

export interface PreviewQueueError<Identity> {
  readonly error: unknown
  readonly identity: Identity
  readonly revision: number
  readonly epoch: number
}

export interface PreviewQueueSnapshot<Draft, Preview, Identity> {
  readonly epoch: number
  readonly current: PreviewQueueJob<Draft, Identity> | null
  readonly preview: PreviewQueueResult<Preview, Identity> | null
  /** Revision currently known to have passed CAD evaluation, or null. */
  readonly validRevision: number | null
  readonly error: PreviewQueueError<Identity> | null
  readonly calculating: boolean
  readonly disposed: boolean
}

export interface PreviewQueueOptions<Draft, Preview> {
  evaluate: (draft: Draft) => Promise<Preview>
  delayMs?: number
}

export class PreviewQueue<Draft, Preview, Identity = Draft> {
  private readonly evaluate: (draft: Draft) => Promise<Preview>
  private readonly delayMs: number
  private readonly listeners = new Set<() => void>()
  private epoch = 0
  private revision = 0
  private latest: PreviewQueueJob<Draft, Identity> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private disposed = false
  private snapshot: PreviewQueueSnapshot<Draft, Preview, Identity>

  constructor(options: PreviewQueueOptions<Draft, Preview>) {
    this.evaluate = options.evaluate
    this.delayMs = Math.max(0, options.delayMs ?? 90)
    this.snapshot = {
      epoch: 0,
      current: null,
      preview: null,
      validRevision: null,
      error: null,
      calculating: false,
      disposed: false,
    }
  }

  getSnapshot = (): PreviewQueueSnapshot<Draft, Preview, Identity> => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => undefined
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Schedule a draft. Repeated calls before the timer fires keep only the last. */
  schedule(draft: Draft, identity: Identity = draft as unknown as Identity): number | null {
    if (this.disposed) return null
    const job: PreviewQueueJob<Draft, Identity> = {
      draft,
      identity,
      revision: ++this.revision,
      epoch: this.epoch,
    }
    this.latest = job
    this.publish({
      ...this.snapshot,
      current: job,
      preview: this.snapshot.preview ? { ...this.snapshot.preview, stale: true } : null,
      validRevision: null,
      error: null,
      calculating: true,
    })
    // Like the original scheduler, keep the first timer while input continues.
    // When an evaluation is in flight, its drain loop will take the latest job.
    if (!this.running && this.timer === null) {
      this.timer = setTimeout(() => {
        this.timer = null
        void this.drain()
      }, this.delayMs)
    }
    return job.revision
  }

  /** Invalidate the current draft. In-flight CAD may still finish, but its result is ignored. */
  invalidate(options: { clearPreview?: boolean } = {}): void {
    if (this.disposed) return
    this.epoch++
    this.latest = null
    this.clearTimer()
    const preview = !options.clearPreview && this.snapshot.preview
      ? { ...this.snapshot.preview, stale: true }
      : null
    this.publish({
      ...this.snapshot,
      epoch: this.epoch,
      current: null,
      preview,
      validRevision: null,
      error: null,
      // This flag describes the current draft, not obsolete worker activity.
      calculating: false,
    })
  }

  /** Idempotently stop scheduling and ignore any pending worker response. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.epoch++
    this.latest = null
    this.clearTimer()
    this.publish({
      ...this.snapshot,
      epoch: this.epoch,
      current: null,
      preview: this.snapshot.preview ? { ...this.snapshot.preview, stale: true } : null,
      validRevision: null,
      error: null,
      calculating: false,
      disposed: true,
    })
    this.listeners.clear()
  }

  private async drain(): Promise<void> {
    if (this.disposed || this.running || !this.latest) {
      this.updateCalculating()
      return
    }
    this.running = true
    try {
      while (!this.disposed && this.latest) {
        const job = this.latest
        this.latest = null
        try {
          const value = await this.evaluate(job.draft)
          if (!this.acceptsEpoch(job)) continue

          const current = this.snapshot.current
          const isCurrent = current?.revision === job.revision && current.epoch === job.epoch
          const previousPreview = this.snapshot.preview
          // A late/older completion may serve as a stale visual, but cannot
          // replace a preview from a newer revision or epoch.
          if (!previousPreview || previousPreview.epoch < job.epoch ||
              (previousPreview.epoch === job.epoch && previousPreview.revision <= job.revision)) {
            const preview: PreviewQueueResult<Preview, Identity> = {
              value,
              identity: job.identity,
              revision: job.revision,
              epoch: job.epoch,
              stale: !isCurrent,
            }
            this.publish({
              ...this.snapshot,
              preview,
              validRevision: isCurrent ? job.revision : this.snapshot.validRevision,
              // A stale success must never erase an error for the current draft.
              error: isCurrent ? null : this.snapshot.error,
            })
          } else if (isCurrent) {
            // The newer preview is already visible; still mark the current
            // draft valid without replacing that newer result.
            this.publish({ ...this.snapshot, validRevision: job.revision, error: null })
          }
        } catch (error) {
          if (!this.acceptsEpoch(job)) continue
          const current = this.snapshot.current
          if (current?.revision === job.revision && current.epoch === job.epoch) {
            this.publish({
              ...this.snapshot,
              validRevision: null,
              error: { error, identity: job.identity, revision: job.revision, epoch: job.epoch },
            })
          }
        }
      }
    } finally {
      this.running = false
      // schedule() may have run just as the drain loop was completing.
      if (!this.disposed && this.latest) {
        this.timer = setTimeout(() => {
          this.timer = null
          void this.drain()
        }, this.delayMs)
      } else if (!this.disposed) {
        this.publish({ ...this.snapshot, calculating: false })
      }
    }
  }

  private acceptsEpoch(job: PreviewQueueJob<Draft, Identity>): boolean {
    return !this.disposed && job.epoch === this.epoch
  }

  private updateCalculating(): void {
    if (this.disposed) return
    const calculating = this.running || this.latest !== null || this.timer !== null
    if (this.snapshot.calculating !== calculating) this.publish({ ...this.snapshot, calculating })
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  private publish(snapshot: PreviewQueueSnapshot<Draft, Preview, Identity>): void {
    this.snapshot = snapshot
    for (const listener of this.listeners) listener()
  }
}
