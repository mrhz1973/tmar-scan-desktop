// SPDX-License-Identifier: AGPL-3.0-only
/** View-reference notifications are not source-validity checks.
 * During synchronous publication the old source lease must not re-enter a
 * controller that is already frozen. On rollback, resume against the restored
 * source; on successful close, dispose without replaying old callbacks. */
export class EditorReferenceNotifications {
  private readonly listeners = new Set<() => void>()
  private holds = 0
  private pending = false
  private closed = false

  subscribe(listener: () => void): () => void {
    if (this.closed) throw new Error('Editor reference notifications disposed.')
    // Distinct subscriptions can intentionally share the same callback.
    const invoke = () => listener()
    this.listeners.add(invoke)
    return () => { this.listeners.delete(invoke) }
  }

  notify(): void {
    if (this.closed) return
    if (this.holds) { this.pending = true; return }
    for (const listener of [...this.listeners]) {
      if (this.closed) break
      if (this.listeners.has(listener)) listener()
    }
  }

  suspend(): () => void {
    if (this.closed) throw new Error('Editor reference notifications disposed.')
    this.holds++
    let held = true
    return () => {
      if (!held) return
      held = false
      this.holds--
      if (!this.closed && this.holds === 0 && this.pending) {
        this.pending = false
        this.notify()
      }
    }
  }

  dispose(): void {
    if (this.closed) return
    this.closed = true
    this.pending = false
    this.listeners.clear()
  }
}
