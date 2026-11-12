// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { workspacePoleDragMode } from '../workspacePoleDragMode'

describe('direct pole LMB drag in Versione 5', () => {
  it.each(['axis','local','screen'] as const)(
    'grabbing one point directly uses the view plane, regardless of %s numeric mode',
    current => expect(workspacePoleDragMode(current,false,false,1)).toBe('screen'),
  )

  it('keeps individual gizmo axes constrained, including local U/V/N', () => {
    expect(workspacePoleDragMode('axis',true,false,1)).toBe('axis')
    expect(workspacePoleDragMode('local',true,false,1)).toBe('local')
  })

  it('does not change whole-face or multi-pole cell and edge interactions', () => {
    expect(workspacePoleDragMode('axis',false,true,25)).toBe('axis')
    expect(workspacePoleDragMode('local',false,true,1)).toBe('local')
    expect(workspacePoleDragMode('axis',false,false,4)).toBe('axis')
    expect(workspacePoleDragMode('local',false,false,2)).toBe('local')
  })

  it('does not synthesize gestures when nothing was picked', () => {
    expect(workspacePoleDragMode('axis',false,false,0)).toBe('axis')
  })
})
