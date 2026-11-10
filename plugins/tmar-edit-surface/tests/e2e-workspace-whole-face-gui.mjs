// SPDX-License-Identifier: AGPL-3.0-only
// Isolated WIP Faces-only GUI probe. Uses one pinned curved open-sheet fixture.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

assert.equal(process.env.SCANRULER_ISOLATED, '1', 'Requires the isolated QA app.')
const url = new URL(process.env.APP_URL ?? '')
assert.equal(url.href, 'http://127.0.0.1:17527/', 'Only the designated isolated QA origin is permitted.')
const outputRoot = process.env.EDIT_SURFACE_QA_OUT
assert(outputRoot && isAbsolute(outputRoot), 'Evidence requires an absolute external output directory.')
const rel = relative(resolve(process.cwd()), resolve(outputRoot))
assert(rel && (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)), 'Evidence must stay outside the checkout.')
const fixture = process.env.WHOLE_FACE_QA_STEP || new URL('../evidence/free-boundary/compiled-20261103/moved.step', import.meta.url)
const input = readFileSync(fixture)
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const expectedSha = '61e1e624a432089e613cc9b744a7c883ccee3cd79ba459f0ef1c5c159419741f'
assert.equal(sha(input), expectedSha, 'Only the exact prequalified curved fixture may be used.')
const out = mkdtempSync(join(resolve(outputRoot), 'workspace-whole-face-gui-'))
process.env.SHOT_DIR = out
const report = {scope:'One curved open STEP sheet; UI Faces-only activation, viewport drag, lock gate and Undo',
  fixture:{path:'evidence/free-boundary/compiled-20261103/moved.step',sha256:expectedSha},checks:[],verdict:'INCOMPLETE',
  limitations:['Harness imports one pinned synthetic curved STEP into a fresh isolated project; it does not use user project data.',
    'One pinned synthetic curved surface only; automated pointer input is not physical mouse qualification.',
    'No Apply, project save/reopen, packaged build, or QuickSurface parity claim.']}
let browser, page
const check = (ok, label) => { assert(ok, label); report.checks.push(label) }
try {
  const response = await fetch(url, {signal:AbortSignal.timeout(5000)})
  assert(response.ok && /ScanRuler/i.test(await response.text()), 'QA origin must identify as ScanRuler.')
  const {launchApp} = await import('../../../scripts/e2e-lib.mjs')
  const app = await launchApp({url:url.href,width:1440,height:1000,agentDataOk:false,
    userDataDir:join(out,'owned-browser-profile'),protocolTimeout:120000})
  browser=app.browser; page=app.page; report.consoleErrors=app.consoleErrors
  page.on('dialog',dialog=>dialog.accept())
  await page.evaluate(async step => {
    const {runCommand} = await import('/src/commands/registry.ts')
    const {useShell} = await import('/src/state/shellStore.ts')
    const {useReverse} = await import('/plugins/reverse/state/reStore.ts')
    const {reverseSession} = await import('/plugins/reverse/app/reSession.ts')
    const {sceneOf} = await import('/src/commands/host.ts')
    const {reSceneOf} = await import('/plugins/reverse/viewer/reScene.ts')
    const {useWorkspaceEditor} = await import('/src/plugins/workspaceEditors.ts')
    useShell.getState().setWorkspace('reverse')
    for(let i=0;!reverseSession()&&i<500;i++) await new Promise(r=>setTimeout(r,20))
    if(!reverseSession()) throw Error('QA CAD session unavailable')
    await reverseSession().startKernel(); await reverseSession().settled()
    if(useReverse.getState().bodies.length) throw Error('Fresh QA project required; refusing existing bodies')
    await runCommand('reverse.import.step',{bytes:new TextEncoder().encode(step),name:'prequalified-curved-sheet.step'})
    await reverseSession().settled()
    const scene=sceneOf(), id=useReverse.getState().bodies[0]?.id
    if(!scene||!id||useReverse.getState().bodies.length!==1) throw Error('Expected one imported QA body')
    scene.fitToView()
    window.wholeFaceQa={scene,reScene:reSceneOf(scene),useWorkspaceEditor,useReverse,id}
  }, input.toString('utf8'))
  await page.waitForFunction(()=>{const q=window.wholeFaceQa;return !!q?.reScene.bodyMeshes.get(q.id)&&!q.useReverse.getState().building},{timeout:120000})
  await page.waitForSelector('[data-test=feature-edit-surface]:enabled',{timeout:60000})
  await page.click('[data-test=feature-edit-surface]')
  await page.waitForSelector('[data-test=workspace-surface-parameters]',{timeout:120000})
  await page.waitForFunction(()=>document.querySelectorAll('[data-test=surface-face] option').length===2,{timeout:60000})
  await page.select('[data-test=surface-face]','0')
  await page.waitForFunction(()=>{
    const s=window.wholeFaceQa.useWorkspaceEditor.getState(),p=s.controller?.getPanelState()
    return s.snapshot?.validation?.kind==='valid'&&p?.canFreeBoundary&&!p.calculating&&!p.busy
  },{timeout:120000})
  await page.click('[data-test=surface-free-boundary]')
  await page.waitForFunction(()=>window.wholeFaceQa.useWorkspaceEditor.getState().controller?.getPanelState().freeBoundary===true,{timeout:120000})
  await page.select('[data-test=surface-drag-mode]','screen')
  const pressButton = label => page.evaluate(text => {
    const panel=document.querySelector('[data-test=workspace-surface-parameters]')
    const button=[...panel.querySelectorAll('button')].find(item=>item.textContent.trim()===text)
    if(!button||button.disabled) throw Error(`Expected enabled UI button: ${text}`)
    button.click()
  }, label)
  await pressButton('Seleziona liberi')
  await pressButton('Blocca punti')
  const lockedState = await page.evaluate(() => {
    const c=window.wholeFaceQa.useWorkspaceEditor.getState().controller,p=c.getPanelState()
    const checkbox=document.querySelector('[data-test=surface-whole-face-drag]')
    return {lockedPoleCount:p.locked.length,canMoveWholeFace:p.canMoveWholeFace,checkboxDisabled:checkbox?.disabled}
  })
  check(lockedState.lockedPoleCount>0 && !lockedState.canMoveWholeFace && lockedState.checkboxDisabled,
    'Faces-only UI checkbox is disabled while poles are locked')
  await pressButton('Sblocca punti')
  await pressButton('Nessuno')
  // Unlocking invalidates the current preview; wait for CAD revalidation before
  // checking the UI gate or enabling Faces-only mode.
  await page.waitForFunction(() => {
    const s=window.wholeFaceQa.useWorkspaceEditor.getState(),p=s.controller?.getPanelState()
    return s.snapshot?.validation?.kind==='valid' && !p?.calculating && !p?.busy &&
      p?.locked?.length===0 && p?.canMoveWholeFace===true &&
      document.querySelector('[data-test=surface-whole-face-drag]')?.disabled===false
  },{timeout:120000})
  const unlockedState = await page.evaluate(() => {
    const c=window.wholeFaceQa.useWorkspaceEditor.getState().controller,p=c.getPanelState(),checkbox=document.querySelector('[data-test=surface-whole-face-drag]')
    return {canMoveWholeFace:p.canMoveWholeFace,checkboxDisabled:checkbox?.disabled,checked:checkbox?.checked}
  })
  const lockGate={...lockedState,canMoveAfterUnlock:unlockedState.canMoveWholeFace,
    checkboxEnabledAfterUnlock:unlockedState.checkboxDisabled===false}
  report.lockGate=lockGate
  check(lockGate.checkboxEnabledAfterUnlock && lockGate.canMoveAfterUnlock,
    'Unlocking all poles enables the Faces-only control')
  await page.click('[data-test=surface-whole-face-drag]')
  await page.waitForFunction(() => {
    const c=window.wholeFaceQa.useWorkspaceEditor.getState().controller
    return c.getPanelState().wholeFaceDrag===true && document.querySelector('[data-test=surface-whole-face-drag]')?.checked===true
  },{timeout:30000})
  const ready = await page.evaluate(() => {
    const q=window.wholeFaceQa,c=q.useWorkspaceEditor.getState().controller,p=c.getPanelState(),host=q.scene.layerHost()
    if(!p.canMoveWholeFace) throw Error(`Faces-only preconditions unavailable: ${JSON.stringify({faces:p.faces?.length,freeBoundary:p.freeBoundary,locked:p.locked?.length,hidden:p.hiddenPoles?.length})}`)
    const net=c.getViewState().net, camera=host.camera(),canvas=host.canvas,r=canvas.getBoundingClientRect()
    const previewGroup=host.scene.getObjectByName('tmar-edit-surface-preview')
    if(!previewGroup) throw Error('Rendered Edit Surface preview group is missing; refusing an estimated click point')
    previewGroup.updateWorldMatrix(true,true);camera.updateMatrixWorld(true)
    // Reuse constructors from the live host objects. This avoids a bare
    // module import in the page context, which Vite does not resolve here.
    const Vector3=camera.position.constructor, Raycaster=host.raycaster.constructor
    const raycaster=new Raycaster()
    let pick=null
    const meshes=previewGroup.children.filter(object=>object.isMesh&&object.userData.face===0)
    if(!meshes.length) throw Error('Rendered preview has no mesh for selected face 0')
    search: for(const mesh of meshes){
      const geometry=mesh.geometry,position=geometry.getAttribute('position'),index=geometry.getIndex()
      if(!position||!index) throw Error('Rendered face mesh has no indexed triangle geometry')
      for(let tri=0;tri+2<index.count;tri+=3){
        const a=new Vector3().fromBufferAttribute(position,index.getX(tri))
        const b=new Vector3().fromBufferAttribute(position,index.getX(tri+1))
        const d=new Vector3().fromBufferAttribute(position,index.getX(tri+2))
        const world=a.add(b).add(d).multiplyScalar(1/3).applyMatrix4(mesh.matrixWorld)
        const ndc=world.clone().project(camera),x=r.left+(ndc.x+1)*r.width/2,y=r.top+(1-ndc.y)*r.height/2
        if(!Number.isFinite(x)||!Number.isFinite(y)||Math.abs(ndc.z)>=1||x<r.left+20||x>r.right-20||y<r.top+20||y>r.bottom-20)continue
        // Raycaster only consumes x/y from the NDC argument; a Vector3 from
        // this same Three.js instance is structurally compatible.
        raycaster.setFromCamera(new Vector3((x-r.left)*2/r.width-1,1-(y-r.top)*2/r.height,0),camera)
        const hit=raycaster.intersectObjects(previewGroup.children,false).find(item=>item.object.userData.face===0)
        if(!hit)continue
        const dom=document.elementFromPoint(x,y),domTarget=dom===canvas?'canvas':dom?.tagName?.toLowerCase()??null
        if(dom!==canvas)continue
        pick={x,y,triangle:tri/3,face:hit.object.userData.face,hitDistance:hit.distance,domTarget}
        break search
      }
    }
    if(!pick) throw Error('Could not confirm an in-bounds indexed triangle by raycast on face 0 with canvas as elementFromPoint target')
    return {pick,raycastConfirmed:true,domConfirmed:true,poles:net.poles.map(p=>[...p]),count:net.poles.length,selectionCount:c.getViewState().selected.length}
  })
  report.pick=ready.pick
  check(ready.raycastConfirmed && ready.domConfirmed && ready.pick.face===0 && ready.pick.domTarget==='canvas',
    'Indexed preview triangle raycasts to face 0 and the canvas receives the target before gesture')
  // The face click/drag is a genuine viewport pointer gesture; setup uses only the isolated fixture.
  await page.mouse.move(ready.pick.x,ready.pick.y); await page.mouse.down({button:'left'})
  await page.waitForFunction(()=>window.wholeFaceQa.useWorkspaceEditor.getState().snapshot?.gesture==='pole',{timeout:30000})
  const selected = await page.evaluate(()=>{const c=window.wholeFaceQa.useWorkspaceEditor.getState().controller;return c.getViewState().selected.length})
  check(selected===ready.count,'Viewport skin press selects every face pole for one uniform gesture')
  await page.mouse.move(ready.pick.x+12,ready.pick.y-8,{steps:4})
  await page.waitForFunction(before=>{
    const n=window.wholeFaceQa.useWorkspaceEditor.getState().controller.getViewState().net
    return n.poles.some((p,i)=>p.some((x,d)=>Math.abs(x-before[i][d])>1e-7))
  },{timeout:15000},ready.poles)
  await page.mouse.up({button:'left'})
  await page.waitForFunction(()=>{const s=window.wholeFaceQa.useWorkspaceEditor.getState(),p=s.controller?.getPanelState();return s.snapshot?.gesture==='idle'&&s.snapshot?.validation?.kind==='valid'&&!p?.calculating&&!p?.busy},{timeout:120000})
  const moved = await page.evaluate(before=>{
    const c=window.wholeFaceQa.useWorkspaceEditor.getState().controller,n=c.getViewState().net
    const deltas=n.poles.map((p,i)=>p.map((x,d)=>x-before[i][d]))
    const delta=deltas[0],maxResidual=Math.max(...deltas.flatMap(v=>v.map((x,d)=>Math.abs(x-delta[d]))))
    const edgeIds=[...Array(n.poles.length).keys()].filter(i=>{const u=Math.floor(i/n.nv),v=i%n.nv;return u===0||u===n.nu-1||v===0||v===n.nv-1})
    return {delta,maxResidual,poleCount:n.poles.length,edgeCount:edgeIds.length,edgeMaxResidual:Math.max(...edgeIds.flatMap(i=>deltas[i].map((x,d)=>Math.abs(x-delta[d])))),selected:c.getViewState().selected.length}
  },ready.poles)
  report.translation=moved
  check(Math.hypot(...moved.delta)>1e-5&&moved.maxResidual<1e-8,'All face poles and edge poles share one measured translation')
  check(moved.selected===ready.count&&moved.edgeCount>0,'Gesture retains full-face selection including boundary poles')
  await page.click('[data-test=surface-whole-face-drag]')
  await page.waitForFunction(() => window.wholeFaceQa.useWorkspaceEditor.getState().controller.getPanelState().wholeFaceDrag===false,{timeout:30000})
  await page.evaluate(()=>window.wholeFaceQa.useWorkspaceEditor.getState().controller.undo())
  await page.waitForFunction(before=>{
    const s=window.wholeFaceQa.useWorkspaceEditor.getState(),n=s.controller?.getViewState().net
    return s.snapshot?.validation?.kind==='valid'&&s.snapshot?.gesture==='idle'&&n?.poles.every((p,i)=>p.every((x,d)=>Math.abs(x-before[i][d])<1e-8))
  },{timeout:120000},ready.poles)
  check(true,'Draft Undo restores all poles to the pre-gesture surface')
  assert.deepEqual(app.consoleErrors,[],'Application console errors')
  check(sha(readFileSync(fixture))===expectedSha,'Pinned synthetic STEP unchanged')
  report.verdict='PASS_BOUNDED_WHOLE_FACE_GESTURE'
} catch(error) {
  report.error=String(error?.stack??error); process.exitCode=1
  if(page) try {report.gateDiagnostic=await page.evaluate(()=>{
    const s=window.wholeFaceQa?.useWorkspaceEditor.getState(),p=s?.controller?.getPanelState()
    return {phase:s?.phase,error:s?.error,validation:s?.snapshot?.validation?.kind,gesture:s?.snapshot?.gesture,
      face:p?.face,faces:p?.faces?.length,freeBoundary:p?.freeBoundary,canMoveWholeFace:p?.canMoveWholeFace,
      locked:p?.locked?.length,hidden:p?.hiddenPoles?.length,calculating:p?.calculating,busy:p?.busy,message:p?.message}
  })}catch{}
} finally {
  if(browser) await browser.close()
  report.fixtureUnchanged=sha(readFileSync(fixture))===expectedSha
  writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify({out,...report}))
}
