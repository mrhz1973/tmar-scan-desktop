// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net } from '../brep'
import { updateAdaptiveLocks, validateAdaptiveLocks } from '../adaptiveLockSnapshot'

const makeNet = (): Net => ({ nu: 2, nv: 2, du: 1, dv: 1, ku: [0, 1], kv: [0, 1],
  mu: [2, 2], mv: [2, 2], poles: [[0, 0, 0], [0, 1, 0], [1, 0, 0], [1, 1, 0]],
  weights: [1, 1, 1, 1], rational: [0, 0] })

it('captures a moved point and rejects subsequent movement', () => {
  const net = makeNet(); net.poles[0] = [2, 3, 4]
  const locks = updateAdaptiveLocks(net, [], [0])
  expect(locks[0].point).toEqual([2, 3, 4]); validateAdaptiveLocks(net, locks)
  net.poles[0] = [2, 3, 5]
  expect(() => validateAdaptiveLocks(net, locks)).toThrow()
  expect(() => updateAdaptiveLocks(net, locks, [])).toThrow()
})

it('captures a fresh position after unlock and relock, without aliasing', () => {
  const net = makeNet(), first = updateAdaptiveLocks(net, [], [0])
  const unlocked = updateAdaptiveLocks(net, first, [])
  net.poles[0][0] = 10
  const second = updateAdaptiveLocks(net, unlocked, [0])
  expect(first[0].point).toEqual([0, 0, 0]); expect(second[0].point).toEqual([10, 0, 0])
  expect(Object.isFrozen(second)).toBe(true); expect(Object.isFrozen(second[0].point)).toBe(true)
  net.poles[0][0] = 11; expect(second[0].point[0]).toBe(10)
})

it('rejects invalid indices, duplicate locks and non-finite coordinates', () => {
  const net = makeNet()
  expect(() => updateAdaptiveLocks(net, [], [0, 0])).toThrow()
  expect(() => updateAdaptiveLocks(net, [], [-0])).toThrow()
  expect(() => updateAdaptiveLocks(net, [], [4])).toThrow()
  net.poles[0][1] = NaN
  expect(() => updateAdaptiveLocks(net, [], [0])).toThrow()
  expect(() => validateAdaptiveLocks(makeNet(), [{index: 0, point: [0, 0, 0]}, {index: 0, point: [0, 0, 0]}])).toThrow()
})
