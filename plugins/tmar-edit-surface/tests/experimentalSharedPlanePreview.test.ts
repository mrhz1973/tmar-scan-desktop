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
  expect(()=>preview.dispose()).toThrow(/chiusura/i)
  expect(()=>preview.dispose()).not.toThrow()
  expect(session.dispose).toHaveBeenCalledOnce();expect(view.dispose).toHaveBeenCalledTimes(2)
})

it('coalesces a burst of drag updates before asking the CAD worker',async()=>{
  vi.useFakeTimers()
  const pending:{net:Net;resolve:(v:unknown)=>void}[]=[]
  const session={prepare:async()=>({} as Net),evaluate:(net:Net)=>new Promise(resolve=>pending.push({net,resolve})),dispose:vi.fn()}
  const view={clear:vi.fn(),setPreview:vi.fn(),setVisible:vi.fn(),dispose:vi.fn()}
  const preview=new ExperimentalSharedPlanePreview(session as unknown as ExperimentalSharedPlaneSession,view as unknown as WorkspacePreview)
  try {
    await preview.prepare('step',0)
    preview.schedule({tag:1} as unknown as Net);await vi.advanceTimersByTimeAsync(90)
    expect(pending).toHaveLength(1)
    preview.schedule({tag:2} as unknown as Net);preview.schedule({tag:3} as unknown as Net)
    expect(pending).toHaveLength(1)
    pending[0].resolve({faceMeshes:[{id:'old'}],previewFace:0});await Promise.resolve();await Promise.resolve()
    expect(pending).toHaveLength(2);expect(pending[1].net).toEqual({tag:3})
    expect(view.setPreview).not.toHaveBeenCalled()
    pending[1].resolve({faceMeshes:[{id:'last'}],previewFace:0});await Promise.resolve();await Promise.resolve()
    expect(view.setPreview).toHaveBeenCalledWith({faceMeshes:[{id:'last'}]},0)
    expect(preview.getSnapshot().validRevision).toBe(preview.getSnapshot().current?.revision)
    expect(preview.displayedRevision).toBe(preview.getSnapshot().validRevision)
  } finally {preview.dispose();vi.useRealTimers()}
})

it('keeps displayed revision invalid when the renderer fails',async()=>{
  vi.useFakeTimers()
  const session={prepare:async()=>({} as Net),evaluate:async()=>({faceMeshes:[{}],previewFace:0}),dispose:vi.fn()}
  const view={clear:vi.fn(),setPreview:vi.fn(()=>{throw new Error('render')}),setVisible:vi.fn(()=>{throw new Error('mask')}),dispose:vi.fn()}
  const preview=new ExperimentalSharedPlanePreview(session as unknown as ExperimentalSharedPlaneSession,view as unknown as WorkspacePreview)
  try {
    await preview.prepare('step',0);preview.schedule({} as Net);await vi.advanceTimersByTimeAsync(90)
    expect(preview.getSnapshot().validRevision).not.toBeNull()
    expect(preview.displayedRevision).toBe(0)
    expect(preview.displayError).toBeInstanceOf(AggregateError)
    expect(view.setVisible).toHaveBeenLastCalledWith(false)
  } finally {preview.dispose();vi.useRealTimers()}
})

it('still disposes the worker session and renderer when a queue listener throws',()=>{
  const session={dispose:vi.fn()},view={dispose:vi.fn()}
  const preview=new ExperimentalSharedPlanePreview(session as unknown as ExperimentalSharedPlaneSession,view as unknown as WorkspacePreview)
  preview.subscribe(()=>{throw new Error('listener')})
  expect(()=>preview.dispose()).toThrow(/chiusura/i)
  expect(session.dispose).toHaveBeenCalledOnce();expect(view.dispose).toHaveBeenCalledOnce()
})

it('clears an old display error after a successful direct update and clears display state on close',async()=>{
  vi.useFakeTimers()
  const session={prepare:async()=>({} as Net),evaluate:async()=>({faceMeshes:[{}],previewFace:0}),dispose:vi.fn()}
  let fail=true
  const view={clear:vi.fn(),setPreview:vi.fn(()=>{if(fail)throw new Error('render')}),setVisible:vi.fn(),dispose:vi.fn()}
  const preview=new ExperimentalSharedPlanePreview(session as unknown as ExperimentalSharedPlaneSession,view as unknown as WorkspacePreview)
  try {
    await preview.prepare('step',0);preview.schedule({} as Net);await vi.advanceTimersByTimeAsync(90)
    expect(preview.displayError).toBeInstanceOf(Error)
    fail=false;await preview.update({} as Net)
    expect(preview.displayError).toBeNull()
    preview.schedule({} as Net);await vi.advanceTimersByTimeAsync(90)
    expect(preview.displayedRevision).not.toBe(0)
    preview.dispose()
    expect(preview.displayedRevision).toBe(0)
  } finally {preview.dispose();vi.useRealTimers()}
})

it('reports both the CAD failure and failure to restore the original during direct update',async()=>{
  const cad=new Error('CAD failure'),restore=new Error('restore failure')
  const session={prepare:async()=>({} as Net),evaluate:async()=>{throw cad},dispose:vi.fn()}
  const view={clear:vi.fn(),setVisible:vi.fn(()=>{throw restore}),dispose:vi.fn()}
  const preview=new ExperimentalSharedPlanePreview(session as unknown as ExperimentalSharedPlaneSession,view as unknown as WorkspacePreview)
  await preview.prepare('step',0)
  let failure:unknown
  try {await preview.update({} as Net)} catch(error) {failure=error}
  expect(failure).toBeInstanceOf(AggregateError)
  expect((failure as AggregateError).errors).toEqual([cad,restore])
  expect(preview.displayError).toBe(failure)
  expect(preview.displayedRevision).toBe(0)
  preview.dispose()
})
