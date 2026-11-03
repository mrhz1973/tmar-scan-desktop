// SPDX-License-Identifier: AGPL-3.0-only
// Diagnostic only: two isolated UI imports of a synthetic STEP box.
// The QA host is instrumented in memory; project source files are not changed.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

assert.equal(process.env.SCANRULER_ISOLATED, '1', 'SCANRULER_ISOLATED=1 is required')
const url = new URL(process.env.APP_URL ?? '')
assert.equal(url.href, 'http://127.0.0.1:17527/', 'Only the designated QA server is permitted')
const root = process.env.EDIT_SURFACE_QA_OUT
assert(root && isAbsolute(root), 'EDIT_SURFACE_QA_OUT must be an absolute path')
const rel = relative(resolve(process.cwd()), resolve(root))
assert(rel && (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)), 'Evidence must be outside the app checkout')
const maxAttempts = Number(process.env.DIAGNOSTIC_ATTEMPTS ?? '2')
assert(Number.isInteger(maxAttempts) && maxAttempts >= 1 && maxAttempts <= 2, 'DIAGNOSTIC_ATTEMPTS must be 1 or 2')
mkdirSync(root, { recursive: true })
const out = mkdtempSync(join(root, 'source-race-'))
process.env.SHOT_DIR = out
const { launchApp } = await import('../../../scripts/e2e-lib.mjs')
const { OcctKernel } = await import('occt-wasm')
const kernel = await OcctKernel.init()
const box = kernel.makeBox(20, 30, 10)
let step
try { step = kernel.exportStep(box) } finally { kernel.release(box) }
const input = join(out, 'synthetic-box.step')
writeFileSync(input, step)
const report = { scope:'UI import and Apply on a synthetic STEP box; isolated 17527 QA server',
  inputSha256:createHash('sha256').update(step).digest('hex'), attempts:[], verdict:'INCOMPLETE',
  caveat:'Runtime observation and call wrappers only; a passing QA development host does not qualify the compiled app.' }
const persist = () => writeFileSync(join(out, 'result.json'), JSON.stringify(report, null, 2))
persist()
try {
  for (const [attempt, delayMs] of [[1,0],[2,1500]].slice(0,maxAttempts)) {
    const item = { attempt, delayAfterImportMs:delayMs, events:[], verdict:'INCOMPLETE' }
    report.attempts.push(item); persist()
    let browser, page
    try {
      const app = await launchApp({ url:url.href, width:1440, height:1000, agentDataOk:false,
        userDataDir:join(out, 'owned-browser-' + attempt), protocolTimeout:120000 })
      browser = app.browser; page = app.page; item.consoleErrors = app.consoleErrors
      page.on('dialog', dialog => dialog.accept())
      await page.click('[data-test=workspace-reverse]')
      await page.waitForSelector('[data-test=feature-import]:enabled', {timeout:120000})
      await (await page.$('[data-test=feature-import-file]')).uploadFile(input)
      await page.waitForSelector('[data-test=import-create]:enabled', {timeout:120000})
      await page.click('[data-test=import-create]')
      await page.waitForSelector('[data-test=feature-edit-surface]:enabled', {timeout:120000})
      if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs))
      await page.evaluate(async () => {
        const { useReverse } = await import('/plugins/reverse/state/reStore.ts')
        const { useStore } = await import('/src/state/store.ts')
        const { useShell } = await import('/src/state/shellStore.ts')
        const { reverseSession } = await import('/plugins/reverse/app/reSession.ts')
        const { useWorkspaceEditor } = await import('/src/plugins/workspaceEditors.ts')
        const s = reverseSession()
        if (!s) throw Error('CAD session unavailable')
        const q = { useReverse, useStore, useShell, reverseSession, useWorkspaceEditor, events:[], baseline:null, seen:new WeakSet(), last:'' }
        window.sourceRace = q
        const text = value => { try { return JSON.stringify(value) } catch { return null } }
        const refs = [['reverse','features'],['reverse','rolledBack'],['reverse','stepFiles'],['reverse','parameters'],
          ['scan','appliedAlignment'],['scan','elements'],['scan','sections']]
        q.capture = () => {
          const reverse = useReverse.getState(), scan = useStore.getState(), client = s.client()
          const saved = { reverse, scan, client, session:s, bodyId:reverse.bodies[0]?.id,
            workspace:useShell.getState().workspace, serial:{} }
          for (const [group,key] of refs) saved.serial[group+'.'+key] = text(saved[group][key])
          q.baseline = saved
          return saved
        }
        q.record = (label, always = false, extra = {}) => {
          const baseline=q.baseline, reverse=useReverse.getState(), scan=useStore.getState(), session=reverseSession()
          const phase=useWorkspaceEditor.getState().phase, differences=[]
          if (baseline) {
            const compare=(name,actual,expected)=>{if(actual!==expected)differences.push({predicate:name,actual,expected})}
            compare('reverseSession',session===baseline.session,true)
            compare('client',s.client()===baseline.client,true)
            compare('documentEpoch',reverse.documentEpoch,baseline.reverse.documentEpoch)
            compare('buildVersion',reverse.buildVersion,baseline.reverse.buildVersion)
            compare('building',reverse.building,false)
            for (const [group,key] of refs) {
              const current=(group==='reverse'?reverse:scan)[key], original=baseline[group][key]
              if(current!==original)differences.push({predicate:group+'.'+key+'.identity',
                equalJson:text(current)!==null && text(current)===baseline.serial[group+'.'+key]})
            }
            for(const key of ['fileName','vertexCount','triangleCount']) compare('scan.'+key,scan[key],baseline.scan[key])
            compare('body-present',reverse.bodies.some(body=>body.id===baseline.bodyId),true)
            compare('workspace',useShell.getState().workspace,'reverse')
          }
          const signature=JSON.stringify([phase,differences])
          if(always || signature!==q.last) {
            if(q.events.length<600)q.events.push({label,t:performance.now(),phase,
              buildVersion:reverse.buildVersion,bodiesVersion:reverse.bodiesVersion,building:reverse.building,
              bodyIds:reverse.bodies.map(body=>body.id),differences,...extra})
            q.last=signature
          }
        }
        const originalClient = s.client.bind(s)
        s.client = () => {
          const client=originalClient()
          if(client && !q.seen.has(client)) {
            q.seen.add(client)
            const bodyEditSource=client.bodyEditSource.bind(client)
            client.bodyEditSource=async (...args)=>{
              q.capture();q.record('bodyEditSource:begin',true)
              try {const result=await bodyEditSource(...args);q.record('bodyEditSource:end',true,{bodyKey:result.bodyKey,stepLength:result.text.length});return result}
              catch(error){q.record('bodyEditSource:error',true,{error:String(error)});throw error}
            }
          }
          return client
        }
        const stage=s.stageEditorCopy.bind(s)
        s.stageEditorCopy=async (cad,name,assertCurrent,signal)=>{
          q.record('stage:begin',true,{stepLength:cad.length})
          const checked=()=>{
            q.record('assertCurrent:before',true)
            try {const result=assertCurrent();q.record('assertCurrent:ok',true);return result}
            catch(error){q.record('assertCurrent:FAILED',true,{error:String(error),stack:String(error?.stack ?? '')});throw error}
          }
          try {
            const prepared=await stage(cad,name,checked,signal);q.record('stage:ready',true)
            return {...prepared,publish:(...args)=>{
              q.record('publish:begin',true)
              try {const result=prepared.publish(...args);q.record('publish:ok',true);return result}
              catch(error){q.record('publish:FAILED',true,{error:String(error),stack:String(error?.stack ?? '')});throw error}
            }}
          } catch(error) {q.record('stage:FAILED',true,{error:String(error),stack:String(error?.stack ?? '')});throw error}
        }
        useReverse.subscribe(()=>q.record('reverse:changed'))
        useStore.subscribe(()=>q.record('scan:changed'))
        useShell.subscribe(()=>q.record('shell:changed'))
        useWorkspaceEditor.subscribe(()=>q.record('editor:changed'))
        q.record('instrumented',true)
      })
      await page.click('[data-test=feature-edit-surface]')
      await page.waitForSelector('[data-test=workspace-surface-parameters]', {timeout:120000})
      item.binding = await page.evaluate(() => {
        const c=window.sourceRace.useWorkspaceEditor.getState().controller
        return c?.source ?? null
      })
      const face = await page.$eval('[data-test=surface-face]', select =>
        [...select.options].find(option => option.value !== '' && !option.disabled && /plane/i.test(option.textContent))?.value)
      assert(face !== undefined,'No editable planar face')
      item.face=face
      await page.select('[data-test=surface-face]',face)
      await page.waitForSelector('[data-test=workspace-editor-apply]:enabled',{timeout:120000})
      const free=await page.evaluateHandle(()=>[...document.querySelectorAll('[data-test=workspace-surface-parameters] button')].find(e=>e.textContent==='Seleziona liberi'))
      assert(free.asElement(),'Select free points button unavailable')
      await free.asElement().click()
      await page.select('[data-test=surface-drag-mode]','local')
      await page.click('[data-test=surface-axis-2]')
      await page.$eval('[data-test=surface-distance]', element=>{
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,'0.05')
        element.dispatchEvent(new Event('input',{bubbles:true}))
      })
      await page.click('[data-test=surface-move]')
      await page.waitForSelector('[data-test=surface-undo]:enabled',{timeout:120000})
      await page.waitForSelector('[data-test=workspace-editor-apply]:enabled',{timeout:120000})
      await page.evaluate(()=>window.sourceRace.record('apply:click',true))
      await page.click('[data-test=workspace-editor-apply]')
      try {
        await page.waitForFunction(()=>{
          const state=window.sourceRace.useWorkspaceEditor.getState()
          return (state.phase==='closed' && (!!state.receipt || !!state.error)) || (state.phase==='editing' && !!state.error)
        },{timeout:120000})
      } catch(error) { item.waitError=String(error) }
      const result=await page.evaluate(()=>{
        const q=window.sourceRace, state=q.useWorkspaceEditor.getState()
        q.record('attempt:end',true,{error:state.error,receipt:!!state.receipt})
        return {phase:state.phase,error:state.error,receipt:state.receipt,events:q.events,baselineCaptured:!!q.baseline}
      })
      Object.assign(item,result)
      item.verdict = !result.baselineCaptured ? 'INCONCLUSIVE_NO_BASELINE' :
        result.receipt && result.phase==='closed' ? 'PUBLISHED' :
        result.error?.includes('La sorgente CAD o il documento è cambiato') ? 'SOURCE_GUARD_REJECTED' : 'INCONCLUSIVE'
      if(item.verdict!=='PUBLISHED') await page.screenshot({path:join(out,'attempt-'+attempt+'-failure.png')})
    } catch(error) {
      item.error=String(error?.stack ?? error)
      if(page) {
        try {item.events=await page.evaluate(()=>window.sourceRace?.events ?? [])} catch { /* preserve original error */ }
        try {await page.screenshot({path:join(out,'attempt-'+attempt+'-error.png')})} catch { /* optional */ }
      }
      item.verdict='INCONCLUSIVE'
    } finally { if(browser) await browser.close(); persist() }
    console.log(JSON.stringify({attempt:item.attempt,verdict:item.verdict,phase:item.phase,error:item.error,events:item.events.length}))
  }
  report.verdict = report.attempts.some(a=>a.verdict==='SOURCE_GUARD_REJECTED') ? 'GUARD_REPRODUCED' :
    report.attempts.every(a=>a.verdict==='PUBLISHED') ? 'NOT_REPRODUCED' : 'INCONCLUSIVE'
} finally {
  kernel[Symbol.dispose]()
  persist()
  console.log(JSON.stringify({out,verdict:report.verdict}))
}
