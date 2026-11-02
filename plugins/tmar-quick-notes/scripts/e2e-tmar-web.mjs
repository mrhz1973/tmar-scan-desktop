// SPDX-License-Identifier: AGPL-3.0-only
// Synthetic fixtures only. Owns an ephemeral server and an isolated headless
// browser unless APP_URL is supplied. Never connects to a real MCP server.
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const ownServer = !process.env.APP_URL
const server = ownServer ? await createServer({ root, server: { host: '127.0.0.1', port: 0, open: false, watch: { ignored: ['**/e2e-out/**'] } } }) : null
if (server) { await server.listen(); process.env.APP_URL = server.resolvedUrls.local[0] }
const { launchApp, check, fail, finish, sleep, OUT_DIR, shotPath } = await import('../../../scripts/e2e-lib.mjs')
const downloads = mkdtempSync(join(OUT_DIR, 'tmar-web-'))
let browser, page, consoleErrors = []

function boxStl(lo, hi, n = 6) {
  const tris = []
  for (const [axis, side, u, v] of [[0,0,2,1],[0,1,1,2],[1,0,0,2],[1,1,2,0],[2,0,1,0],[2,1,0,1]]) {
    const at = (i, j) => {
      const p = [0,0,0]; p[axis] = side ? hi[axis] : lo[axis]
      p[u] = lo[u] + (hi[u]-lo[u])*i/n; p[v] = lo[v]+(hi[v]-lo[v])*j/n; return p
    }
    for (let i=0;i<n;i++) for(let j=0;j<n;j++) tris.push([at(i,j),at(i+1,j),at(i+1,j+1)],[at(i,j),at(i+1,j+1),at(i,j+1)])
  }
  const out = Buffer.alloc(84+50*tris.length); out.writeUInt32LE(tris.length,80)
  tris.forEach((tri,i)=>tri.forEach((v,k)=>v.forEach((x,j)=>out.writeFloatLE(x,84+i*50+12+k*12+j*4))))
  return out
}

function stlBounds(bytes) {
  const count=bytes.readUInt32LE(80), min=[Infinity,Infinity,Infinity], max=[-Infinity,-Infinity,-Infinity]
  if (bytes.length!==84+count*50) throw new Error('Malformed downloaded STL')
  for(let i=0;i<count;i++) for(let v=0;v<3;v++) for(let k=0;k<3;k++) {
    const x=bytes.readFloatLE(84+i*50+12+v*12+k*4); min[k]=Math.min(min[k],x); max[k]=Math.max(max[k],x)
  }
  return { count,min,max }
}

try {
  ({ browser, page, consoleErrors } = await launchApp({ width: 1600, height: 1100, protocolTimeout: 600_000 }))
  // Accept discard prompts only inside this disposable synthetic test profile.
  page.on('dialog', (dialog) => dialog.accept())
  console.log('ENV:', JSON.stringify({ node: process.version, platform: process.platform, browser: await browser.version() }))
  const cdp=await browser.target().createCDPSession()
  await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads,eventsEnabled:true})
  const call=(name,args={})=>page.evaluate(async(name,args)=>{
    const {registerCoreCommands}=await import('/src/commands/core.ts')
    registerCoreCommands()
    const {runCommand}=await import('/src/commands/registry.ts')
    if(args.bytes) args.bytes=new Uint8Array(args.bytes)
    return runCommand(name,args)
  },name,args)
  await call('scan.open',{bytes:Array.from(boxStl([-2,-2,0],[42,22,14])),name:'synthetic-scan.stl',units:'mm'})
  await page.click('[data-test=workspace-reverse]')
  await page.waitForFunction(()=>/ready/.test(document.querySelector('[data-test=kernel-status]')?.textContent??''),{timeout:180_000})
  const block=async(name,x,y,width,depth,height)=>{
    const points=[[x,y],[x+width,y],[x+width,y+depth],[x,y+depth]]
    await call('reverse.feature.add',{feature:{kind:'sketch',name:name+' profile',plane:{kind:'world',axis:'z'},sketch:{
      entities:points.map((a,i)=>({id:i+1,kind:'line',a,b:points[(i+1)%4]})),
      constraints:points.map((_,i)=>({kind:'coincident',p:{entity:i+1,at:'b'},q:{entity:(i+1)%4+1,at:'a'}})),
    }}})
    return call('reverse.feature.add',{feature:{kind:'extrude',name,sketchId:name+' profile',extent:{kind:'distance',from:0,to:height},op:'new'}})
  }
  await block('Main solid',0,0,40,20,10)
  await block('Separate solid',60,0,10,10,5)
  const ids=await page.evaluate(()=>window.__re.store.getState().bodies.map(b=>b.id))
  check(ids.length===2,'two CAD solids are built over a differently sized synthetic scan')
  await page.click('[data-test=export-body]')
  await page.select('[data-test=body-export-format]','stl')
  await page.select('[data-test=body-stl-scope]','selected')
  check(await page.$eval('[data-test=export-body-save]',b=>b.disabled),'empty explicit body selection disables export instead of exporting all')
  await page.evaluate(id=>window.__re.store.getState().setListSelection({bodies:[id],folders:[]}),ids[0])
  await page.waitForFunction(()=>!document.querySelector('[data-test=export-body-save]')?.disabled)
  await page.click('[data-test=export-body-save]')
  for(let i=0;i<300&&!readdirSync(downloads).some(f=>f.endsWith('.stl'));i++) await sleep(100)
  const file=readdirSync(downloads).find(f=>f.endsWith('.stl'))
  if(!file) throw new Error('The body STL button did not download a file')
  const b=stlBounds(readFileSync(join(downloads,file)))
  check(b.count===12 && JSON.stringify(b.min)==='[0,0,0]' && JSON.stringify(b.max)==='[40,20,10]',`download is the selected CAD body, not scan or other body: ${JSON.stringify(b)}`)
  await page.click('[data-test=export-body]')
  check((await page.$$eval('[data-test=body-export-format] option', rows => rows.map(r => r.value))).includes('step'),'STEP is available from the unified export dialog')
  await page.keyboard.press('Escape')
  await page.screenshot({path:shotPath('tmar-body-stl.png')})

  // Enable the existing visibility preference in this isolated fixture, with
  // an inert socket: no real local agent/session is contacted by this test.
  await page.evaluate(async()=>{
    class InertSocket extends EventTarget {
      static CONNECTING=0; static OPEN=1; static CLOSING=2; static CLOSED=3
      readyState=0; close(){this.readyState=3} send(){}
    }
    window.WebSocket=InertSocket
    const {usePrefs}=await import('/src/state/prefsStore.ts')
    usePrefs.setState({agentLink:true})
  })
  await page.evaluate(id=>window.__re.store.getState().setBodiesVisible([id],false),ids[1])
  await call('reverse.body.compare_in_deviation')
  await page.waitForSelector('[data-test=tmar-deviation-notes]')
  await call('view.set',{view:'top',fit:true})
  await page.waitForFunction(()=>!document.querySelector('[data-test=note-add]')?.disabled,{timeout:60_000})
  const before=await page.evaluate(async()=>{
    const {useDeviation}=await import('/src/state/deviationStore.ts')
    const d=useDeviation.getState()
    return {mapVersion:d.mapVersion, mapStatus:d.mapStatus, pins:d.pins?.length??0}
  })
  await page.click('[data-test=note-add]')
  check(await page.$eval('[data-test=note-add]',b=>b.getAttribute('aria-pressed'))==='true','Note arms in Deviation without switching workspace')
  const [x,y]=await page.evaluate(()=>window.__re.reScene().bodyPicks.screenProjection()(12,8,14))
  await page.mouse.click(x,y)
  await page.waitForSelector('[data-test=note-text]',{timeout:5000})
  await page.type('[data-test=note-text]','Synthetic mismatch: scan top is 4 mm above the body.')
  await page.click('[data-test=note-keep]')
  const observed=await page.evaluate(async()=>{
    const {useDeviation}=await import('/src/state/deviationStore.ts')
    const {useShell}=await import('/src/state/shellStore.ts')
    const d=useDeviation.getState(), n=window.__reNotes.getState().notes[0]
    return {workspace:useShell.getState().workspace,note:n,mapVersion:d.mapVersion,pins:d.pins?.length??0}
  })
  check(observed.workspace==='deviation','saving a note leaves Deviation active')
  check(observed.note?.on[0]?.kind==='scan' && Math.abs(observed.note?.at[2]-14)<0.001,'note anchors on the actual scan surface, not the CAD top or screen pixels')
  check(observed.mapVersion===before.mapVersion && observed.pins===before.pins,'note placement does not recompute the map or create a measurement pin')
  await page.screenshot({path:shotPath('tmar-deviation-note.png')})
  await page.click('[data-test=note-add]'); await page.keyboard.press('Escape')
  check(await page.evaluate(()=>!window.__reNotes.getState().placing),'Escape leaves note placement in Deviation')
  await page.click('[data-test=workspace-reverse]')
  check(await page.$eval('[data-test=note-list]',e=>e.textContent.includes('Synthetic mismatch')),'the same note is visible in Reverse engineer')
  const saved=await page.evaluate(async()=>{
    const {runCommand}=await import('/src/commands/registry.ts')
    const out=await runCommand('project.save'); window.__tmarSaved=out.file
    return out.file.bytes.byteLength
  })
  check(saved>0,'project saves with the shared annotation')
  await page.evaluate(()=>window.__reNotes.getState().removeAll())
  await page.evaluate(async()=>{
    const {runCommand}=await import('/src/commands/registry.ts')
    await runCommand('project.load',{bytes:window.__tmarSaved.bytes,name:window.__tmarSaved.name,discard:true})
  })
  const restored=await page.evaluate(()=>window.__reNotes.getState().notes.map(({id,text,at})=>({id,text,at})))
  check(restored.length===1 && restored[0].id===observed.note.id && restored[0].text===observed.note.text && JSON.stringify(restored[0].at)===JSON.stringify(observed.note.at),'save/reopen preserves note ID, text and position without duplication')
  await page.click('[data-test=workspace-deviation]')
  await page.waitForSelector('[data-test=tmar-deviation-notes]')
  await page.evaluate(async()=>{const {useDeviation}=await import('/src/state/deviationStore.ts');useDeviation.setState({mapOn:'reference'})})
  check(await page.$eval('[data-test=note-add]',b=>b.disabled),'reference-side placement is explicitly blocked in this initial adapter')
  await page.evaluate(async()=>{const {useDeviation}=await import('/src/state/deviationStore.ts');useDeviation.setState({mapOn:'scan',split:true})})
  check(await page.$eval('[data-test=note-add]',b=>b.disabled),'split-view placement is explicitly guarded instead of silently doing nothing')
  writeFileSync(join(downloads,'fixture-results.json'),JSON.stringify({bodyStl:b,notes:restored,comparisonPreserved:observed.mapVersion===before.mapVersion},null,2))
  const disabledURL=new URL(process.env.APP_URL);disabledURL.searchParams.set('plugins','none')
  await page.goto(disabledURL.href,{waitUntil:'networkidle0'})
  await page.waitForSelector('.panel')
  check(!(await page.$('[data-test=tmar-body-export]')) && !(await page.$('[data-test=tmar-deviation-notes]')) && !(await page.$('[data-test=workspace-reverse]')), 'host remains usable with all plugins disabled')
} catch(error) {
  fail(error.stack??String(error))
} finally {
  if(browser) await finish(browser,consoleErrors)
  if(server) await server.close()
}
