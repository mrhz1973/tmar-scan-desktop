// SPDX-License-Identifier: AGPL-3.0-only
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import meshPlugin from '../../mesh-tools/plugin'
import { useMeshTools } from '../../mesh-tools/state/meshStore'
import { collectProject, prepareProjectState } from '../../../src/app/project'
import { validateManifest } from '../../../src/core/project/manifest'
import { fresh, sources } from '../../../tests/projectKit'
beforeAll(()=>meshPlugin.install?.());beforeEach(fresh)
describe('Smooth intensity project compatibility',()=>{
 it('persists settings and the strength actually applied',()=>{
   useMeshTools.setState({smoothStrength:.4,pending:[{kind:'smooth',size:1,limit:.02,maxMove:.005,strength:.4,region:12}]})
   const json=JSON.parse(JSON.stringify(collectProject(sources(),null,'0.9.4').manifest))
   expect(json.mesh.smooth.strength).toBe(.4)
   useMeshTools.setState({smoothStrength:.9})
   prepareProjectState(validateManifest(json))()
   expect(useMeshTools.getState().smoothStrength).toBe(.4)
 })
 it('reads old Smooth settings as full strength',()=>{
   const json=JSON.parse(JSON.stringify(collectProject(sources(),null,'0.9.4').manifest))
   delete json.mesh.smooth.strength;useMeshTools.setState({smoothStrength:.2})
   prepareProjectState(validateManifest(json))();expect(useMeshTools.getState().smoothStrength).toBe(1)
 })
 it.each([-1,2,'strong',null])('refuses invalid saved intensity %s',strength=>{
   const json=JSON.parse(JSON.stringify(collectProject(sources(),null,'0.9.4').manifest))
   json.mesh.smooth.strength=strength
   expect(()=>prepareProjectState(validateManifest(json))).toThrow(/Malformed/)
 })
})
