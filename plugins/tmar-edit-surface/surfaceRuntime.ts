// SPDX-License-Identifier: AGPL-3.0-only
import type { Net } from './brep'
import type { Preview } from './editorKernel'
import { PreviewQueue } from './previewQueue'
import { SurfaceHistory } from './surfaceHistory'
import { SurfaceWorkerClient } from './workerClient'

export interface PreviewDraft {
  net: Net
  continuity: 'G0' | 'G1'
  freeBoundary: boolean
  epoch: number
}

/** Session-owned resources; a future host can retain these while remounting a panel.
 * They do not modify project stores or own the shared viewport. */
export class SurfaceRuntime {
  readonly history = new SurfaceHistory()
  readonly worker: SurfaceWorkerClient
  readonly previews: PreviewQueue<PreviewDraft, Preview>
  private disposed = false

  constructor(factory?: () => Worker) {
    this.worker = new SurfaceWorkerClient(factory)
    this.previews = new PreviewQueue({ evaluate: draft => this.worker.ask<Preview>({
      action: 'evaluate', net: draft.net, continuity: draft.continuity, freeBoundary: draft.freeBoundary,
    }) })
  }

  get active(): boolean { return !this.disposed }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.previews.dispose()
    this.worker.dispose()
    this.history.reset()
  }
}
