// SPDX-License-Identifier: AGPL-3.0-only
// Compiled app only. Browser actions use public DOM; no source imports,
// injected controller, store access or patched production bundle.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import puppeteer from 'puppeteer-core'
import { unzipSync, strFromU8 } from 'fflate'
import { OcctKernel } from 'occt-wasm'

assert.equal(process.env.SCANRULER_ISOLATED, '1')
assert.equal(process.env.APP_URL, 'http://127.0.0.1:17726/')
const out = process.env.OUT_DIR
assert(out && isAbsolute(out) && process.env.CHROME)
const away = relative(resolve(process.cwd()), resolve(out))
assert(away && (away === '..' || away.startsWith('..' + sep) || isAbsolute(away)))
mkdirSync(out, { recursive: true })
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const report = { scope: 'Fresh STEP import, real Edit Surface, Zebra, mouse note, deformation, annotated Apply, Undo/Redo, Save/Load and export in production-compiled browser only',
  integration: 'ce6004c629165658f4291a2c2eeaa0210854f861', host: '5684f5f27eaaa6ee460eef2300b010eb622b4507', plugin: '73a4f36b2e807499cd0fab488fc0cebb1badc0fa',
  checks: [], consoleErrors: [], sourceRequests: [], stage: 'setup', verdict: 'INCOMPLETE', files: {} }
const check = (ok, label) => { assert(ok, label); report.checks.push(label); console.log('PASS', label) }
const stage = name => { report.stage = name; console.log('STAGE', name) }
const near = (a,b,t=1e-7) => a.length === b.length && a.every((v,i) => Math.abs(v-b[i]) <= t)
const readNative = file => {
  const archive = unzipSync(readFileSync(file)), manifest = JSON.parse(strFromU8(archive['project.json']))
  return { manifest, steps: JSON.parse(strFromU8(archive[manifest.reverse.stepFiles])) }
}
const k = await OcctKernel.init(), box = k.makeBox(20,30,10)
const input = join(out,'synthetic-box.step')
try { writeFileSync(input,k.exportStep(box)) } finally { k.release(box) }
report.inputSha256 = hash(readFileSync(input))
let browser, page, sourceFeature, sourceStepHash, identity
const noteText = 'Collaudo compilato — nota CAD persistente 73a4f36'
const button = name => `[data-test="${name}"]`
const click = async name => { await page.waitForSelector(button(name), {visible:true,timeout:90000}); await page.click(button(name)) }
const waitEnabled = name => page.waitForSelector(`${button(name)}:not([disabled])`, {timeout:90000})
const observe = async p => {
  p.setDefaultTimeout(15000)
  p.on('dialog',d => { void d.accept() })
  p.on('pageerror',e => report.consoleErrors.push('pageerror: '+e.message))
  p.on('console',m => { if(m.type()==='error' && !/favicon/i.test(m.text())) report.consoleErrors.push(m.text()) })
  p.on('request',r => { const u=new URL(r.url()); if(/^\/(src|plugins)\//.test(u.pathname) || u.pathname.includes('/@vite/')) report.sourceRequests.push(u.pathname) })
  await p.evaluateOnNewDocument(() => {
    localStorage.setItem('scanruler.askstlunits','0')
    localStorage.setItem('scanruler.beta','all')
    localStorage.setItem('scanruler.supportask','0')
  })
}
const waitFile = async (dir,suffix) => {
  for(let i=0;i<500;i++) {
    const names=readdirSync(dir), name=names.find(n=>n.endsWith(suffix))
    if(name && !names.some(n=>n.endsWith('.crdownload'))) {
      const file=join(dir,name)
      try { if(suffix==='.scanruler') readNative(file); else assert(readFileSync(file,'utf8').includes('END-ISO-10303-21')); return file } catch {}
    }
    await new Promise(r=>setTimeout(r,100))
  }
  throw Error('Download not completed: '+dir+' '+suffix)
}
const download = async (label,suffix,act) => {
  const dir=join(out,'downloads',label);mkdirSync(dir,{recursive:true})
  const cdp=await page.createCDPSession()
  try {
    await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:dir,eventsEnabled:true})
    await act()
    const file=await waitFile(dir,suffix)
    report.files[label]={name:relative(out,file),sha256:hash(readFileSync(file))}
    return file
  } finally { await cdp.detach() }
}
const save = label => download(label,'.scanruler',async()=>{await waitEnabled('save-project');await click('save-project')})
const waitBodies = count => page.waitForFunction(n=>document.querySelectorAll('[data-test=body-row]').length===n,{timeout:90000},count)
const visibleState = () => page.$$eval('[data-test=body-visible]',buttons=>buttons.map(b=>!b.classList.contains('off')))
const waitNote = async () => {
  await page.waitForFunction(text=>{
    const row=[...document.querySelectorAll('[data-test=note-row]')].find(n=>n.textContent.includes(text))
    return !!row && !row.querySelector('[data-test=note-anchor-unresolved]') && !document.querySelector('[data-test=save-project]')?.disabled
  },{timeout:90000},noteText)
}

// QA observation only: the host legitimately revalidates anchors asynchronously.
// Keep every saved observation, require the same identity/resources, and never
// turn unresolved into verified in the test or application.
const saveVerified = async label => {
  let first = null;
  const observations=[]; (report.verificationWaits ??= {})[label]=observations;
  for(let attempt=0; attempt<6; attempt++) {
    await waitNote();
    const file=await save(`${label}-validation-${attempt}`), native=readNative(file);
    const notes=native.manifest.reverseNotes?.notes??[];
    assert.equal(notes.length,1); const note=notes[0],a=note.attachment;
    assert.equal(note.text,noteText);assert.equal(a?.version,1);
    assert(['verified','unresolved'].includes(a.status));
    const exact={noteUuid:a.noteUuid,featureUuid:a.featureUuid,body:note.on?.[0]?.body,operationId:a.operationId,
      draftId:a.draftId,stepSha256:a.stepSha256,witnessSha256:a.witnessSha256};
    if(first) {
      assert.deepEqual(exact,first.exact,'no identity/resource change while waiting for CAD validation');
      assert(near(note.at,first.at)&&near(note.normal,first.normal),'no anchor motion while waiting');
    } else first={exact,at:note.at,normal:note.normal};
    const copy=native.manifest.reverse.features.find(f=>f.annotationSource?.featureUuid===a.featureUuid);
    assert(copy&&copy.id===exact.body);
    assert.equal(hash(native.steps[copy.file.key]),a.stepSha256);
    assert.equal(hash(copy.annotationSource.faceBrep),a.witnessSha256);
    observations.push({attempt,status:a.status,identity:exact,projectSha256:hash(readFileSync(file))});
    if(a.status==='verified')return file;
    // Yield for the observed CAD validation; a bounded retry is not acceptance.
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw Error('Specific persisted note did not reach CAD-verified state without identity changes: '+label);
}

const assertAnnotated = (native, expectedIdentity=null) => {
  const {manifest:m,steps}=native, notes=m.reverseNotes?.notes??[], features=m.reverse.features
  assert.equal(notes.length,1);assert.equal(features.length,2)
  const note=notes[0],att=note.attachment
  assert.equal(note.text,noteText);assert.equal(att?.version,1);assert.equal(att.status,'verified')
  assert.equal(note.on.length,1);assert.equal(note.on[0].kind,'face')
  const copy=features.find(f=>f.annotationSource?.featureUuid===att.featureUuid)
  assert(copy && note.on[0].body===copy.id && copy.id!==sourceFeature.id)
  const ids={noteUuid:att.noteUuid,featureUuid:att.featureUuid,body:copy.id,operationId:att.operationId}
  if(expectedIdentity) assert.deepEqual(ids,expectedIdentity)
  assert((m.reverse.hiddenBodies??[]).includes(sourceFeature.id));assert(!(m.reverse.hiddenBodies??[]).includes(copy.id))
  assert.equal(hash(steps[sourceFeature.file.key]),sourceStepHash,'original STEP resource unchanged')
  assert.equal(hash(steps[copy.file.key]),att.stepSha256)
  assert.equal(hash(copy.annotationSource.faceBrep),att.witnessSha256)
  const witness=k.fromBREP(copy.annotationSource.faceBrep), shape=k.importStep(steps[copy.file.key])
  const solids=k.getSubShapes(shape,'solid')
  let volume,orientation
  try {
    const [u,v]=att.witnessUV,p=k.pointOnSurface(witness,u,v),n=k.surfaceNormal(witness,u,v)
    assert(['in','on'].includes(k.classifyPointOnFace(witness,u,v)))
    assert(near([p.x,p.y,p.z],note.at));assert([n.x,n.y,n.z].reduce((sum,x,i)=>sum+x*note.normal[i],0)>1-1e-6)
    const outside=note.at.map((x,i)=>x-[10,15,5][i])
    assert(note.normal.reduce((sum,x,i)=>sum+x*outside[i],0)>0,'normal points outside this box')
    assert(k.isValid(shape));assert.equal(solids.length,1)
    volume=k.getVolume(shape);assert(Math.abs(volume-6000)>1e-5,'actual CAD deformation')
    orientation=k.shapeOrientation(witness)
  } finally { solids.forEach(s=>k.release(s));k.release(shape);k.release(witness) }
  return {identity:ids,note,volume,orientation}
}
try {
  browser=await puppeteer.launch({executablePath:process.env.CHROME,headless:'new',userDataDir:join(out,'owned-browser-profile'),
    args:['--no-sandbox','--enable-unsafe-swiftshader','--window-size=1440,1000'],defaultViewport:{width:1440,height:1000},protocolTimeout:120000})
  page=await browser.newPage();await observe(page);await page.goto(process.env.APP_URL,{waitUntil:'networkidle0'})
  stage('fresh UI STEP import')
  await click('workspace-reverse');await waitEnabled('feature-import')
  await (await page.$(button('feature-import-file'))).uploadFile(input)
  await waitEnabled('import-create');await click('import-create');await waitBodies(1);await waitEnabled('feature-edit-surface')
  const baseline=readNative(await save('baseline'))
  assert.equal(baseline.manifest.reverse.features.length,1)
  assert.equal((baseline.manifest.reverseNotes?.notes??[]).length,0)
  sourceFeature=baseline.manifest.reverse.features[0];sourceStepHash=hash(baseline.steps[sourceFeature.file.key])
  check(true,'fresh synthetic STEP imported through compiled UI with no pre-existing annotation')
  const fit=await page.evaluateHandle(()=>[...document.querySelectorAll('button[title]')].find(e=>/fit.*(view|screen)|frame all/i.test(e.title))??null)
  if(fit.asElement()) await fit.asElement().click()
  await fit.dispose()
  const canvasCount=await page.$$eval('.viewport canvas',nodes=>nodes.length)
  await click('feature-edit-surface');await page.waitForSelector('[data-test=workspace-surface-parameters]',{timeout:90000})
  check(await page.$$eval('.viewport canvas',nodes=>nodes.length)===canvasCount && !(await page.$('[data-test=edit-surface-dialog]')),'Edit Surface runs in the same main canvas without a modal')
  stage('mouse face and note with Zebra')
  const rect=await page.$eval('.viewport canvas',e=>{const r=e.getBoundingClientRect();return{x:r.left,y:r.top,w:r.width,h:r.height}})
  let picked=null
  for(const [fx,fy] of [[.5,.5],[.45,.45],[.55,.45],[.45,.55],[.55,.55],[.4,.5],[.6,.5]]) {
    const point={x:rect.x+rect.w*fx,y:rect.y+rect.h*fy}
    const isCanvas=await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.tagName==='CANVAS',point)
    if(!isCanvas) continue
    await page.mouse.click(point.x,point.y)
    try { await page.waitForFunction(()=>document.querySelector('[data-test=surface-face]')?.value!=='' && !!document.querySelector('[data-test=surface-distance]'),{timeout:3000});picked=point;break } catch {}
  }
  assert(picked,'Could not pick a visible editable face through the compiled viewport')
  report.faceClick=picked;report.selectedFace=await page.$eval(button('surface-face'),e=>e.value)
  await waitEnabled('surface-note-add')
  check(true,'real viewport click selects an editable CAD face')
  if(!await page.$eval(button('surface-zebra'),e=>e.checked))await click('surface-zebra')
  await click('surface-note-add');await page.mouse.click(picked.x,picked.y)
  await page.waitForSelector('[data-test=surface-note-text]',{visible:true,timeout:30000})
  await page.type(button('surface-note-text'),noteText)
  await page.keyboard.press('Tab')
  check(await page.$eval(button('surface-zebra'),e=>e.checked) && await page.$eval(button('surface-note-text'),e=>e.value)===noteText,'Zebra and a mouse-placed typed note coexist in the compiled editor')
  const other=await page.$eval(button('surface-face'),e=>[...e.options].find(o=>o.value && !o.disabled && o.value!==e.value)?.value??null)
  assert(other)
  await page.select(button('surface-face'),other)
  await page.waitForFunction(v=>document.querySelector('[data-test=surface-face]')?.value===v,{timeout:5000},report.selectedFace)
  check(await page.$eval(button('surface-note-text'),e=>e.value)===noteText,'draft note blocks a face change without losing text or selected face')
  check(await page.$eval(button('surface-export-step'),e=>e.disabled),'local STEP export cannot silently discard the draft note')
  stage('numerical deformation and compiled annotated Apply')
  await page.select(button('surface-drag-mode'),'local');await click('surface-axis-2')
  const free=await page.evaluateHandle(()=>[...document.querySelectorAll('[data-test=workspace-surface-parameters] button')].find(b=>b.textContent.trim()==='Seleziona liberi'))
  assert(free.asElement());await free.asElement().click();await free.dispose()
  await page.click(button('surface-distance'),{clickCount:3});await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await page.type(button('surface-distance'),'0.05');await page.keyboard.press('Tab')
  await waitEnabled('surface-move');await click('surface-move');await waitEnabled('workspace-editor-apply')
  assert(await page.$eval(button('workspace-editor-hide-source'),e=>e.checked))
  await page.screenshot({path:join(out,'annotated-draft.png')})
  await click('workspace-editor-apply')
  await page.waitForSelector('[data-test=workspace-editor-dock]',{hidden:true,timeout:120000})
  await waitBodies(2);await waitNote()
  const applied=readNative(await saveVerified('applied')), verified=assertAnnotated(applied)
  identity=verified.identity;report.applied=verified
  check(true,'compiled Apply creates a geometrically changed valid copy with the complete verified note')
  assert.deepEqual(await visibleState(),[false,true])
  check(true,'original remains intact and hidden while the annotated copy is visible')
  await page.screenshot({path:join(out,'applied.png')})
  stage('single-action project Undo and Redo')
  await waitEnabled('undo');await click('undo');await waitBodies(1)
  await page.waitForFunction(()=>document.querySelectorAll('[data-test=note-row]').length===0,{timeout:60000})
  const undone=readNative(await save('undone'))
  assert.equal(undone.manifest.reverse.features.length,1);assert.equal((undone.manifest.reverseNotes?.notes??[]).length,0)
  assert(!(undone.manifest.reverse.hiddenBodies??[]).includes(sourceFeature.id))
  assert.equal(hash(undone.steps[sourceFeature.file.key]),sourceStepHash)
  assert.deepEqual(await visibleState(),[true])
  check(true,'one toolbar Undo removes both copy and note and restores original visibility')
  await waitEnabled('redo');await click('redo');await waitBodies(2);await waitNote()
  const redoFile=await saveVerified('redone'),redone=assertAnnotated(readNative(redoFile),identity)
  check(near(redone.note.at,verified.note.at)&&near(redone.note.normal,verified.note.normal),'one toolbar Redo restores the same note UUID, feature, body, geometry and orientation')
  stage('fresh compiled page Load and Save')
  page=await browser.newPage();await observe(page);await page.goto(process.env.APP_URL,{waitUntil:'networkidle0'})
  await page.waitForSelector('[data-test=project-input]');await (await page.$('[data-test=project-input]')).uploadFile(redoFile)
  await click('workspace-reverse');await waitBodies(2);await waitNote()
  const reopenFile=await saveVerified('reopened'), reopened=assertAnnotated(readNative(reopenFile),identity)
  assert(near(reopened.note.at,verified.note.at)&&near(reopened.note.normal,verified.note.normal))
  assert(near(reopened.note.attachment.uv,verified.note.attachment.uv)&&near(reopened.note.attachment.witnessUV,verified.note.attachment.witnessUV))
  report.reopened=reopened
  check(true,'fresh-page native Load and Save preserve exact UUIDs, text, body/face association and both UV records')
  check(reopened.note.attachment.status==='verified','reopened note is CAD-verified, with finite correctly oriented normal and valid solid')
  await page.screenshot({path:join(out,'reopened.png')})
  stage('independent STEP export')
  for(const el of await page.$$(button('body-visible')))if(await el.evaluate(e=>e.classList.contains('off')))await el.click()
  const stepFile=await download('export','.step',async()=>{await waitEnabled('export-body');await click('export-body');await waitEnabled('export-body-save');await click('export-body-save')})
  const shape=k.importStep(readFileSync(stepFile,'utf8')),solids=k.getSubShapes(shape,'solid')
  try {const volumes=solids.map(s=>k.getVolume(s)).sort((a,b)=>a-b),expected=[6000,verified.volume].sort((a,b)=>a-b)
    report.export={valid:k.isValid(shape),solids:solids.length,volumes}
    check(report.export.valid&&solids.length===2&&near(volumes,expected,1e-5),'compiled UI export independently reimports original and edited copy as two valid solids')
  }finally{solids.forEach(s=>k.release(s));k.release(shape)}
  check(hash(readFileSync(input))===report.inputSha256,'synthetic source STEP is byte-for-byte unchanged')
  check(report.sourceRequests.length===0,'browser loads compiled assets only, with no source modules or injected controller')
  check(report.consoleErrors.length===0,'zero application console errors throughout the full compiled cycle')
  report.verdict='PASS';report.stage='completed'
}catch(error){report.error=String(error?.stack??error);process.exitCode=1;console.error(report.error)
  if(page){await page.screenshot({path:join(out,'failure.png')}).catch(()=>{});writeFileSync(join(out,'failure-dom.html'),await page.content().catch(()=>''))}
}finally{if(browser)await browser.close();k[Symbol.dispose]();writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))}
