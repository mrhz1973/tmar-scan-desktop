// SPDX-License-Identifier: AGPL-3.0-only
// Public compiled UI only. This tests load/resave, NOT annotated Apply in the
// compiled app. No source imports, controller injection or geometry mutation.
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { unzipSync, strFromU8 } from 'fflate'
import { OcctKernel } from 'occt-wasm'
import { launchApp } from '../../../scripts/e2e-lib.mjs'
assert.equal(process.env.SCANRULER_ISOLATED, '1')
assert.equal(process.env.APP_URL, 'http://127.0.0.1:17724/')
const out = process.env.OUT_DIR, sourceReportPath = process.env.SOURCE_REPORT
assert(out && isAbsolute(out) && sourceReportPath && isAbsolute(sourceReportPath))
const away = relative(resolve(process.cwd()), resolve(out))
assert(away && (away === '..' || away.startsWith('..' + sep) || isAbsolute(away)))
mkdirSync(out, { recursive: true })
const downloads = join(out, 'downloads'); mkdirSync(downloads)
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const source = JSON.parse(readFileSync(sourceReportPath, 'utf8'))
assert.equal(source.verdict, 'PASS')
const candidates = readdirSync(join(dirname(sourceReportPath), 'downloads')).filter(n => n.endsWith('.scanruler'))
assert.equal(candidates.length, 1)
const input = join(dirname(sourceReportPath), 'downloads', candidates[0]), inputBytes = readFileSync(input)
assert.equal(hash(inputBytes), source.savedSha256)
const readNative = bytes => JSON.parse(strFromU8(unzipSync(bytes)['project.json']))
const initial = readNative(inputBytes), receipt = source.applied.receipt
assert.equal(receipt.mode, 'annotated-cad-copy'); assert.equal(receipt.notes.length, 1)
assert.equal(receipt.createdBodyIds.length, 1)
const identity = { uuid: receipt.notes[0].noteUuid, feature: receipt.createdFeatureUuid, body: receipt.createdBodyIds[0] }
const expected = initial.reverseNotes.notes.find(n => n.attachment?.noteUuid === identity.uuid)
assert(expected && expected.attachment.featureUuid === identity.feature && expected.on[0].body === identity.body)
assert.equal(expected.attachment.status, 'verified')
const expectedVolumes = source.applied.bodies.map(b => b.volume).sort((a,b) => a-b)
assert.equal(expectedVolumes.length, 2)
const report = { scope: 'Exact production-compiled pair; native annotated load/resave/fresh-page reload and independent STEP export; not compiled annotated Apply',
  host: '5684f5f27eaaa6ee460eef2300b010eb622b4507', plugin: '3bed36f70167b350b87a6615ff22a79dfa6da9e3',
  inputSha256: hash(inputBytes), identity, checks: [], consoleErrors: [], sourceModuleRequests: [], verdict: 'INCOMPLETE' }
const check = (ok,label) => { assert(ok,label); report.checks.push(label); console.log('PASS',label) }
const near = (a,b,tol=1e-8) => a.length === b.length && a.every((v,i) => Math.abs(v-b[i]) <= tol)
const assertNote = manifest => {
  const note = manifest.reverseNotes.notes.find(n => n.attachment?.noteUuid === identity.uuid)
  assert(note && note.text === expected.text && note.attachment.featureUuid === identity.feature)
  assert(note.on.length === 1 && note.on[0].kind === 'face' && note.on[0].body === identity.body)
  assert.equal(note.attachment.status,'verified')
  assert(near(note.at,expected.at) && near(note.normal,expected.normal))
  assert(near(note.attachment.uv,expected.attachment.uv) && near(note.attachment.witnessUV,expected.attachment.witnessUV))
  return note
}
const waitDownload = async (suffix, before = new Set()) => {
  for (let i=0; i<400; i++) {
    const name = readdirSync(downloads).find(n => !before.has(n) && n.endsWith(suffix))
    if (name) return join(downloads,name)
    await new Promise(r => setTimeout(r,100))
  }
  throw Error('Download timeout: '+suffix)
}
let browser,page; const k = await OcctKernel.init()
const observe = p => {
  p.on('dialog', d => d.accept())
  p.on('request', r => { const u = new URL(r.url()); if (/^\/(src|plugins)\/.*\.(tsx?|mjs)(\?|$)/.test(u.pathname)) report.sourceModuleRequests.push(u.pathname) })
}
const openNative = async file => {
  await page.waitForSelector('[data-test=project-input]')
  await (await page.$('[data-test=project-input]')).uploadFile(file)
  await page.click('[data-test=workspace-reverse]')
  await page.waitForFunction(text => {
    const rows = [...document.querySelectorAll('[data-test=note-row]')]
    const row = rows.find(r => r.querySelector('[data-test=note-row-text]')?.textContent.includes(text))
    return document.querySelectorAll('[data-test=body-row]').length === 2 && !!row && !row.querySelector('[data-test=note-anchor-unresolved]')
  }, {timeout:90000}, expected.text)
  const hidden = await page.$$eval('[data-test=body-visible]', a => a.map(b => b.classList.contains('off')))
  assert.deepEqual(hidden,[true,false])
}
try {
  const app = await launchApp({url:process.env.APP_URL,width:1440,height:1000,agentDataOk:false,
    userDataDir:join(out,'owned-browser-profile'),protocolTimeout:120000})
  browser=app.browser; page=app.page; report.consoleErrors=app.consoleErrors; observe(page)
  const cdp=await page.createCDPSession()
  await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads,eventsEnabled:true})
  await openNative(input)
  check(true,'compiled UI loads exact newly generated note and retains hidden original / visible copy')
  await page.screenshot({path:join(out,'compiled-reopened.png')})
  const before=new Set(readdirSync(downloads))
  await page.waitForSelector('[data-test=save-project]:enabled'); await page.click('[data-test=save-project]')
  const saved=await waitDownload('.scanruler',before), savedBytes=readFileSync(saved), savedManifest=readNative(savedBytes)
  report.resavedNote=assertNote(savedManifest); report.resavedSha256=hash(savedBytes)
  check(true,'compiled resave preserves exact note UUID, feature UUID, body association, text and verified status')
  check(near(report.resavedNote.normal,expected.normal) && near(report.resavedNote.at,expected.at), 'position and face-oriented normal preserved without sign changes')
  const f=savedManifest.reverse.features.find(f => f.annotationSource?.featureUuid===identity.feature)
  assert(f?.annotationSource)
  const witness=k.fromBREP(f.annotationSource.faceBrep)
  try {
    const [u,v]=report.resavedNote.attachment.witnessUV, p=k.pointOnSurface(witness,u,v), n=k.surfaceNormal(witness,u,v)
    assert(['in','on'].includes(k.classifyPointOnFace(witness,u,v)))
    check(near([p.x,p.y,p.z],expected.at) && [n.x,n.y,n.z].reduce((a,x,i)=>a+x*expected.normal[i],0)>1-1e-6,
      'independent OCCT witness checks saved position and signed normal on the face')
  } finally { k.release(witness) }
  page=await browser.newPage(); observe(page)
  page.on('pageerror',e=>report.consoleErrors.push('fresh reload: '+e.message))
  page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push('fresh reload: '+m.text())})
  await page.goto(process.env.APP_URL,{waitUntil:'domcontentloaded'}); await openNative(saved)
  check(true,'fresh compiled page reopens the newly resaved native project and revalidates its note')
  const beforeAgain=new Set(readdirSync(downloads))
  await page.waitForSelector('[data-test=save-project]:enabled'); await page.click('[data-test=save-project]')
  const savedAgain=await waitDownload('.scanruler',beforeAgain)
  assertNote(readNative(readFileSync(savedAgain)))
  check(true,'second compiled save keeps the same identity and both UV records after fresh-page reload')
  await page.$$eval('[data-test=body-visible]',a=>a.filter(b=>b.classList.contains('off')).forEach(b=>b.click()))
  await page.waitForSelector('[data-test=export-body]:enabled'); await page.click('[data-test=export-body]')
  await page.waitForSelector('[data-test=export-body-save]:enabled'); await page.click('[data-test=export-body-save]')
  const file=await waitDownload('.step'), shape=k.importStep(readFileSync(file,'utf8')), solids=k.getSubShapes(shape,'solid')
  try {
    const volumes=solids.map(s=>k.getVolume(s)).sort((a,b)=>a-b)
    report.geometry={valid:k.isValid(shape),solids:solids.length,volumes,expectedVolumes}
    check(report.geometry.valid && solids.length===2 && near(volumes,expectedVolumes,1e-5),
      'compiled two-body STEP independently reimports as valid CAD with the source-run volumes')
  } finally {solids.forEach(s=>k.release(s));k.release(shape)}
  check(hash(readFileSync(input))===report.inputSha256,'synthetic input project remains byte-for-byte unchanged')
  check(report.sourceModuleRequests.length===0,'compiled browser did not import source modules or a QA controller')
  check(report.consoleErrors.length===0,'zero application console errors across compiled load/save/reload')
  report.verdict='PASS'
} catch(error) {
  report.error=String(error?.stack??error);process.exitCode=1;console.error(report.error)
  if(page)await page.screenshot({path:join(out,'failure.png')}).catch(()=>{})
} finally {
  if(browser)await browser.close();k[Symbol.dispose]()
  writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
}
