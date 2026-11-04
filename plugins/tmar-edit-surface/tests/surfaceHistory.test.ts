// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import type { Net } from '../brep'
import { SurfaceHistory, type EditFrame } from '../surfaceHistory'

function frame(z = 0): EditFrame {
  const net: Net = { nu: 2, nv: 2, du: 1, dv: 1,
    poles: [[0, 0, z], [0, 1, 0], [1, 0, 0], [1, 1, 0]],
    weights: [1, 1, 1, 1], rational: [0, 0], ku: [0, 1], kv: [0, 1], mu: [2, 2], mv: [2, 2] }
  return { net, locks: [], continuity: 'G1', freeBoundary: false }
}

describe('surface geometry and protection history', () => {
  it('stores independent geometry and does not add a duplicate step', () => {
    const h = new SurfaceHistory(), original = frame()
    const first = h.commit(original)
    original.net.poles[0][2] = 50
    expect(h.current?.net.poles[0][2]).toBe(0)
    expect(h.commit(frame()).net).toBe(first.net)
    expect(h.canUndo).toBe(false)
  })
  it('retains the same geometry reference when only point locks change', () => {
    const h = new SurfaceHistory(), first = h.commit(frame())
    const locked = h.commit({ ...frame(), locks: [3, 1, 3] })
    expect(locked.net).toBe(first.net)
    expect(locked.locks).toEqual([1, 3])
    expect(h.step(-1)?.locks).toEqual([])
    expect(h.step(1)?.locks).toEqual([1, 3])
  })
  it('undoes and redoes geometry and discards the redo branch after a new edit', () => {
    const h = new SurfaceHistory()
    h.commit(frame()); h.commit(frame(1)); h.commit(frame(2))
    expect(h.step(-1)?.net.poles[0][2]).toBe(1)
    expect(h.step(1)?.net.poles[0][2]).toBe(2)
    expect(h.step(-1)?.net.poles[0][2]).toBe(1)
    h.commit(frame(3))
    expect(h.canRedo).toBe(false)
    expect(h.step(1)).toBeNull()
  })
  it('restores continuity and free-boundary settings with the correct frame', () => {
    const h = new SurfaceHistory()
    h.commit(frame())
    h.commit({ ...frame(), continuity: 'G0', freeBoundary: true })
    expect(h.step(-1)).toMatchObject({ continuity: 'G1', freeBoundary: false })
    expect(h.step(1)).toMatchObject({ continuity: 'G0', freeBoundary: true })
  })
  it('bounds history and reset drops all earlier frames', () => {
    const h = new SurfaceHistory(3)
    for (let i = 0; i < 4; i++) h.commit(frame(i))
    expect(h.step(-1)?.net.poles[0][2]).toBe(2)
    expect(h.step(-1)?.net.poles[0][2]).toBe(1)
    expect(h.step(-1)).toBeNull()
    h.reset()
    expect(h.current).toBeUndefined()
    expect(h.canUndo || h.canRedo).toBe(false)
  })
})
