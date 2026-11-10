// SPDX-License-Identifier: AGPL-3.0-only
// Isolated UI export QA: only a synthetic STEP box and an owned browser profile.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

assert.equal(process.env.SCANRULER_ISOLATED, '1', 'SCANRULER_ISOLATED=1 is required')
const url = new URL(process.env.APP_URL ?? '')
assert.equal(url.href, 'http://127.0.0.1:17527/', 'Only the designated isolated QA server is permitted')
const root = process.env.EDIT_SURFACE_QA_OUT
assert(root && isAbsolute(root), 'EDIT_SURFACE_QA_OUT must be absolute')
const rel = relative(resolve(process.cwd()), resolve(root))
assert(rel && (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)), 'Evidence must be outside the checkout')
const response=await fetch(url,{signal:AbortSignal.timeout(5000)})
assert(response.ok && /ScanRuler/i.test(await response.text()),'The QA endpoint did not identify itself as ScanRuler')

mkdirSync(root,{recursive:true})
const out=mkdtempSync(join(root,'workspace-export-step-')), downloads=join(out,'downloads')
mkdirSync(downloads)
process.env.SHOT_DIR=out
const { launchApp }=await import('../../../scripts/e2e-lib.mjs')
const { OcctKernel }=await import('occt-wasm')
const kernel=await OcctKernel.init(), box=kernel.makeBox(20,30,10)
let step, originalVolume
try {step=kernel.exportStep(box);originalVolume=kernel.getVolume(box)} finally {kernel.release(box)}
const input=join(out,'synthetic-box.step')
writeFileSync(input,step)
const sha=value=>createHash('sha256').update(value).digest('hex')
// STEP writers can reserialize the same B-Rep differently. Compare CAD
// topology and measured geometry; hashes remain diagnostic only.
const sourceSignature = text => {
  const shape=kernel.importStep(text),solids=kernel.getSubShapes(shape,'solid'),faces=kernel.getSubShapes(shape,'face'),
    edges=kernel.getSubShapes(shape,'edge'),vertices=kernel.getSubShapes(shape,'vertex')
  const rounded=value=>Number(value.toFixed(6))
  const bounds=object=>{const b=kernel.getBoundingBox(object);return [b.xmin,b.ymin,b.zmin,b.xmax,b.ymax,b.zmax].map(rounded)}
  try {
    const surfaces=faces.map(face=>{
      const faceEdges=kernel.getSubShapes(face,'edge'),faceVertices=kernel.getSubShapes(face,'vertex')
      try {return {type:kernel.surfaceType(face),area:rounded(kernel.getSurfaceArea(face)),bounds:bounds(face),
        edges:faceEdges.length,vertices:faceVertices.length}}
      finally {faceEdges.forEach(edge=>kernel.release(edge));faceVertices.forEach(vertex=>kernel.release(vertex))}
    }).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))
    return {valid:kernel.isValid(shape),solids:solids.length,faces:faces.length,edges:edges.length,vertices:vertices.length,
      volume:rounded(kernel.getVolume(shape)),area:rounded(kernel.getSurfaceArea(shape)),bounds:bounds(shape),surfaces}
  } finally {solids.forEach(s=>kernel.release(s));faces.forEach(f=>kernel.release(f));edges.forEach(e=>kernel.release(e));
    vertices.forEach(v=>kernel.release(v));kernel.release(shape)}
}
const report={scope:'UI export of modified synthetic STEP box; isolated QA host',inputSha256:sha(step),
  originalVolume,checks:[],noteCheck:'NOT_RUN',verdict:'INCOMPLETE',consoleErrors:[]}
const persist=()=>writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2))
const check=(condition,label)=>{assert(condition,label);report.checks.push(label);persist();console.log('PASS',label)}
persist()
let browser,page
const events=[]
try {
  const app=await launchApp({url:url.href,width:1440,height:1000,agentDataOk:false,
    userDataDir:join(out,'owned-browser-profile'),protocolTimeout:120000})
  browser=app.browser;page=app.page;report.consoleErrors=app.consoleErrors
  page.on('dialog',dialog=>dialog.accept())
  const cdp=await page.createCDPSession()
  await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads,eventsEnabled:true})
  cdp.on('Browser.downloadWillBegin',event=>events.push({kind:'begin',guid:event.guid,name:event.suggestedFilename}))
  cdp.on('Browser.downloadProgress',event=>events.push({kind:'progress',guid:event.guid,state:event.state}))

  await page.click('[data-test=workspace-reverse]')
  await page.waitForSelector('[data-test=feature-import]:enabled',{timeout:120000})
  await (await page.$('[data-test=feature-import-file]')).uploadFile(input)
  await page.waitForSelector('[data-test=import-create]:enabled',{timeout:120000})
  await page.click('[data-test=import-create]')
  await page.waitForSelector('[data-test=feature-edit-surface]:enabled',{timeout:120000})
  const before=await page.evaluate(async()=>{
    const {useReverse}=await import('/plugins/reverse/state/reStore.ts')
    const {reverseSession}=await import('/plugins/reverse/app/reSession.ts')
    const {useWorkspaceEditor}=await import('/src/plugins/workspaceEditors.ts')
    const history=await import('/src/state/historyStore.ts')
    const {sceneOf}=await import('/src/commands/host.ts')
    const {reSceneOf}=await import('/plugins/reverse/viewer/reScene.ts')
    const session=reverseSession(),scene=sceneOf(),reverse=useReverse.getState()
    if(!session || !scene || reverse.bodies.length!==1)throw Error('The synthetic box was not isolated.')
    await session.settled()
    const id=useReverse.getState().bodies[0].id,source=await session.client().bodyEditSource(id)
    const bytes=new TextEncoder().encode(source.text),digest=await crypto.subtle.digest('SHA-256',bytes)
    const sourceSha=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('')
    for(let i=0;i<500&&!reSceneOf(scene).bodyMeshes.get(id);i++)await new Promise(resolve=>setTimeout(resolve,20))
    const data=useReverse.getState(), h=history.useHistory.getState(), mesh=reSceneOf(scene).bodyMeshes.get(id)
    if(!mesh)throw Error('Source mesh unavailable')
    scene.fitToView()
    window.exportQa={useReverse,reverseSession,useWorkspaceEditor,history,scene,reScene:reSceneOf(scene),id,
      refs:{features:data.features,stepFiles:data.stepFiles,geometry:mesh.geometry,past:h.past,future:h.future}}
    return {sourceSha,sourceText:source.text,sourceKey:source.bodyKey,bodyIds:data.bodies.map(body=>body.id),features:data.features.length,
      buildVersion:data.buildVersion,historyPast:h.past.length,historyFuture:h.future.length,historyRevision:h.revision}
  })
  const beforeSource=before.sourceText
  writeFileSync(join(out,'source-before.step'),beforeSource)
  before.geometry=sourceSignature(beforeSource);delete before.sourceText
  report.before=before
  await page.click('[data-test=feature-edit-surface]')
  await page.waitForSelector('[data-test=workspace-surface-parameters]',{timeout:120000})
  const face=await page.evaluate(()=>{
    const c=window.exportQa.useWorkspaceEditor.getState().controller, state=c.getPanelState(), preview=c.getViewState().preview
    return state.faces.find(f=>{
      const p=preview.faceMeshes[f.index]?.positions
      return !f.reason && f.kind==='plane' && p?.length>=9 && Array.from({length:p.length/3},(_,i)=>p[i*3+2]).every(z=>Math.abs(z-10)<1e-5)
    })?.index ?? -1
  })
  assert(face>=0,'No supported top face in synthetic box')
  report.face=face
  await page.select('[data-test=surface-face]',String(face))
  await page.waitForSelector('[data-test=surface-export-step]:enabled',{timeout:120000})
  const free=await page.evaluateHandle(()=>[...document.querySelectorAll('[data-test=workspace-surface-parameters] button')].find(e=>e.textContent==='Seleziona liberi'))
  assert(free.asElement(),'Select free points button unavailable')
  await free.asElement().click()
  await page.select('[data-test=surface-drag-mode]','local')
  await page.click('[data-test=surface-axis-2]')
  await page.$eval('[data-test=surface-distance]',element=>{
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,'0.05')
    element.dispatchEvent(new Event('input',{bubbles:true}))
  })
  await page.click('[data-test=surface-move]')
  await page.waitForSelector('[data-test=surface-undo]:enabled',{timeout:120000})
  await page.waitForSelector('[data-test=surface-export-step]:enabled',{timeout:120000})
  report.editedPreview=await page.evaluate(()=>window.exportQa.useWorkspaceEditor.getState().controller.getViewState().preview.volume)
  check(Math.abs(report.editedPreview-originalVolume)>1e-5,'CAD draft has a measured geometry change before export')

  await page.click('[data-test=surface-export-step]')
  const deadline=Date.now()+60000
  while(Date.now()<deadline && !events.some(event=>event.kind==='progress'&&event.state==='completed'))
    await new Promise(resolve=>setTimeout(resolve,100))
  const completed=events.find(event=>event.kind==='progress'&&event.state==='completed')
  const started=events.find(event=>event.kind==='begin'&&event.guid===completed?.guid)
  assert(completed&&started,'No completed real download was reported by the browser')
  const downloaded=join(downloads,started.name)
  const downloadedBytes=readFileSync(downloaded)
  report.download={name:started.name,bytes:downloadedBytes.length,sha256:sha(downloadedBytes)}
  check(downloadedBytes.length>0 && /\.step$/i.test(started.name),'STEP is actually downloaded to the isolated folder')
  const shape=kernel.importStep(downloadedBytes.toString('utf8')), solids=kernel.getSubShapes(shape,'solid'), faces=kernel.getSubShapes(shape,'face')
  try {
    report.geometry={valid:kernel.isValid(shape),solids:solids.length,faces:faces.length,volume:kernel.getVolume(shape)}
    check(report.geometry.valid && solids.length===1 && faces.length===6,'Downloaded STEP reimports as a valid CAD solid')
    check(Math.abs(report.geometry.volume-originalVolume)>1e-5 && Math.abs(report.geometry.volume-report.editedPreview)<1e-4,
      'Downloaded CAD has the modified volume shown by the current preview')
  } finally {solids.forEach(s=>kernel.release(s));faces.forEach(f=>kernel.release(f));kernel.release(shape)}
  await page.waitForSelector('[data-test=surface-export-step]:enabled',{timeout:30000})
  const after=await page.evaluate(async()=>{
    const q=window.exportQa, data=q.useReverse.getState(),h=q.history.useHistory.getState()
    const src=await q.reverseSession().client().bodyEditSource(q.id)
    const bytes=new TextEncoder().encode(src.text),digest=await crypto.subtle.digest('SHA-256',bytes)
    const sourceSha=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('')
    return {sourceSha,sourceText:src.text,sourceKey:src.bodyKey,bodyIds:data.bodies.map(body=>body.id),features:data.features.length,
      buildVersion:data.buildVersion,historyPast:h.past.length,historyFuture:h.future.length,historyRevision:h.revision,
      sameFeatures:data.features===q.refs.features,sameStepFiles:data.stepFiles===q.refs.stepFiles,
      sameGeometry:q.reScene.bodyMeshes.get(q.id)?.geometry===q.refs.geometry,samePast:h.past===q.refs.past,sameFuture:h.future===q.refs.future,
      phase:q.useWorkspaceEditor.getState().phase}
  })
  const afterSource=after.sourceText
  writeFileSync(join(out,'source-after.step'),afterSource)
  after.geometry=sourceSignature(afterSource);delete after.sourceText
  report.after=after
  check(before.geometry.valid && after.geometry.valid && JSON.stringify(after.geometry)===JSON.stringify(before.geometry) && after.sourceKey===before.sourceKey &&
    JSON.stringify(after.bodyIds)===JSON.stringify(before.bodyIds) && after.features===before.features &&
    after.buildVersion===before.buildVersion && after.sameFeatures && after.sameStepFiles && after.sameGeometry,
    'Source CAD body and project remain unchanged after download')
  check(after.historyPast===before.historyPast && after.historyFuture===before.historyFuture &&
    after.historyRevision===before.historyRevision && after.samePast && after.sameFuture && after.phase==='editing',
    'Download does not publish a history entry and keeps the editor open')

  // Optional but observed in the actual viewport: place a note, then verify
  // that an actual disabled-button activation cannot initiate another download.
  let notePlaced=false
  try {
    await page.click('[data-test=surface-note-add]')
    const target=await page.evaluate(faceId=>{
      const q=window.exportQa, lease=q.scene.layerHost(), camera=lease.camera(), canvas=lease.canvas, rect=canvas.getBoundingClientRect()
      const preview=lease.partGroup.getObjectByName('tmar-edit-surface-preview')
      preview.updateWorldMatrix(true,true);camera.updateMatrixWorld(true)
      for(const mesh of preview.children){
        if(mesh.userData.face!==faceId)continue
        const position=mesh.geometry.getAttribute('position'),index=mesh.geometry.index
        if(!position||!index)continue
        for(let i=0;i+2<index.count;i+=3){
          const V=mesh.position.constructor,a=new V().fromBufferAttribute(position,index.getX(i)),
            b=new V().fromBufferAttribute(position,index.getX(i+1)),c=new V().fromBufferAttribute(position,index.getX(i+2))
          const ndc=mesh.localToWorld(a.add(b).add(c).multiplyScalar(1/3)).project(camera)
          const x=rect.left+(ndc.x+1)*rect.width/2,y=rect.top+(1-ndc.y)*rect.height/2
          if(ndc.z>=-1&&ndc.z<=1&&x>rect.left+10&&x<rect.right-10&&y>rect.top+10&&y<rect.bottom-10&&document.elementFromPoint(x,y)===canvas)return{x,y}
        }
      }
      return null
    },face)
    assert(target,'No unobstructed face pixel for the note')
    await page.mouse.click(target.x,target.y)
    await page.waitForSelector('[data-test=surface-note-text]',{timeout:15000})
    notePlaced=true
    await page.type('[data-test=surface-note-text]','Nota di prova export')
    const noteBefore=await page.evaluate(()=>{
      const q=window.exportQa,c=q.useWorkspaceEditor.getState().controller,button=document.querySelector('[data-test=surface-export-step]')
      return {notes:c.getPanelState().notes.map(note=>({id:note.id,text:note.text})),disabled:button.disabled,title:button.title}
    })
    assert(noteBefore.notes.length===1 && noteBefore.notes[0].text==='Nota di prova export' && noteBefore.disabled,'Note did not disable STEP export')
    const countBefore=events.filter(event=>event.kind==='begin').length, filesBefore=readdirSync(downloads)
    await page.$eval('[data-test=surface-export-step]',button=>button.click())
    await new Promise(resolve=>setTimeout(resolve,1000))
    const noteAfter=await page.evaluate(()=>window.exportQa.useWorkspaceEditor.getState().controller.getPanelState().notes.map(note=>({id:note.id,text:note.text})))
    check(events.filter(event=>event.kind==='begin').length===countBefore && JSON.stringify(readdirSync(downloads))===JSON.stringify(filesBefore) &&
      JSON.stringify(noteAfter)===JSON.stringify(noteBefore.notes),
      'A note disables a second download and remains in the draft')
    report.noteCheck='PASS';report.note=noteBefore
  } catch(error) {
    if(notePlaced){report.noteCheck='FAIL';throw error}
    report.noteCheck='NOT_PROVED';report.noteError=String(error?.stack ?? error)
  }
  check(report.consoleErrors.length===0,'No browser application errors')
  report.verdict=report.noteCheck==='PASS'?'PASS':'EXPORT_PASS_NOTE_NOT_PROVED'
} catch(error) {
  report.verdict='FAIL'
  report.error=String(error?.stack ?? error)
  process.exitCode=1
  if(page)try{await page.screenshot({path:join(out,'failure.png')})}catch{/* preserve error */}
} finally {
  if(browser)await browser.close()
  kernel[Symbol.dispose]()
  report.downloadEvents=events
  persist()
  console.log(JSON.stringify({out,verdict:report.verdict,noteCheck:report.noteCheck,error:report.error}))
}
