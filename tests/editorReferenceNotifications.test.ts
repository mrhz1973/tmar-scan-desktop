// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest'
import { EditorReferenceNotifications } from '../src/plugins/editorReferenceNotifications'

describe('editor reference notification publication barrier', () => {
  it('delivers ordinary live updates synchronously', () => {
    const refs = new EditorReferenceNotifications(), fn = vi.fn()
    refs.subscribe(fn); refs.notify(); expect(fn).toHaveBeenCalledTimes(1)
  })
  it('defers and coalesces updates until rollback has restored the source', () => {
    const refs = new EditorReferenceNotifications(), fn = vi.fn()
    refs.subscribe(fn); const resume = refs.suspend()
    refs.notify(); refs.notify(); expect(fn).not.toHaveBeenCalled()
    resume(); resume(); expect(fn).toHaveBeenCalledTimes(1)
  })
  it('nested suspension cannot resume early', () => {
    const refs = new EditorReferenceNotifications(), fn = vi.fn()
    refs.subscribe(fn); const a = refs.suspend(), b = refs.suspend()
    refs.notify(); b(); expect(fn).not.toHaveBeenCalled()
    a(); expect(fn).toHaveBeenCalledTimes(1)
  })
  it('discards deferred old-source callbacks after successful disposal', () => {
    const refs = new EditorReferenceNotifications(), fn = vi.fn()
    refs.subscribe(fn); const resume = refs.suspend()
    refs.notify(); refs.dispose(); refs.dispose(); resume(); refs.notify()
    expect(fn).not.toHaveBeenCalled()
    expect(() => refs.subscribe(fn)).toThrow('disposed')
  })
  it('does not call a removed listener and supports independent duplicate subscriptions', () => {
    const refs = new EditorReferenceNotifications(), fn = vi.fn()
    const a = refs.subscribe(fn), b = refs.subscribe(fn), resume = refs.suspend()
    refs.notify(); a(); resume(); expect(fn).toHaveBeenCalledTimes(1)
    b(); refs.notify(); expect(fn).toHaveBeenCalledTimes(1)
  })
  it('does not swallow errors from ordinary live listeners', () => {
    const refs = new EditorReferenceNotifications()
    refs.subscribe(() => { throw Error('real invalid source') })
    expect(() => refs.notify()).toThrow('real invalid source')
  })
})
