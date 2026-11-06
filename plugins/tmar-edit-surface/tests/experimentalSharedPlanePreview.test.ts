// SPDX-License-Identifier: AGPL-3.0-only
import {expect,it,vi} from 'vitest'
import type {Net} from '../brep'
import type {ExperimentalSharedPlaneSession} from '../experimentalSharedPlaneSession'
import type {WorkspacePreview} from '../workspacePreview'
import {ExperimentalSharedPlanePreview} from '../experimentalSharedPlanePreview'

it('never replaces a newer preview with an older worker response',async()=>{
  const pending:{resolve:(v:unknown)=>void}[]=[]
  const session={prepare:async()=>({} as Net),evaluate:()=>new Promise(resolve=>pending.push({resolve})),dispose:vi.fn()}
  const view={clear:vi.fn(),setPreview:vi.fn(),setVisible:vi.fn(),dispose:vi.fn()}
  const preview=new ExperimentalSharedPlanePreview(session as unknown as ExperimentalSharedPlaneSession,view as unknown as WorkspacePreview)
  await preview.prepare('step',0)
  const older=preview.update({} as Net),rejected=expect(older).rejects.toThrow(/superata/)
  const newer=preview.update({} as Net)
  pending[1].resolve({faceMeshes:[{id:'new'}],previewFace:0});await newer
  pending[0].resolve({faceMeshes:[{id:'old'}],previewFace:0});await rejected
  expect(view.setPreview).toHaveBeenCalledTimes(1)
  expect(view.setPreview).toHaveBeenCalledWith({faceMeshes:[{id:'new'}]},0)
  const late=preview.update({} as Net),lateRejected=expect(late).rejects.toThrow(/superata/)
  preview.dispose();pending[2].resolve({faceMeshes:[{}],previewFace:0});await lateRejected
  expect(view.setPreview).toHaveBeenCalledTimes(1);expect(view.dispose).toHaveBeenCalledOnce()
})

it('retries preview cleanup after a transient mask restore failure',()=>{
  const session={dispose:vi.fn()},view={dispose:vi.fn().mockImplementationOnce(()=>{throw new Error('restore failed')})}
  const preview=new ExperimentalSharedPlanePreview(session as unknown as ExperimentalSharedPlaneSession,view as unknown as WorkspacePreview)
  expect(()=>preview.dispose()).toThrow('restore failed')
  expect(()=>preview.dispose()).not.toThrow()
  expect(session.dispose).toHaveBeenCalledOnce();expect(view.dispose).toHaveBeenCalledTimes(2)
})
