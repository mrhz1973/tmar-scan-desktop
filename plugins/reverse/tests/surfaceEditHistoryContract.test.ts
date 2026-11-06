// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'vitest'
import { SurfaceEditorKernel } from '../../tmar-edit-surface/editorKernel'
import { editorSha256 } from '../../../src/plugins/editorLifetime'
import type { ImportFeature } from '../core/features'
import { stepFileKey } from '../core/features'
import {
  canonicalHistoryJson, claimQualifiedSurfaceHistory, qualifySurfaceHistory, bindIndependentPluginReplay,
  readStoredSurfaceHistory, reopenSurfaceHistory,
} from '../app/surfaceEditHistory'
import type { SourceBinding } from '../../../src/plugins/workspaceEditorTypes'

const enc=(s:string)=>new TextEncoder().encode(s)
const hash=(s:string)=>editorSha256(enc(s))
describe('opt-in host surface-edit history envelope',()=>{
  it('qualifies exact replay, retains source for save/reopen and refuses stale/tampered projects',async()=>{
    const editor=await SurfaceEditorKernel.load(),k=editor.kernel
    const box=k.makeBox(20,30,10),sourceText=k.exportStep(box);k.release(box)
    try{
      const faces=editor.open(sourceText).faces
      const face=faces.find(f=>editor.select(f.index).poles.every(p=>Math.abs(p[2]-10)<1e-6))!
      const net=editor.select(face.index)
      net.poles[12][2]+=1
      const recipe=await editor.createRecipe(net,'G1',[], 'qualified-body')
      const firstReplay=await editor.replayRecipe(sourceText,recipe,'qualified-body')
      expect(firstReplay.valid).toBe(true)
      const resultText=firstReplay.step!
      const binding:SourceBinding={documentEpoch:'doc',sourceEpoch:5,bodyId:1,bodyKey:'qualified-body',
        buildVersion:7,kernelGeneration:11,frameRevision:7,stepSha256:await hash(sourceText),
        units:'mm',coordinateFrame:'part'}
      const stamp={recipe,sessionId:'session',sourceKey:JSON.stringify([
        binding.documentEpoch,binding.sourceEpoch,binding.bodyId,binding.bodyKey,binding.buildVersion,
        binding.kernelGeneration,binding.frameRevision,binding.stepSha256,binding.units,binding.coordinateFrame
      ]),selectionEpoch:2,draftEpoch:4}
      let current=true,sourceCurrent=true
      const args={
        source:{binding,step:enc(sourceText),assertCurrent:()=>{if(!sourceCurrent)throw Error('source changed')}},
        prepared:stamp,isStampCurrent:()=>current,resultStep:enc(resultText),noteCount:0,
        replay:async(step:string,r:unknown,key:string)=> (await editor.replayRecipe(step,r,key)).step!,
        signal:new AbortController().signal,
      }
      const qualified=await qualifySurfaceHistory(args)
      expect(qualified.record.recipeSha256).toMatch(/^[0-9a-f]{64}$/)
      expect(qualified.record.source.bodyKey).toBe('qualified-body')
      expect(readStoredSurfaceHistory(qualified.record)).toEqual(qualified.record)
      // A single imported feature can create multiple bodies: the second
      // has an exact positive fractional ID, not a feature/index counter.
      const fractionalRecord = { ...qualified.record,
        source: { ...qualified.record.source, bodyId: 1 + 1 / 1024 } }
      expect(readStoredSurfaceHistory(fractionalRecord).source.bodyId).toBe(1.0009765625)
      for (const invalid of [Number.NaN, Infinity, -Infinity, 0, -1, '1.0009765625']) {
        expect(() => readStoredSurfaceHistory({ ...qualified.record,
          source: { ...qualified.record.source, bodyId: invalid } })).toThrow('Sorgente STEP')
      }
      const feature={id:2,kind:'import',name:'edited',visible:true,
        file:{key:stepFileKey(resultText),name:'edited.step',size:resultText.length},
        surfaceEditHistory:JSON.parse(JSON.stringify(qualified.record))} as ImportFeature
      const files={[feature.file.key]:resultText,[qualified.record.source.file.key]:sourceText}
      const verified=await reopenSurfaceHistory(feature,files,args.replay,args.signal)
      expect(verified.status).toBe('verified')
      expect((await reopenSurfaceHistory(feature,files,undefined,args.signal)).status).toBe('copy-only')
      expect((await reopenSurfaceHistory({...feature,surfaceEditHistory:{...qualified.record,recipe:{...recipe,source:{...recipe.source,bodyId:'forged'}}}},files,args.replay,args.signal)).status).toBe('copy-only')
      expect((await reopenSurfaceHistory(feature,{...files,[feature.file.key]:'ISO-10303-21; changed'},args.replay,args.signal)).status).toBe('copy-only')
      expect((await reopenSurfaceHistory(feature,{...files,[qualified.record.source.file.key]:'ISO-10303-21; changed'},args.replay,args.signal)).status).toBe('copy-only')
      expect(files[feature.file.key]).toBe(resultText) // Restore failure must not delete the saved copy.
      expect(()=>claimQualifiedSurfaceHistory({...qualified})).toThrow('senza replay')
      expect(claimQualifiedSurfaceHistory(qualified)).toBe(qualified)
      expect(()=>claimQualifiedSurfaceHistory(qualified)).toThrow('senza replay')
      await expect(qualifySurfaceHistory({...args,noteCount:1})).rejects.toThrow('note')
      current=false
      await expect(qualifySurfaceHistory(args)).rejects.toThrow('non è più corrente')
      current=true
      await expect(qualifySurfaceHistory({...args,replay:async()=>{sourceCurrent=false;return resultText}})).rejects.toThrow('source changed')
    }finally{editor.dispose()}
  },120_000)
  it('adapts a separately supplied plugin worker replay and checks source freshness',async()=>{
    const step='ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;'
    const bytes=new TextEncoder().encode(step)
    let current=true,called=0
    const adapter=bindIndependentPluginReplay(async(source,recipe)=>{
      called++
      expect(source.bodyKey).toBe('body-qa')
      expect(source.stepSha256).toBe(await editorSha256(bytes))
      expect(new TextDecoder().decode(source.step)).toBe(step)
      expect(recipe).toEqual({version:2})
      source.assertCurrent()
      return {valid:true,step}
    },()=>{if(!current)throw Error('source changed')})
    expect(await adapter(step,{version:2},'body-qa',new AbortController().signal)).toBe(step)
    current=false
    await expect(adapter(step,{version:2},'body-qa',new AbortController().signal)).rejects.toThrow('source changed')
    expect(called).toBe(1)
  })
  it('canonicalizes JSON independently of key order and refuses invalid payload',()=>{
    expect(canonicalHistoryJson({b:2,a:{z:'-0',x:[3,2,1]}}))
      .toBe(canonicalHistoryJson({a:{x:[3,2,1],z:'-0'},b:2}))
    expect(()=>canonicalHistoryJson({bad:Infinity})).toThrow('JSON puro')
    const cycle:Record<string,unknown>={};cycle.self=cycle
    expect(()=>canonicalHistoryJson(cycle)).toThrow('ciclici')
    expect(()=>readStoredSurfaceHistory({schema:'tmar.host.surface-edit-history',version:99})).toThrow()
  })
})
