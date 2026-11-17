// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SceneManager } from '../src/viewer/SceneManager'
import {
  attachComparisonView, comparisonViewOf, subscribeComparisonViews,
  type ComparisonDisplayHost,
} from '../src/viewer/comparisonView'

const detachments: (() => void)[] = []
const subscriptions: (() => void)[] = []
afterEach(() => {
  for (const unsubscribe of subscriptions.splice(0)) unsubscribe()
  for (const detach of detachments.splice(0)) detach()
})

// The registry uses the scene only as its owner identity; no renderer is needed.
const owner = () => ({}) as SceneManager
const host = (): ComparisonDisplayHost => ({
  referenceMesh: vi.fn(() => null),
  addDisplayLayer: vi.fn(() => vi.fn()),
  invalidate: vi.fn(),
})
function attach(scene: SceneManager, view: ComparisonDisplayHost): () => void {
  const detach = attachComparisonView(scene, view)
  detachments.push(detach)
  return detach
}
function subscribe(listener: () => void): () => void {
  const unsubscribe = subscribeComparisonViews(listener)
  subscriptions.push(unsubscribe)
  return unsubscribe
}

describe('live comparison viewport ownership', () => {
  it('has no comparison for an absent or unpublished owner', () => {
    expect(comparisonViewOf(null)).toBeNull()
    expect(comparisonViewOf(owner())).toBeNull()
  })

  it('keeps different scene owners independent during replacement and removal', () => {
    const a = owner(), b = owner()
    const first = host(), second = host(), replacement = host()
    attach(a, first)
    const detachB = attach(b, second)
    expect(comparisonViewOf(a)).toBe(first)
    expect(comparisonViewOf(b)).toBe(second)

    const detachA = attach(a, replacement)
    expect(comparisonViewOf(a)).toBe(replacement)
    expect(comparisonViewOf(b)).toBe(second)
    detachB()
    expect(comparisonViewOf(a)).toBe(replacement)
    expect(comparisonViewOf(b)).toBeNull()
    detachA()
    expect(comparisonViewOf(a)).toBeNull()
  })

  it('exposes an existing snapshot to a subscriber mounted after publication', () => {
    const scene = owner(), view = host()
    const detach = attach(scene, view)
    const observed: (ComparisonDisplayHost | null)[] = []
    subscribe(() => { observed.push(comparisonViewOf(scene)) })

    // useSyncExternalStore reads the snapshot even if it missed publication.
    expect(comparisonViewOf(scene)).toBe(view)
    detach()
    expect(observed).toEqual([null])
  })

  it('notifies synchronously after the new snapshot is available', () => {
    const scene = owner(), first = host(), next = host()
    const observed: (ComparisonDisplayHost | null)[] = []
    subscribe(() => { observed.push(comparisonViewOf(scene)) })

    attach(scene, first)
    expect(observed).toEqual([first])
    const detach = attach(scene, next)
    expect(observed).toEqual([first, next])
    detach()
    expect(observed).toEqual([first, next, null])
  })

  for (const reuseHost of [false, true]) {
    it(`ignores stale cleanup when replacement ${reuseHost ? 'reuses the same' : 'uses a different'} host`, () => {
      const scene = owner(), first = host(), next = reuseHost ? first : host()
      const changed = vi.fn()
      subscribe(changed)
      const detachOld = attach(scene, first)
      const detachNew = attach(scene, next)
      expect(changed).toHaveBeenCalledTimes(2)

      // A React cleanup belongs to its registration, not just its host object.
      detachOld(); detachOld()
      expect(comparisonViewOf(scene)).toBe(next)
      expect(changed).toHaveBeenCalledTimes(2)
      detachNew(); detachNew()
      expect(comparisonViewOf(scene)).toBeNull()
      expect(changed).toHaveBeenCalledTimes(3)
    })
  }

  it('unsubscribes independently and makes repeated cleanup harmless', () => {
    const scene = owner(), first = vi.fn(), second = vi.fn()
    const stopFirst = subscribe(first), stopSecond = subscribe(second)
    const detach = attach(scene, host())
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)

    stopFirst(); stopFirst()
    detach(); detach()
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(2)
    stopSecond(); stopSecond()
    attach(scene, host())
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(2)
  })

  it('publishes borrowed hosts without taking over their display lifecycle', () => {
    const scene = owner(), first = host(), next = host()
    const detachOld = attach(scene, first)
    const detachNew = attach(scene, next)
    detachOld(); detachNew()
    for (const view of [first, next]) {
      expect(view.referenceMesh).not.toHaveBeenCalled()
      expect(view.addDisplayLayer).not.toHaveBeenCalled()
      expect(view.invalidate).not.toHaveBeenCalled()
    }
  })
})
