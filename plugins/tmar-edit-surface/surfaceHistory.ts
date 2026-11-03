// SPDX-License-Identifier: AGPL-3.0-only
import type { Net } from './brep'

/** One committed state of the editable surface, independent of its panel. */
export interface EditFrame {
  net: Net
  locks: number[]
  continuity: 'G0' | 'G1'
  freeBoundary: boolean
}

/** Local geometry/protection history. Strip editing retains its own history. */
export class SurfaceHistory {
  private frames: EditFrame[] = []
  private cursor = -1
  constructor(private readonly limit = 60) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Limite cronologia non valido.')
  }
  get current(): EditFrame | undefined { return this.frames[this.cursor] }
  get canUndo(): boolean { return this.cursor > 0 }
  get canRedo(): boolean { return this.cursor >= 0 && this.cursor < this.frames.length - 1 }

  reset(): void { this.frames = []; this.cursor = -1 }

  commit(frame: EditFrame): EditFrame {
    const previous = this.current
    // Reuse an unchanged net: changing locks alone must not trigger CAD evaluation.
    const net = previous && JSON.stringify(previous.net) === JSON.stringify(frame.net)
      ? previous.net : structuredClone(frame.net)
    const next: EditFrame = {
      net, locks: [...new Set(frame.locks)].sort((a, b) => a - b),
      continuity: frame.continuity, freeBoundary: frame.freeBoundary,
    }
    if (!previous || previous.net !== next.net || JSON.stringify(previous.locks) !== JSON.stringify(next.locks) ||
        previous.continuity !== next.continuity || previous.freeBoundary !== next.freeBoundary) {
      this.frames = this.frames.slice(0, this.cursor + 1)
      this.frames.push(next)
      if (this.frames.length > this.limit) this.frames.shift()
      this.cursor = this.frames.length - 1
    }
    return next
  }

  step(delta: number): EditFrame | null {
    if (delta !== -1 && delta !== 1) return null
    const next = this.cursor + delta
    if (next < 0 || next >= this.frames.length) return null
    this.cursor = next
    return this.frames[next]
  }
}
