// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest'
import type { Point } from '../brep'
import type { DragFrame } from '../dragFrame'
import { createSurfaceGesture, SURFACE_DRAG_THRESHOLD_PX, type SurfaceGestureInput, type SurfacePointer } from '../surfaceGesture'

const poles = (): Point[] => [[0, 0, 0], [1, 1, 1], [2, 2, 2]]
const pointer = (clientX: number, clientY = 0, extra: Partial<SurfacePointer> = {}): SurfacePointer =>
  ({ pointerId: 7, clientX, clientY, ...extra })
const frame = (): DragFrame => ({ deltaAt: (x, y) => [x / 10, y / 10, 0] })
const make = (overrides: Partial<SurfaceGestureInput> = {}) => createSurfaceGesture({
  frame: frame(), poles: poles(), selected: [1, 2], start: pointer(0), strength: 1, ...overrides,
})!

describe('single surface gesture', () => {
  it('treats a click or motion below four CSS pixels as no edit and no commit', () => {
    const deltaAt = vi.fn((x: number, y: number): Point => [x, y, 0])
    const g = make({ frame: { deltaAt } })
    expect(SURFACE_DRAG_THRESHOLD_PX).toBe(4)
    expect(g.move(pointer(3.99))).toEqual({ kind: 'ignored' })
    expect(g.up(pointer(3.99))).toEqual({ kind: 'unchanged' })
    expect(g.lastDelta()).toBeNull()
    expect(deltaAt).not.toHaveBeenCalled()
    expect(g.up(pointer(20))).toEqual({ kind: 'ignored' })
  })

  it('starts at four pixels and moves only selected poles, with the chosen intensity', () => {
    const source = poles(), selected = [1, 2, 1]
    const g = make({ poles: source, selected, strength: 0.5 })
    expect(g.move(pointer(4))).toEqual({ kind: 'preview', delta: [0.2, 0, 0],
      poles: [[0, 0, 0], [1.2, 1, 1], [2.2, 2, 2]] })
    expect(g.up(pointer(10))).toEqual({ kind: 'commit', delta: [0.5, 0, 0],
      poles: [[0, 0, 0], [1.5, 1, 1], [2.5, 2, 2]] })
    expect(source).toEqual(poles())
    expect(selected).toEqual([1, 2, 1])
    expect(g.cancel()).toEqual({ kind: 'ignored' })
  })

  it('ignores other pointers for move, release and cancel', () => {
    const g = make()
    expect(g.move(pointer(10, 0, { pointerId: 8 }))).toEqual({ kind: 'ignored' })
    expect(g.up(pointer(10, 0, { pointerId: 8 }))).toEqual({ kind: 'ignored' })
    expect(g.cancel(8)).toEqual({ kind: 'ignored' })
    expect(g.lastDelta()).toBeNull()
    expect(g.move(pointer(10)).kind).toBe('preview')
    expect(g.up(pointer(10)).kind).toBe('commit')
  })

  it('disables the resolver for Alt or snapEnabled=false on each event', () => {
    const resolveDelta = vi.fn((): Point => [5, 0, 0])
    const g = make({ resolveDelta })
    expect(g.move(pointer(10))).toMatchObject({ kind: 'preview', delta: [5, 0, 0] })
    expect(g.move(pointer(20, 0, { altKey: true }))).toMatchObject({ kind: 'preview', delta: [2, 0, 0] })
    expect(g.move(pointer(30, 0, { snapEnabled: false }))).toMatchObject({ kind: 'preview', delta: [3, 0, 0] })
    expect(g.up(pointer(40, 0, { altKey: true }))).toMatchObject({ kind: 'commit', delta: [4, 0, 0] })
    expect(resolveDelta).toHaveBeenCalledTimes(1)
  })

  it('passes scaled movement to the resolver and falls back when there is no target', () => {
    const resolveDelta = vi.fn((_delta: Readonly<Point>, _p: Readonly<SurfacePointer>) => null)
    const g = make({ resolveDelta, strength: 0.5 })
    expect(g.move(pointer(10))).toMatchObject({ kind: 'preview', delta: [0.5, 0, 0] })
    expect(resolveDelta.mock.calls[0][0]).toEqual([0.5, 0, 0])
  })

  it('preserves the last valid draft if the frame becomes degenerate', () => {
    const g = make({ frame: { deltaAt: x => x === 10 ? [1, 0, 0] : null } })
    expect(g.move(pointer(10))).toMatchObject({ kind: 'preview', delta: [1, 0, 0] })
    expect(g.move(pointer(20))).toEqual({ kind: 'invalid' })
    expect(g.lastDelta()).toEqual([1, 0, 0])
    expect(g.up(pointer(30))).toMatchObject({ kind: 'commit', delta: [1, 0, 0] })
    const empty = make({ frame: { deltaAt: () => null } })
    expect(empty.move(pointer(10))).toEqual({ kind: 'invalid' })
    expect(empty.up(pointer(10))).toEqual({ kind: 'unchanged' })
  })

  it('restores the captured starting poles on cancel and ignores a late release', () => {
    const source = poles(), selected = [1, 2]
    const g = make({ poles: source, selected })
    source[1][0] = 99; selected.splice(0, 1)
    expect(g.move(pointer(10))).toMatchObject({ kind: 'preview', poles: [[0, 0, 0], [2, 1, 1], [3, 2, 2]] })
    expect(g.cancel()).toEqual({ kind: 'restore', poles: poles() })
    expect(g.cancel()).toEqual({ kind: 'ignored' })
    expect(g.up(pointer(20))).toEqual({ kind: 'ignored' })
  })

  it('restores a preview that returns to the start, rather than committing a zero edit', () => {
    const g = make()
    expect(g.move(pointer(10)).kind).toBe('preview')
    expect(g.up(pointer(0))).toEqual({ kind: 'restore', poles: poles() })
  })

  it('does not expose mutable internal state in outputs', () => {
    const g = make(), preview = g.move(pointer(10))
    if (preview.kind !== 'preview') throw new Error('expected preview')
    preview.delta[0] = 500; preview.poles[1][0] = 500
    const delta = g.lastDelta()!
    delta[0] = 900
    expect(g.lastDelta()).toEqual([1, 0, 0])
    expect(g.up(pointer(10))).toMatchObject({ kind: 'commit', delta: [1, 0, 0], poles: [[0, 0, 0], [2, 1, 1], [3, 2, 2]] })
  })

  it('can commit a release beyond the threshold even without an intermediate move event', () => {
    const g = make()
    expect(g.up(pointer(10))).toMatchObject({ kind: 'commit', delta: [1, 0, 0] })
  })

  it('uses the last valid delta when a resolver throws or gives a non-finite answer', () => {
    const resolveDelta = vi.fn((delta: Readonly<Point>, p: Readonly<SurfacePointer>) => {
      if (p.clientX === 20) throw new Error('unavailable')
      if (p.clientX === 30) return [Number.NaN, 0, 0] as Point
      return [...delta] as Point
    })
    const g = make({ resolveDelta })
    expect(g.move(pointer(10)).kind).toBe('preview')
    expect(g.move(pointer(20))).toEqual({ kind: 'invalid' })
    expect(g.move(pointer(30))).toEqual({ kind: 'invalid' })
    expect(g.up(pointer(30))).toMatchObject({ kind: 'commit', delta: [1, 0, 0] })
  })

  it('does not let a resolver mutate the caller event or raw delta', () => {
    const event = pointer(10)
    const g = make({ resolveDelta: (delta, p) => {
      ;(delta as Point)[0] = 123
      ;(p as { clientX: number }).clientX = 123
      return null
    } })
    expect(g.move(event)).toMatchObject({ kind: 'preview', delta: [1, 0, 0] })
    expect(event.clientX).toBe(10)
  })

  it('finishes with the last valid preview when the release coordinates are invalid', () => {
    const g = make()
    expect(g.move(pointer(10)).kind).toBe('preview')
    expect(g.up(pointer(Number.NaN))).toMatchObject({ kind: 'commit', delta: [1, 0, 0] })
    expect(make().up(pointer(Number.NaN))).toEqual({ kind: 'unchanged' })
  })

  it('rejects invalid input and does not emit non-finite pole coordinates', () => {
    const input: SurfaceGestureInput = { frame: frame(), poles: poles(), selected: [1], start: pointer(0), strength: 1 }
    expect(createSurfaceGesture({ ...input, strength: -1 })).toBeNull()
    expect(createSurfaceGesture({ ...input, start: pointer(Number.NaN) })).toBeNull()
    expect(createSurfaceGesture({ ...input, selected: [] })).toBeNull()
    expect(createSurfaceGesture({ ...input, selected: [3] })).toBeNull()
    expect(createSurfaceGesture({ ...input, poles: [[Number.NaN, 0, 0]] })).toBeNull()
    const huge = make({ poles: [[1e308, 0, 0]], selected: [0], frame: { deltaAt: () => [1e308, 0, 0] } })
    expect(huge.move(pointer(10))).toEqual({ kind: 'invalid' })
    expect(huge.up(pointer(10))).toEqual({ kind: 'unchanged' })
  })
})
