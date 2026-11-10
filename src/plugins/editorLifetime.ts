// SPDX-License-Identifier: AGPL-3.0-only
/** Small owned-resource stack: reverse order, once, and no lost cleanup on error. */
export class EditorLifetime {
  private entries: (() => void)[] = []
  private closed = false
  readonly errors: unknown[] = []
  own(cleanup: () => void): () => void {
    let live = true
    const once = () => {
      if (!live) return
      live = false
      const at = this.entries.indexOf(once)
      if (at >= 0) this.entries.splice(at, 1)
      try { cleanup() } catch (error) { this.errors.push(error) }
    }
    if (this.closed) once()
    else this.entries.push(once)
    return once
  }
  dispose(): void {
    if (this.closed) return
    this.closed = true
    for (const dispose of [...this.entries].reverse()) dispose()
  }
}

export const abortIfNeeded = (signal: AbortSignal): void => {
  if (signal.aborted) throw new Error('La sessione di modifica è stata annullata.')
}
export async function editorSha256(bytes: Uint8Array): Promise<string> {
  // Copy also handles subarray offsets and prevents transfer of a borrowed buffer.
  const hash = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer)
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('')
}
