// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { workspacePoleDragMode } from '../workspacePoleDragMode'

describe('direct selected yellow pole LMB drag in Versione 6', () => {
  it.each(['axis','local','screen'] as const)(
    'dragging an already-selected pole uses the view plane instead of %s mode',
    current => expect(workspacePoleDragMode(current,false,false,1,true)).toBe('screen'),
  )
  it.each(['axis','local'] as const)(
    'first picking an unselected point preserves %s constraints and existing snap behavior',
    current => expect(workspacePoleDragMode(current,false,false,1,false)).toBe(current),
  )

  it('keeps individual gizmo axes constrained, including local U/V/N', () => {
    expect(workspacePoleDragMode('axis',true,false,1,true)).toBe('axis')
    expect(workspacePoleDragMode('local',true,false,1,true)).toBe('local')
  })

  it('does not change whole-face or multi-pole cell and edge interactions', () => {
    expect(workspacePoleDragMode('axis',false,true,25,true)).toBe('axis')
    expect(workspacePoleDragMode('local',false,true,1,true)).toBe('local')
    expect(workspacePoleDragMode('axis',false,false,4,true)).toBe('axis')
    expect(workspacePoleDragMode('local',false,false,2,true)).toBe('local')
  })

  it('does not synthesize gestures when nothing was picked', () => {
    expect(workspacePoleDragMode('axis',false,false,0,false)).toBe('axis')
  })
})
