// SPDX-License-Identifier: AGPL-3.0-only
import { Fragment } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { FeatureRowExtension, featureListEntries } from '../../reverse/app/listExtensions'

describe('explicit feature-row adapters', () => {
  it('offers tagged native rows in source order, without rollback controls', () => {
    const first = <span>First sketch</span>, second = <span>Body operation</span>
    const rows = featureListEntries(<div><h3>History</h3><Fragment>
      <FeatureRowExtension id={7}>{first}</FeatureRowExtension><button>Rollback</button>
      <FeatureRowExtension id={3}>{second}</FeatureRowExtension>
    </Fragment></div>)
    expect(rows).toEqual([{ id: 7, content: first }, { id: 3, content: second }])
  })
  it('does not guess feature IDs from React keys or plain DOM attributes', () => {
    expect(featureListEntries(<div key="9" data-feature-id="9">Not tagged</div>)).toEqual([])
  })
  it('does not execute opaque components while collecting rows', () => {
    const render = vi.fn(() => <FeatureRowExtension id={1}>Opaque</FeatureRowExtension>)
    const Opaque = render
    expect(featureListEntries(<Opaque/>)).toEqual([])
    expect(render).not.toHaveBeenCalled()
  })
  it('retains duplicate tags for the consumer to reject, rather than silently merging them', () => {
    const rows = featureListEntries([<FeatureRowExtension key="a" id={1}>A</FeatureRowExtension>, <FeatureRowExtension key="b" id={1}>B</FeatureRowExtension>])
    expect(rows.map((row) => row.id)).toEqual([1, 1])
  })
})
