// SPDX-License-Identifier: AGPL-3.0-only
// Isolated shared-workspace QA of the D handle. Uses only a synthetic STEP
// sheet and its own browser profile. Does not apply a change to a project.
// Set STRIP_TEST_AXIS to X, Y or Z for the axis to verify.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

assert.equal(process.env.SCANRULER_ISOLATED,'1','Explicit isolated-host guard required')
const url=new URL(process.env.APP_URL ?? '')
assert.equal(url.href,'http://127.0.0.1:17527/','Only the designated isolated host is permitted')
const root=process.env.EDIT_SURFACE_QA_OUT
assert(root && isAbsolute(root),'Evidence folder must be absolute')
const rel=relative(resolve(process.cwd()),resolve(root))
assert(rel && (rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)),'Evidence must be outside the checkout')
const requestedAxis=process.env.STRIP_TEST_AXIS
assert(['X','Y','Z'].includes(requestedAxis),'STRIP_TEST_AXIS must be X, Y or Z')
const axisIndex={X:0,Y:1,Z:2}[requestedAxis]
mkdirSync(root,{recursive:true})
const out=mkdtempSync(join(root,'strip-handle-'+requestedAxis.toLowerCase()+'-')),downloads=join(out,'downloads')
mkdirSync(downloads)
process.env.SHOT_DIR=out
const report={scope:'isolated shared view, synthetic single-face STEP, D handle',requestedAxis,verdict:'INCOMPLETE',
  checks:[],notTested:['Apply or publication to project','user data','other STEP topologies']}
const persist=()=>writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2))
const check=(condition,label)=>{assert(condition,label);report.checks.push(label);persist();console.log('PASS',label)}
persist()
let kernel,browser,page
const events=[]
try {
  const {OcctKernel}=await import('occt-wasm')
  const {launchApp}=await import('../../../scripts/e2e-lib.mjs')
  kernel=await OcctKernel.init()
  const box=kernel.makeBox(20,30,10),faces=kernel.getSubShapes(box,'face')
  let source
  try {
    const face=faces.find(value=>Math.abs(kernel.getSurfaceArea(value)-600)<1e-7)
    assert(face,'Synthetic 20 x 30 mm face unavailable')
    source=kernel.exportStep(face)
  } finally {faces.forEach(value=>kernel.release(value));kernel.release(box)}
  report.inputSha256=createHash('sha256').update(source).digest('hex')
  writeFileSync(join(out,'synthetic-sheet.step'),source)
  const app=await launchApp({url:url.href,width:1440,height:1000,agentDataOk:false,
    userDataDir:join(out,'owned-browser-profile'),protocolTimeout:120000})
  browser=app.browser;page=app.page;report.consoleErrors=app.consoleErrors
  page.on('dialog',dialog=>dialog.accept())
  await page.evaluate(()=>window.addEventListener('pointerdown',event=>{window.stripHandlePointer=event.pointerId},true))
  const cdp=await page.createCDPSession()
  await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads,eventsEnabled:true})
  cdp.on('Browser.downloadWillBegin',event=>events.push({kind:'begin',guid:event.guid,name:event.suggestedFilename}))
  cdp.on('Browser.downloadProgress',event=>events.push({kind:'progress',guid:event.guid,state:event.state}))
  await page.evaluate(async step=>{
    const {runCommand}=await import('/src/commands/registry.ts')
    const {useShell}=await import('/src/state/shellStore.ts')
    const {useReverse}=await import('/plugins/reverse/state/reStore.ts')
    const {reverseSession}=await import('/plugins/reverse/app/reSession.ts')
    const {sceneOf}=await import('/src/commands/host.ts')
    const {reSceneOf}=await import('/plugins/reverse/viewer/reScene.ts')
    const {useWorkspaceEditor}=await import('/src/plugins/workspaceEditors.ts')
    const {useHistory}=await import('/src/state/historyStore.ts')
    useShell.getState().setWorkspace('reverse')
    for(let i=0;!reverseSession()&&i<500;i++)await new Promise(resolve=>setTimeout(resolve,20))
    if(!reverseSession())throw Error('CAD session unavailable')
    await reverseSession().startKernel();await reverseSession().settled()
    await runCommand('reverse.import.step',{bytes:new TextEncoder().encode(step),name:'synthetic-open-sheet.step'})
    await reverseSession().settled()
    const scene=sceneOf(),reverse=useReverse.getState(),id=reverse.bodies[0]?.id
    if(!scene || !id || reverse.bodies.length!==1)throw Error('Synthetic CAD body unavailable')
    scene.fitToView()
    window.stripHandleQa={scene,reScene:reSceneOf(scene),useWorkspaceEditor,useReverse,useHistory,id,
      before:{features:reverse.features,files:reverse.stepFiles,buildVersion:reverse.buildVersion,
        past:useHistory.getState().past,future:useHistory.getState().future}}
  },source)
  await page.waitForFunction(()=>{
    const q=window.stripHandleQa;return q.reScene.bodyMeshes.has(q.id)&&!q.useReverse.getState().building
  },{timeout:120000})
  await page.waitForSelector('[data-test=feature-edit-surface]:enabled',{timeout:60000})
  await page.click('[data-test=feature-edit-surface]')
  await page.waitForSelector('[data-test=workspace-surface-parameters]',{timeout:120000})
  await page.waitForFunction(()=>document.querySelectorAll('[data-test=surface-face] option').length===2,{timeout:60000})
  await page.select('[data-test=surface-face]','0')
  await page.waitForFunction(()=>{
    const s=window.stripHandleQa.useWorkspaceEditor.getState(),p=s.controller?.getPanelState()
    return p?.canBeginStrip&&s.snapshot?.validation?.kind==='valid'&&!p.calculating
  },{timeout:120000})
  await page.click('[data-test=surface-strip-begin]')
  await page.waitForFunction(()=>{
    const strip=window.stripHandleQa.useWorkspaceEditor.getState().controller?.getPanelState().strip
    return strip&&!strip.pending&&strip.paths.length===4
  },{timeout:120000})
  check(true,'The synthetic STEP sheet is open in the shared editor')

  // Choose an axis normal to an outer boundary in the sheet's plane. Project
  // that actual 3-D displacement into the shared viewport; do not fake rays.
  const target=await page.evaluate(requested=>{
    const q=window.stripHandleQa,state=q.useWorkspaceEditor.getState().controller.getViewState()
    const paths=state.strip.paths,points=paths.flat(),group=q.scene.layerHost().partGroup
    const canvas=q.scene.layerHost().canvas,rect=canvas.getBoundingClientRect(),camera=q.scene.layerHost().camera()
    group.updateWorldMatrix(true,true);camera.updateMatrixWorld(true)
    const low=[0,1,2].map(i=>Math.min(...points.map(p=>p[i]))),high=[0,1,2].map(i=>Math.max(...points.map(p=>p[i])))
    const center=low.map((v,i)=>(v+high[i])/2)
    const project=p=>{
      const v=group.position.clone().set(...p).applyMatrix4(group.matrixWorld).project(camera)
      return [rect.left+(v.x+1)*rect.width/2,rect.top+(1-v.y)*rect.height/2,v.z]
    }
    const choices=[]
    paths.forEach((path,edge)=>{
      if(path.length!==2)return
      const [a,b]=path,anchor=a.map((v,i)=>(v+b[i])/2)
      const axis=requested
      // The chosen direction must not be parallel to this edge. For X/Y,
      // extend outwards in the plane; for Z, either normal direction is safe.
      if(Math.abs(a[axis]-b[axis])>1e-7) return
      const signs=high[axis]-low[axis]<1e-6 ? [1,-1] : [anchor[axis]>center[axis]?1:-1]
      for(const sign of signs){
        const finish=[...anchor];finish[axis]+=sign*3
        const from=project(anchor),to=project(finish),dx=to[0]-from[0],dy=to[1]-from[1]
        const hx=Math.max(rect.left+14,Math.min(rect.right-14,from[0]+32))
        const hy=Math.max(rect.top+14,Math.min(rect.bottom-14,from[1]-32))
        if(from[2]<-1||from[2]>1||Math.hypot(dx,dy)<8||hx+dx<rect.left+16||hx+dx>rect.right-16||
           hy+dy<rect.top+16||hy+dy>rect.bottom-16)continue
        const element=document.elementFromPoint(hx,hy)
        if(element!==canvas && element?.dataset?.test!=='surface-strip-handle')continue
        choices.push({edge,axis,sign,anchor,dx,dy,edgeLength:Math.hypot(...b.map((v,i)=>v-a[i]))})
      }
    })
    return choices[0]??null
  },axisIndex)
  assert(target,'The requested axis is geometrically degenerate or not visible for a free edge in this view')
  report.target=target
  await page.select('[data-test=surface-strip-axis]',String(target.axis))
  await page.select('[data-test=surface-strip-edge]',String(target.edge))
  await page.waitForSelector('[data-test=surface-strip-handle]',{visible:true,timeout:10000})
  check(await page.evaluate(({edge,axis})=>{
    const strip=window.stripHandleQa.useWorkspaceEditor.getState().controller.getPanelState().strip
    return strip.selectedEdge===edge&&strip.axis===axis
  },target),'The selected edge and axis are shared by the panel and view')
  await page.screenshot({path:join(out,'before-drag.png')})

  const startDrag=async()=>{
    const box=await (await page.$('[data-test=surface-strip-handle]')).boundingBox()
    assert(box,'D handle is not visible')
    const start=[box.x+box.width/2,box.y+box.height/2],finish=[start[0]+target.dx,start[1]+target.dy]
    await page.mouse.move(...start);await page.mouse.down()
    await page.waitForFunction(()=>window.stripHandleQa.useWorkspaceEditor.getState().snapshot?.gesture==='strip',{timeout:10000})
    const captured=await page.evaluate(()=>{
      const q=window.stripHandleQa
      return q.scene.layerHost().canvas.hasPointerCapture(window.stripHandlePointer)
    })
    assert(captured,'D handle did not capture the pointer')
    await page.mouse.move(...finish,{steps:8})
    await page.waitForFunction(()=>{
      const strip=window.stripHandleQa.useWorkspaceEditor.getState().controller.getViewState().strip
      return strip&&Math.hypot(...strip.delta)>0.1
    },{timeout:10000})
    const observed=await page.evaluate(()=>{
      const q=window.stripHandleQa,state=q.useWorkspaceEditor.getState().controller.getViewState()
      const group=q.scene.layerHost().partGroup.getObjectByName('tmar-edit-surface-strip')
      let ghost;group?.traverse(item=>{if(item.isMesh&&!item.isLine2&&item.geometry?.getAttribute('position'))ghost=item})
      const p=ghost?.geometry.getAttribute('position'),button=document.querySelector('[data-test=surface-strip-handle]'),rect=button?.getBoundingClientRect()
      return {delta:[...state.strip.delta],axis:state.strip.axis,selected:state.strip.selectedEdge,
        highlighted:!!group?.getObjectByName('tmar-selected-strip-edge'),
        ghostVisible:!!ghost?.visible && ghost.material.opacity>0,
        ghostOffset:p&&p.count>=3?[p.getX(2)-p.getX(1),p.getY(2)-p.getY(1),p.getZ(2)-p.getZ(1)]:null,
        center:rect?[rect.left+rect.width/2,rect.top+rect.height/2]:null}
    })
    assert.equal(observed.axis,axisIndex)
    assert.equal(observed.selected,target.edge)
    assert(observed.delta[target.axis]*target.sign>0.1,'Drag did not move outwards on the selected axis')
    assert(observed.delta.every((value,i)=>i===target.axis||Math.abs(value)<1e-7),'Drag moved outside the chosen axis')
    assert(observed.highlighted&&observed.ghostVisible&&observed.ghostOffset&&
      observed.ghostOffset.every((value,i)=>Math.abs(value-observed.delta[i])<1e-4),'Live preview does not match the drag')
    assert(observed.center&&Math.hypot(observed.center[0]-start[0],observed.center[1]-start[1])>1,'D did not follow the preview')
    return observed
  }

  report.cancelledPreview=await startDrag()
  await page.screenshot({path:join(out,'drag-preview.png')})
  check(true,'D moves along the selected axis and the visible preview follows it')
  await page.keyboard.press('Escape')
  await page.waitForFunction(()=>{
    const s=window.stripHandleQa.useWorkspaceEditor.getState(),strip=s.controller?.getPanelState().strip
    return s.snapshot?.gesture==='idle'&&strip&&!strip.pending&&strip.delta.every(value=>value===0)
  },{timeout:10000})
  const cancelled=await page.evaluate(()=>{
    const q=window.stripHandleQa,strip=q.useWorkspaceEditor.getState().controller.getPanelState().strip
    return {captured:q.scene.layerHost().canvas.hasPointerCapture(window.stripHandlePointer),
      hasResult:strip.hasResult,canUndo:strip.canUndo,canRedo:strip.canRedo}
  })
  await page.mouse.up()
  check(!cancelled.captured&&!cancelled.hasResult&&!cancelled.canUndo&&!cancelled.canRedo,
    'Escape releases the pointer and discards the gesture without adding history')
  report.committedPreview=await startDrag()
  await page.mouse.up()
  await page.waitForFunction(()=>{
    const s=window.stripHandleQa.useWorkspaceEditor.getState(),strip=s.controller?.getPanelState().strip
    return strip?.hasResult&&!strip.pending&&s.snapshot?.validation?.kind==='valid'
  },{timeout:120000})
  const result=await page.evaluate(()=>{
    const q=window.stripHandleQa,s=q.useWorkspaceEditor.getState(),strip=s.controller.getPanelState().strip
    const handle=document.querySelector('[data-test=surface-strip-handle]')
    return {captured:q.scene.layerHost().canvas.hasPointerCapture(window.stripHandlePointer),addedArea:strip.addedArea,
      totalArea:strip.totalArea,canUndo:strip.canUndo,canRedo:strip.canRedo,selected:strip.selectedEdge,
      previewFaces:s.controller.getViewState().preview.faceMeshes.length,handleHidden:!handle||getComputedStyle(handle).display==='none'}
  })
  report.result=result
  const expectedArea=target.edgeLength*Math.abs(report.committedPreview.delta[target.axis])
  check(!result.captured&&result.previewFaces===2&&result.canUndo&&!result.canRedo&&result.selected===-1&&
    result.handleHidden&&Math.abs(result.addedArea-expectedArea)<1e-4,
    'Release validates the extension and creates exactly one strip history frame')
  await page.screenshot({path:join(out,'released-preview.png')})
  await page.click('[data-test=surface-strip-undo]')
  await page.waitForFunction(()=>{
    const s=window.stripHandleQa.useWorkspaceEditor.getState(),strip=s.controller?.getPanelState().strip
    return strip&&!strip.hasResult&&!strip.canUndo&&strip.canRedo&&s.controller.getViewState().preview.faceMeshes.length===1
  },{timeout:30000})
  check(true,'Undo restores the original single-face preview')
  await page.click('[data-test=surface-strip-redo]')
  await page.waitForFunction(expected=>{
    const s=window.stripHandleQa.useWorkspaceEditor.getState(),strip=s.controller?.getPanelState().strip
    return strip?.hasResult&&strip.canUndo&&!strip.canRedo&&s.snapshot?.validation?.kind==='valid'&&
      s.controller.getViewState().preview.faceMeshes.length===2&&Math.abs(strip.addedArea-expected)<1e-7
  },{timeout:30000},result.addedArea)
  check(true,'Redo restores the same validated extension')

  await page.waitForSelector('[data-test=surface-export-step]:enabled',{timeout:30000})
  await page.click('[data-test=surface-export-step]')
  const deadline=Date.now()+60000
  while(Date.now()<deadline&&!events.some(event=>event.kind==='progress'&&event.state==='completed'))
    await new Promise(resolve=>setTimeout(resolve,100))
  const completed=events.find(event=>event.kind==='progress'&&event.state==='completed')
  const started=events.find(event=>event.kind==='begin'&&event.guid===completed?.guid)
  assert(started,'The browser did not complete the STEP download')
  const bytes=readFileSync(join(downloads,started.name)),shape=kernel.importStep(bytes.toString('utf8'))
  const exportedFaces=kernel.getSubShapes(shape,'face'),shells=kernel.getSubShapes(shape,'shell'),solids=kernel.getSubShapes(shape,'solid')
  try {
    const edgeLists=exportedFaces.map(face=>kernel.getSubShapes(face,'edge'))
    try {
      const shared=edgeLists.length===2?edgeLists[0].filter(a=>edgeLists[1].some(b=>kernel.isSame(a,b))).length:0
      report.exported={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),
        valid:kernel.isValid(shape),faces:exportedFaces.length,shells:shells.length,solids:solids.length,
        area:kernel.getSurfaceArea(shape),sharedEdges:shared}
      check(report.exported.valid&&report.exported.faces===2&&report.exported.shells===1&&report.exported.solids===0&&
        report.exported.sharedEdges===1&&Math.abs(report.exported.area-result.totalArea)<1e-4,
        'Downloaded STEP reimports as a valid two-face shell with one shared seam')
    } finally {edgeLists.flat().forEach(edge=>kernel.release(edge))}
  } finally {exportedFaces.forEach(face=>kernel.release(face));shells.forEach(shell=>kernel.release(shell));
    solids.forEach(solid=>kernel.release(solid));kernel.release(shape)}
  const untouched=await page.evaluate(()=>{
    const q=window.stripHandleQa,reverse=q.useReverse.getState(),history=q.useHistory.getState()
    return reverse.bodies.length===1&&reverse.bodies[0].id===q.id&&reverse.buildVersion===q.before.buildVersion&&
      reverse.features===q.before.features&&reverse.stepFiles===q.before.files&&history.past===q.before.past&&history.future===q.before.future
  })
  check(untouched,'The synthetic project and its history were not published or changed')
  check(report.consoleErrors.length===0,'No browser application errors')
  report.verdict='PASS'
} catch(error) {
  report.verdict='FAIL';report.error=String(error?.stack??error)
  if(page){
    try{await page.screenshot({path:join(out,'failure.png')})}catch{/* preserve error */}
    try{report.diagnostics=await page.evaluate(()=>{
      const q=window.stripHandleQa,s=q?.useWorkspaceEditor.getState(),p=s?.controller?.getPanelState()
      return {phase:s?.phase,error:s?.error,snapshot:s?.snapshot,message:p?.message,strip:p?.strip}
    })}catch{/* browser may be unavailable */}
  }
  process.exitCode=1
} finally {
  if(browser)await browser.close()
  kernel?.[Symbol.dispose]()
  report.downloadEvents=events;persist()
  console.log(JSON.stringify({out,verdict:report.verdict,error:report.error}))
}
