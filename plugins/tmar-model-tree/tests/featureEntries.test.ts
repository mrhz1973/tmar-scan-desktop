// SPDX-License-Identifier: AGPL-3.0-only
import { Fragment, createElement as h } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { FeatureRowExtension, featureListEntries } from '../../reverse/app/listExtensions'

describe('explicit feature-row adapters', () => {
  it('offers tagged native rows in source order, without rollback controls', () => {
    const first = h('span', null, 'First sketch'), second = h('span', null, 'Body operation')
    const rows = featureListEntries(h('div', null, h('h3', null, 'History'), h(Fragment, null,
      h(FeatureRowExtension, { id: 7 }, first), h('button', null, 'Rollback'),
      h(FeatureRowExtension, { id: 3 }, second))))
    expect(rows).toEqual([{ id: 7, content: first }, { id: 3, content: second }])
  })
  it('does not guess feature IDs from React keys or plain DOM attributes', () => {
    expect(featureListEntries(h('div', { key: '9', 'data-feature-id': '9' }, 'Not tagged'))).toEqual([])
  })
  it('does not execute opaque components while collecting rows', () => {
    const render = vi.fn(() => h(FeatureRowExtension, { id: 1 }, 'Opaque'))
    const Opaque = render
    expect(featureListEntries(h(Opaque))).toEqual([])
    expect(render).not.toHaveBeenCalled()
  })
  it('retains duplicate tags for the consumer to reject, rather than silently merging them', () => {
    const rows = featureListEntries([h(FeatureRowExtension, { key: 'a', id: 1 }, 'A'), h(FeatureRowExtension, { key: 'b', id: 1 }, 'B')])
    expect(rows.map((row) => row.id)).toEqual([1, 1])
  })
})
