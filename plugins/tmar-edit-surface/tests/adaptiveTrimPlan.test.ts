// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { adaptiveTrimPlan } from '../adaptiveTrimPlan'

describe('adaptive trimmed-plane candidate plan',()=>{
  it('constructs a bounded plan from relative contour dimensions',()=>{
    const plan=adaptiveTrimPlan([0,10,0,10],[.2,9.9,.1,9.9])
    expect(plan).toHaveLength(48)
    const u=plan.filter(p=>p.axis==='U'),v=plan.filter(p=>p.axis==='V')
    expect(u).toHaveLength(24);expect(v).toHaveLength(24)
    expect(u.every(p=>p.value>0&&p.value<.25&&p.count===1)).toBe(true)
    expect(v.every(p=>p.value>4.4&&p.value<5.6&&p.count===1)).toBe(true)
    expect(new Set(plan.map(p=>`${p.axis}:${p.value}`)).size).toBe(48)
  })
  it('rejects invalid domains, missing clearance and unqualified broad gaps',()=>{
    expect(()=>adaptiveTrimPlan([0,0,0,1],[0,0,0,1])).toThrow()
    expect(()=>adaptiveTrimPlan([0,10,0,10],[-1,9,1,9])).toThrow()
    expect(()=>adaptiveTrimPlan([0,10,0,10],[0,10,0,10])).toThrow()
    expect(()=>adaptiveTrimPlan([0,10,0,10],[3,7,3,7])).toThrow()
    expect(()=>adaptiveTrimPlan([0,10,0,10],[NaN,9,1,9])).toThrow()
  })
})
