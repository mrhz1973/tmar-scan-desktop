// SPDX-License-Identifier: AGPL-3.0-only
// Isolated, explicit run only. Never attaches to an existing browser/session.
// One prequalified curved STEP, one U1 press/move/Escape; no Apply or save.
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFileSync,mkdtempSync,writeFileSync} from 'node:fs'
import {isAbsolute,join,relative,resolve,sep} from 'node:path'

assert.equal(process.env.SCANRULER_ISOLATED,'1','Requires the isolated QA app.')
const url=new URL(process.env.APP_URL??'')
assert.equal(url.href,'http://127.0.0.1:17527/','Only the designated isolated QA origin is permitted.')
const outputRoot=process.env.EDIT_SURFACE_QA_OUT
assert(outputRoot&&isAbsolute(outputRoot),'Evidence requires an absolute external output directory.')
const rel=relative(resolve(process.cwd()),resolve(outputRoot))
assert(rel&&(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)),'Evidence must stay outside the checkout.')
const explicitFixture=process.env.CURVED_FIXTURE
if(explicitFixture)assert(isAbsolute(explicitFixture),'CURVED_FIXTURE must be an absolute read-only STEP input path.')
const fixture=explicitFixture??new URL('../evidence/free-boundary/compiled-20261103/moved.step',import.meta.url)
const input=readFileSync(fixture),sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const expectedSha='61e1e624a432089e613cc9b744a7c883ccee3cd79ba459f0ef1c5c159419741f'
assert.equal(sha(input),expectedSha,'Only the exact prequalified curved fixture may be used.')
const out=mkdtempSync(join(resolve(outputRoot),'workspace-curved-boundary-gui-'))
process.env.SHOT_DIR=out
const report={scope:'One U1 curved natural-boundary drag and Escape in an isolated source GUI',
  fixture:{path:explicitFixture??'evidence/free-boundary/compiled-20261103/moved.step',sha256:expectedSha},
  checks:[],verdict:'INCOMPLETE',limitations:['One existing curved STEP and oblique view only.',
    'Escape cancels before commit; no Undo, Apply, save or desktop-package qualification.',
    'No hidden-fold GUI test or QuickSurface parity claim.']}
let browser,page
const check=(ok,label)=>{assert(ok,label);report.checks.push(label)}
try{
  const response=await fetch(url,{signal:AbortSignal.timeout(5000)})
  assert(response.ok&&/ScanRuler/i.test(await response.text()),'QA origin must identify as ScanRuler.')
  const {launchApp}=await import('../../../scripts/e2e-lib.mjs')
  const app=await launchApp({url:url.href,width:1440,height:1000,agentDataOk:false,
    userDataDir:join(out,'owned-browser-profile'),protocolTimeout:120000})
  browser=app.browser;page=app.page;report.consoleErrors=app.consoleErrors
  page.on('dialog',dialog=>dialog.accept())
  await page.evaluate(async step=>{
    const {runCommand}=await import('/src/commands/registry.ts')
    const {useShell}=await import('/src/state/shellStore.ts')
    const {useReverse}=await import('/plugins/reverse/state/reStore.ts')
    const {reverseSession}=await import('/plugins/reverse/app/reSession.ts')
    const {sceneOf}=await import('/src/commands/host.ts')
    const {reSceneOf}=await import('/plugins/reverse/viewer/reScene.ts')
    const {useWorkspaceEditor}=await import('/src/plugins/workspaceEditors.ts')
    useShell.getState().setWorkspace('reverse')
    for(let i=0;!reverseSession()&&i<500;i++)await new Promise(resolve=>setTimeout(resolve,20))
    if(!reverseSession())throw Error('QA CAD session unavailable')
    await reverseSession().startKernel();await reverseSession().settled()
    if(useReverse.getState().bodies.length)throw Error('Fresh QA project required; refusing existing bodies')
    await runCommand('reverse.import.step',{bytes:new TextEncoder().encode(step),name:'prequalified-curved-sheet.step'})
    await reverseSession().settled()
    const scene=sceneOf(),bodies=useReverse.getState().bodies,id=bodies[0]?.id
    if(!scene||!id||bodies.length!==1)throw Error('Expected one imported QA body')
    scene.fitToView()
    window.curvedBoundaryQa={scene,reScene:reSceneOf(scene),useWorkspaceEditor,useReverse,id}
  },input.toString('utf8'))
  await page.waitForFunction(()=>{
    const q=window.curvedBoundaryQa
    return !!q?.reScene.bodyMeshes.get(q.id)&&!q.useReverse.getState().building
  },{timeout:120000})
  await page.waitForSelector('[data-test=feature-edit-surface]:enabled',{timeout:60000})
  await page.click('[data-test=feature-edit-surface]')
  await page.waitForSelector('[data-test=workspace-surface-parameters]',{timeout:120000})
  await page.waitForFunction(()=>document.querySelectorAll('[data-test=surface-face] option').length===2,{timeout:60000})
  await page.select('[data-test=surface-face]','0')
  await page.waitForFunction(()=>{
    const s=window.curvedBoundaryQa.useWorkspaceEditor.getState(),p=s.controller?.getPanelState()
    return s.snapshot?.validation?.kind==='valid'&&p?.canFreeBoundary&&!p.calculating
  },{timeout:120000})
  await page.click('[data-test=surface-free-boundary]')
  await page.waitForFunction(()=>window.curvedBoundaryQa.useWorkspaceEditor.getState().controller?.getPanelState().canMoveWholeBoundary===true,{timeout:120000})
  await page.select('[data-test=surface-drag-mode]','axis')
  await page.click('[data-test=surface-axis-2]')
  // Same part-coordinate camera direction and pivot as the native curved
  // layer regression. Controls target must agree so the next frame keeps it.
  report.camera=await page.evaluate(()=>{
    const q=window.curvedBoundaryQa,host=q.scene.layerHost(),camera=host.camera(),group=host.partGroup
    const controls=q.scene.viewport?.controls
    if(!controls)throw Error('QA camera controls unavailable; refusing an unstable direct camera change')
    group.updateWorldMatrix(true,true)
    const origin=camera.position.clone().set(40,-25,45).applyMatrix4(group.matrixWorld)
    const target=camera.position.clone().set(10,15,10.7).applyMatrix4(group.matrixWorld)
    camera.position.copy(origin);camera.up.set(0,1,0).transformDirection(group.matrixWorld)
    controls.target.copy(target);camera.lookAt(target);camera.zoom=1
    const r=host.canvas.getBoundingClientRect(),aspect=r.width/r.height
    camera.left=-24*aspect;camera.right=24*aspect;camera.top=24;camera.bottom=-24
    camera.near=.1;camera.far=200;camera.updateProjectionMatrix();controls.update();camera.updateMatrixWorld(true);host.invalidate()
    return {position:camera.position.toArray(),target:controls.target.toArray(),quaternion:camera.quaternion.toArray(),verticalSpan:48,aspect}
  })
  await page.click('[data-test=surface-whole-boundary-drag]')
  await page.waitForFunction(()=>!!window.curvedBoundaryQa.useWorkspaceEditor.getState().controller?.getPanelState().wholeBoundaryDrag)
  const press=await page.evaluate(async()=>{
    const {wholeBoundaryPath}=await import('/plugins/tmar-edit-surface/wholeBoundary.ts')
    const q=window.curvedBoundaryQa,c=q.useWorkspaceEditor.getState().controller,host=q.scene.layerHost()
    const net=c.getViewState().net,path=wholeBoundaryPath(net,'U1'),fraction=.37*64,segment=Math.floor(fraction)
    const seed=path[segment].map((x,d)=>x+(fraction-segment)*(path[segment+1][d]-x))
    const point=host.camera().position.clone().set(...seed).applyMatrix4(host.partGroup.matrixWorld).project(host.camera())
    const r=host.canvas.getBoundingClientRect(),x=r.left+(point.x+1)*r.width/2,y=r.top+(1-point.y)*r.height/2
    if(!Number.isFinite(x)||!Number.isFinite(y)||Math.abs(point.z)>=1||x<r.left+8||x>r.right-8||y<r.top+8||y>r.bottom-8)throw Error('Known U1 anchor outside visible QA canvas')
    return {x,y,seed,segment,poles:net.poles.map(p=>[...p]),bodyCount:q.useReverse.getState().bodies.length}
  })
  report.pick={side:'U1',fraction:.37,segment:press.segment,seed:press.seed}
  await page.mouse.move(press.x,press.y);await page.mouse.down({button:'left'})
  await page.waitForFunction(()=>{
    const s=window.curvedBoundaryQa.useWorkspaceEditor.getState()
    return s.snapshot?.gesture==='pole'&&s.controller?.getPanelState().wholeBoundaryDrag==='U1'
  },{timeout:30000})
  check(true,'Real viewport U1 press promoted after asynchronous native proof')
  await page.mouse.move(press.x,press.y-6,{steps:3})
  await page.waitForFunction(before=>window.curvedBoundaryQa.useWorkspaceEditor.getState().controller.getViewState().net.poles.some((p,i)=>p.some((x,d)=>Math.abs(x-before[i][d])>1e-7)),{timeout:15000},press.poles)
  check(true,'Real pointer movement changed the curved draft during the gesture')
  await page.keyboard.press('Escape');await page.mouse.up({button:'left'})
  await page.waitForFunction(before=>{
    const s=window.curvedBoundaryQa.useWorkspaceEditor.getState(),c=s.controller,n=c.getViewState().net
    return s.snapshot?.gesture==='idle'&&s.snapshot?.validation?.kind==='valid'&&n.poles.every((p,i)=>p.every((x,d)=>Math.abs(x-before[i][d])<1e-8))
  },{timeout:120000},press.poles)
  check(true,'Escape restored all poles and a valid CAD preview')
  check(await page.$eval('[data-test=surface-whole-boundary-side]',e=>e.value)==='U1','Panel follows the U1 rim selected in the viewport')
  check(await page.evaluate(()=>window.curvedBoundaryQa.useReverse.getState().bodies.length)===press.bodyCount,'Gesture and Escape added no project body')
  assert.deepEqual(app.consoleErrors,[],'Application console errors')
  check(sha(readFileSync(fixture))===expectedSha,'Original curved STEP hash unchanged')
  report.verdict='PASS_BOUNDED_CURVED_GUI'
}catch(error){
  report.error=String(error?.stack??error);process.exitCode=1
  if(page)try{report.gateDiagnostic=await page.evaluate(()=>{
    const s=window.curvedBoundaryQa?.useWorkspaceEditor.getState(),p=s?.controller?.getPanelState()
    return {phase:s?.phase,validation:s?.snapshot?.validation?.kind,gesture:s?.snapshot?.gesture,message:p?.message,
      faceCount:p?.faces.length,freeBoundary:p?.freeBoundary,canMoveWholeBoundary:p?.canMoveWholeBoundary,
      calculating:p?.calculating,busy:p?.busy,wholeBoundaryDrag:p?.wholeBoundaryDrag}
  })}catch{}
}finally{
  if(browser)await browser.close()
  report.inputUnchanged=sha(readFileSync(fixture))===expectedSha
  writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify({out,...report}))
}
