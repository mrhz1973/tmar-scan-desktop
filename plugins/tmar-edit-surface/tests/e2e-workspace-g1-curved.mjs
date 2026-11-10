// SPDX-License-Identifier: AGPL-3.0-only
// Synthetic native 5x5 three-face shell; simulated input, no real-scan/global G1 proof.
import assert from 'node:assert/strict'
import {mkdirSync,mkdtempSync,readdirSync,readFileSync,writeFileSync} from 'node:fs'
import {isAbsolute,join,relative,resolve,sep} from 'node:path'
import {OcctKernel} from 'occt-wasm'
import ts from 'typescript'

assert.equal(process.env.SCANRULER_ISOLATED,'1','Explicit isolated-host guard required')
const url=new URL(process.env.APP_URL??'')
assert.equal(url.href,'http://127.0.0.1:17723/','Only the designated isolated host is permitted')
const root=process.env.EDIT_SURFACE_QA_OUT
assert(root&&isAbsolute(root),'Absolute external evidence directory required')
const rel=relative(resolve(process.cwd()),resolve(root))
assert(rel&&(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)),'Evidence must be outside checkout')
mkdirSync(root,{recursive:true})
const out=mkdtempSync(join(root,'workspace-g1-curved-')),downloads=join(out,'downloads')
mkdirSync(downloads);process.env.SHOT_DIR=out
const report={scope:'synthetic native 5x5 curved-support seam and third analytic planar face; real worker/controller and simulated UI input',checks:[],verdict:'INCOMPLETE',
  limitations:'Only this natural shared edge and compatible native B-spline support with varying normals are exercised; no global G1, real scan, physical input, compiled app or macOS qualification.'}
const persist=()=>writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2))
const check=(ok,label)=>{assert(ok,label);report.checks.push(label);persist();console.log('PASS',label)}
const k=await OcctKernel.init(),owned=[]
// Load the actual local fixture helpers without generating intermediate files.
const localTs=async name=>{
  const source=readFileSync(new URL('../'+name,import.meta.url),'utf8')
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
  return import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'))
}
const {replaceSurface,surfaceTable}=await localTs('brep.ts')
const {refineClampedNet}=await localTs('refineClampedNet.ts')
async function fixture() {
    const editor = { kernel: k, dispose() { } };
    const owned = [];
    const own = (h) => { owned.push(h); return h; };
    const build = (start, curved) => {
        const p = [{ x: start, y: 0, z: 0 }, { x: start + 10, y: 0, z: 0 }, { x: start + 10, y: 10, z: 0 }, { x: start, y: 10, z: 0 }];
        const seedWire = own(k.makeWire(p.map((a, i) => own(k.makeLineEdge(a, p[(i + 1) % 4])))));
        const seed = own(k.makeFace(seedWire)), text = k.toBREP(seed), record = surfaceTable(text).find(r => r.kind === 1), b = k.uvBounds(seed);
        const poles = [];
        // Cubic V basis with one midpoint knot; q and dq vanish at both ends.
        const q = [0, 0, .2, 0, 0], greville = [0, 1 / 6, .5, 5 / 6, 1];
        for (let u = 0; u < 4; u++)
            for (let v = 0; v < 5; v++)
                poles.push([start + 10 * u / 3, 10 * greville[v], curved ? (10 * u / 3) * q[v] : 0]);
        const seedNet = { nu: 4, nv: 5, du: 3, dv: 3, poles, weights: poles.map(() => 1), rational: [0, 0], ku: [b.uMin, b.uMax], kv: [b.vMin, (b.vMin + b.vMax) / 2, b.vMax], mu: [4, 4], mv: [4, 1, 4] };
        const net = refineClampedNet(seedNet, [{ axis: 'U', value: (b.uMin + b.uMax) / 2, count: 1 }]);
        const support = own(k.fromBREP(replaceSurface(text, record, net)));
        const border = (ids, axis) => {
            const points = ids.map(i => net.poles[i]), a = points[0], z = points.at(-1), d = z.map((x, i) => x - a[i]), length = Math.hypot(...d);
            const straight = points.every(p => Math.hypot(...p.map((x, i) => x - a[i] - (d[i] / length) * p.reduce((sum, y, j) => sum + (y - a[j]) * d[j] / length, 0))) < 1e-9);
            return straight ? own(k.makeLineEdge({ x: a[0], y: a[1], z: a[2] }, { x: z[0], y: z[1], z: z[2] })) :
                own(k.makeBSplineEdge(points.flat(), ids.map(i => net.weights[i]), axis === 'u' ? net.ku : net.kv, axis === 'u' ? net.mu : net.mv, 3));
        };
        const wire = own(k.makeWire([border([0, 5, 10, 15, 20], 'u'), border([20, 21, 22, 23, 24], 'v'), border([24, 19, 14, 9, 4], 'u'), border([4, 3, 2, 1, 0], 'v')]));
        const face = own(k.fixShape(own(k.makeFaceOnSurface(support, wire))));
        return { face, net };
    };
    try {
        const p = [{ x: -10, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 10, z: 0 }, { x: -10, y: 10, z: 0 }];
        const planeEdges = p.map((a, i) => own(k.makeLineEdge(a, p[(i + 1) % 4])));
        const third = own(k.makeFace(own(k.makeWire(planeEdges))));
        const selected = build(0, false), support = build(10, true), shell = own(k.sew([selected.face, support.face, third], 1e-7)), step = k.exportStep(shell);
        return { editor, k, selected, support, shell, step, dispose: () => { owned.reverse().forEach(h => k.release(h)); editor.dispose(); } };
    }
    catch (error) {
        owned.reverse().forEach(h => k.release(h));
        editor.dispose();
        throw error;
    }
}

let browser,page
const inspect=step=>{
  const shape=k.importStep(step),faces=k.getSubShapes(shape,'face'),solids=k.getSubShapes(shape,'solid')
  try {
    const samples=faces.map(face=>{
      const b=k.uvBounds(face),points=[]
      for(const s of [0,.25,.5,.75,1])for(const t of [0,.25,.5,.75,1]){
        const u=b.uMin+s*(b.uMax-b.uMin),v=b.vMin+t*(b.vMax-b.vMin),p=k.pointOnSurface(face,u,v),n=k.surfaceNormal(face,u,v)
        points.push({at:[p.x,p.y,p.z],normal:[n.x,n.y,n.z]})
      }
      return points
    })
    return {valid:k.isValid(shape),faces:faces.length,solids:solids.length,samples}
  }finally{faces.forEach(f=>k.release(f));solids.forEach(s=>k.release(s));k.release(shape)}
}
const ready=()=>page.waitForFunction(()=>{
  const s=window.g1CurvedQa.useWorkspaceEditor.getState(),p=s.controller?.getPanelState()
  return s.snapshot?.validation.kind==='valid'&&!p?.busy&&!p?.calculating&&!!p?.net
},{timeout:120000})
const poles=()=>page.evaluate(()=>window.g1CurvedQa.useWorkspaceEditor.getState().controller.getPanelState().net.poles)
const waitPoles=expected=>page.waitForFunction(expected=>{
  const s=window.g1CurvedQa.useWorkspaceEditor.getState(),p=s.controller?.getPanelState()
  return s.snapshot?.validation.kind==='valid'&&!p?.calculating&&JSON.stringify(p?.net?.poles)===JSON.stringify(expected)
},{timeout:120000},expected)
try{
  const built=await fixture(),input=built.step;built.dispose();writeFileSync(join(out,'source.step'),input)
  report.source=inspect(input)
  check(report.source.valid&&report.source.faces===3&&report.source.solids===0,'fixture is a valid three-face shell with native curved support')
  const {launchApp}=await import('../../../scripts/e2e-lib.mjs')
  const app=await launchApp({url:url.href,width:1440,height:1000,agentDataOk:false,userDataDir:join(out,'owned-browser-profile'),protocolTimeout:120000})
  browser=app.browser;page=app.page;report.consoleErrors=app.consoleErrors
  page.on('dialog',d=>void d.accept())
  const cdp=await page.createCDPSession()
  await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads,eventsEnabled:true})
  await page.evaluate(async step=>{
    const {runCommand}=await import('/src/commands/registry.ts')
    const {useShell}=await import('/src/state/shellStore.ts')
    const {useReverse}=await import('/plugins/reverse/state/reStore.ts')
    const {useNotes}=await import('/plugins/reverse/state/noteStore.ts')
    const {reverseSession}=await import('/plugins/reverse/app/reSession.ts')
    const {useWorkspaceEditor}=await import('/src/plugins/workspaceEditors.ts')
    const {useHistory}=await import('/src/state/historyStore.ts')
    const {sceneOf}=await import('/src/commands/host.ts')
    useShell.getState().setWorkspace('reverse')
    for(let i=0;!reverseSession()&&i<500;i++)await new Promise(r=>setTimeout(r,20))
    if(!reverseSession())throw Error('CAD session unavailable')
    await reverseSession().startKernel();await reverseSession().settled()
    await runCommand('reverse.import.step',{bytes:new TextEncoder().encode(step),name:'g1-curved-native-shell.step'})
    await reverseSession().settled()
    const id=useReverse.getState().bodies[0]?.id
    if(!id||useReverse.getState().bodies.length!==1)throw Error('Shell import failed')
    const sourceBefore=(await reverseSession().client().bodyEditSource(id)).text
    const scene=sceneOf();scene.fitToView();scene.viewFrom('top')
    window.g1CurvedQa={useReverse,useNotes,reverseSession,useWorkspaceEditor,useHistory,scene,id,sourceBefore,history:useHistory.getState().past.length}
  },input)
  await page.waitForSelector('[data-test=feature-edit-surface]:enabled',{timeout:60000})
  await page.click('[data-test=feature-edit-surface]')
  await page.waitForSelector('[data-test=surface-face]',{timeout:120000})
  const canonical=inspect(await page.evaluate(()=>window.g1CurvedQa.sourceBefore))
  const face=canonical.samples.findIndex(samples=>samples.every(s=>Math.abs(s.at[2])<1e-8)&&samples.reduce((sum,s)=>sum+s.at[0],0)/samples.length>0)
  const support=canonical.samples.findIndex(samples=>samples.reduce((sum,s)=>sum+s.at[0],0)/samples.length>10)
  assert(face>=0&&support>=0,'Canonical selected and curved support faces are identifiable')
  report.selectedFace=face;report.supportFace=support
  assert.notEqual(face,undefined,'Editable plane exists')
  await page.select('[data-test=surface-face]',String(face));await ready()
  await page.select('[data-test=surface-continuity]','G0');await ready()
  const original=await poles()
  // Match g1PublishedKernel fixture: one interior pole immediately adjacent to x=10.
  const target=await page.evaluate(()=>{
    const q=window.g1CurvedQa,c=q.useWorkspaceEditor.getState().controller,v=c.getViewState(),net=v.net
    const choices=net.poles.flatMap((p,id)=>{
      const u=Math.floor(id/net.nv),w=id%net.nv
      return u>0&&u<net.nu-1&&w>0&&w<net.nv-1&&!v.locked.includes(id)?[{id,p}]:[]
    }).sort((a,b)=>Math.abs(a.p[0]-10)-Math.abs(b.p[0]-10)||Math.abs(a.p[1]-5)-Math.abs(b.p[1]-5))
    const chosen=choices[0];if(!chosen)return null
    const host=q.scene.layerHost(),rect=host.canvas.getBoundingClientRect(),camera=host.camera(),group=host.partGroup
    group.updateWorldMatrix(true,true);camera.updateMatrixWorld(true)
    const p=group.position.clone().set(...chosen.p).applyMatrix4(group.matrixWorld).project(camera)
    const x=rect.left+(p.x+1)*rect.width/2,y=rect.top+(1-p.y)*rect.height/2
    return {id:chosen.id,x,y,visible:document.elementFromPoint(x,y)===host.canvas}
  })
  assert(target?.visible,'Interior pole must be visibly clickable')
  await page.select('[data-test=surface-selection-mode]','points')
  await page.mouse.click(target.x,target.y)
  await page.waitForFunction(id=>window.g1CurvedQa.useWorkspaceEditor.getState().controller.getPanelState().selected.includes(id),{},target.id)
  await page.select('[data-test=surface-drag-mode]','local');await page.click('[data-test=surface-axis-2]')
  await page.$eval('[data-test=surface-distance]',e=>{
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'0.2');e.dispatchEvent(new Event('input',{bubbles:true}))
  })
  await page.click('[data-test=surface-move]');await ready()
  const defect=await poles()
  check(Math.abs(defect[target.id][2]-original[target.id][2])>.1,'UI move creates the adjacent-row tangency defect')
  await page.screenshot({path:join(out,'defect.png')})
  await page.click('[data-test=surface-g1-load]')
  await page.waitForFunction(support=>window.g1CurvedQa.useWorkspaceEditor.getState().controller.getPanelState().g1Candidates.some(c=>c.kind==='compatible-bspline'&&c.supportFaceIndex===support),{timeout:120000},support)
  const candidate=await page.evaluate(support=>window.g1CurvedQa.useWorkspaceEditor.getState().controller.getPanelState().g1Candidates.find(c=>c.kind==='compatible-bspline'&&c.supportFaceIndex===support)?.id,support)
  assert(candidate,'Actual curved support required');await page.select('[data-test=surface-g1-support]',candidate)
  await page.waitForSelector('[data-test=surface-g1-apply]:enabled');await page.click('[data-test=surface-g1-apply]');await ready()
  await page.waitForFunction(()=>window.g1CurvedQa.useWorkspaceEditor.getState().controller.getPanelState().curvedTangencyActive,{timeout:120000})
  const corrected=await poles()
  check(corrected[target.id][2]<-.3,'G1 button repairs the defective adjacent pole against the varying-normal support')
  report.g1Status=await page.$eval('[data-test=surface-g1-status]',e=>e.textContent)
  assert.match(report.g1Status,/attivo nella bozza/,'Explicit local G1 status is visible')
  assert.match(report.g1Status,/supporto B-spline compatibile/i,'Visible status identifies the compatible B-spline support')
  await page.click('[data-test=surface-undo]');await waitPoles(defect)
  assert.equal(await page.evaluate(()=>window.g1CurvedQa.useWorkspaceEditor.getState().controller.getPanelState().curvedTangencyActive),false)
  await page.click('[data-test=surface-redo]');await waitPoles(corrected)
  assert.equal(await page.evaluate(()=>window.g1CurvedQa.useWorkspaceEditor.getState().controller.getPanelState().curvedTangencyActive),true)
  check(true,'local Undo/Redo restore the defect and the corrected CAD net')
  await page.click('[data-test=surface-zebra]');await page.click('[data-test=surface-note-add]')
  // CAD anchoring is direct; point movement/G1 and note text use actual UI controls.
  await page.evaluate(async()=>{
    const c=window.g1CurvedQa.useWorkspaceEditor.getState().controller,v=c.getViewState(),m=v.preview.faceMeshes[v.face]
    const ids=[...m.indices.slice(0,3)],p=[0,1,2].map(a=>ids.reduce((sum,id)=>sum+m.positions[id*3+a],0)/3)
    await c.placeNote(p)
  })
  await page.waitForSelector('[data-test=surface-note-text]');await page.type('[data-test=surface-note-text]','Nota G1 curva con Zebra')
  await page.waitForFunction(()=>{
    const c=window.g1CurvedQa.useWorkspaceEditor.getState().controller,p=c.getPanelState(),v=c.getViewState()
    return p.notes[0]?.text==='Nota G1 curva con Zebra'&&v.notePins.length===1&&!!v.stripes
  },{timeout:30000})
  check(true,'resolved note and Zebra coexist after G1 and local history')
  await page.screenshot({path:join(out,'g1-zebra-note.png')})
  const annotated=await page.evaluate(()=>window.g1CurvedQa.useWorkspaceEditor.getState().controller.getPanelState().annotatedCopyAvailable)
  assert(annotated,'This scenario requires the real annotation-capable QA host')
  await page.waitForSelector('[data-test=workspace-editor-apply]:enabled',{timeout:120000});await page.click('[data-test=workspace-editor-apply]')
  await page.waitForFunction(()=>{const s=window.g1CurvedQa.useWorkspaceEditor.getState();return s.phase==='closed'||!!s.error},{timeout:120000})
  const applied=await page.evaluate(async()=>{
    const q=window.g1CurvedQa,s=q.useWorkspaceEditor.getState(),copy=s.receipt?.createdBodyIds?.[0]
    return {phase:s.phase,error:s.error,receipt:s.receipt,bodies:q.useReverse.getState().bodies,notes:q.useNotes.getState().notes,
      history:q.useHistory.getState().past.length-q.history,sourceBefore:q.sourceBefore,
      features:q.useReverse.getState().features.map(f=>({id:f.id,kind:f.kind,annotationFeatureUuid:f.annotationSource?.featureUuid})),
      source:(await q.reverseSession().client().bodyEditSource(q.id)).text,
      copy:copy?(await q.reverseSession().client().bodyEditSource(copy)).text:null}
  })
  assert.equal(applied.phase,'closed',`Apply refused: ${applied.error}`)
  assert.equal(applied.receipt?.mode,'annotated-cad-copy')
  assert(typeof applied.receipt.createdFeatureUuid==='string'&&applied.receipt.createdFeatureUuid.length>0,'Annotated feature UUID is explicit')
  const importedCopy=applied.features.find(f=>f.annotationFeatureUuid===applied.receipt.createdFeatureUuid)
  assert.equal(importedCopy?.kind,'import','Host persists the resulting CAD artifact; no editable curved recipe is claimed')
  report.copyPersistenceType=importedCopy.kind
  check(applied.bodies.length===2&&applied.receipt?.createdBodyIds.length===1&&applied.history===1,'Apply publishes exactly one CAD copy and one history step')
  assert.deepEqual(inspect(applied.source),inspect(applied.sourceBefore),'Original CAD source remains unchanged')
  report.copy=inspect(applied.copy)
  check(report.copy.valid&&report.copy.faces===3&&report.copy.solids===0,'published copy remains a valid three-face shell')
  const beforeGeometry=inspect(applied.sourceBefore)
  for(let index=0;index<3;index++)if(index!==face){
    for(let sample=0;sample<beforeGeometry.samples[index].length;sample++)for(let d=0;d<3;d++){
      assert(Math.abs(report.copy.samples[index][sample].at[d]-beforeGeometry.samples[index][sample].at[d])<1e-8,'Unselected face position preserved')
      assert(Math.abs(report.copy.samples[index][sample].normal[d]-beforeGeometry.samples[index][sample].normal[d])<1e-8,'Unselected face normal preserved')
    }
  }
  const copied=k.importStep(applied.copy),copiedFaces=k.getSubShapes(copied,'face')
  try{
    const a=k.uvBounds(copiedFaces[face]),b=k.uvBounds(copiedFaces[support]);let maxGap=0,maxSin=0
    for(let i=0;i<=32;i++){
      const t=i/32,p=k.pointOnSurface(copiedFaces[face],a.uMax,a.vMin+t*(a.vMax-a.vMin)),q=k.pointOnSurface(copiedFaces[support],b.uMin,b.vMin+t*(b.vMax-b.vMin))
      const n=k.surfaceNormal(copiedFaces[face],a.uMax,a.vMin+t*(a.vMax-a.vMin)),m=k.surfaceNormal(copiedFaces[support],b.uMin,b.vMin+t*(b.vMax-b.vMin))
      maxGap=Math.max(maxGap,Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z))
      maxSin=Math.max(maxSin,Math.hypot(n.y*m.z-n.z*m.y,n.z*m.x-n.x*m.z,n.x*m.y-n.y*m.x))
    }
    report.seamReadback={samples:33,maxGap,maxSin}
    check(maxGap<1e-8&&maxSin<1e-9,'Independent STEP readback confirms sampled varying-normal G1 seam')
  }finally{copiedFaces.forEach(h=>k.release(h));k.release(copied)}
  check(true,'Curved support and the other face retain their sampled geometry')
  // watchAnnotations deliberately marks new managed notes unresolved while its
  // async CAD verification runs. Read the current store after verification,
  // rather than asserting against the earlier Apply snapshot.
  report.appliedNotesInitial=applied.notes;report.applyReceipt=applied.receipt;persist()
  if(annotated){
    await page.waitForFunction(copy=>window.g1CurvedQa.useNotes.getState().notes.some(n=>
      n.text==='Nota G1 curva con Zebra'&&n.attachment?.status==='verified'&&n.on[0]?.body===copy),
      {timeout:120000},applied.receipt.createdBodyIds[0])
    applied.notes=await page.evaluate(()=>window.g1CurvedQa.useNotes.getState().notes)
    report.appliedNotesVerified=applied.notes
    check(applied.notes.some(n=>n.text==='Nota G1 curva con Zebra'&&n.attachment?.status==='verified'&&n.on[0]?.body===applied.receipt.createdBodyIds[0]),'annotated host binds the verified note to the copy')
  }
  writeFileSync(join(out,'g1-copy.step'),applied.copy)
  await page.waitForSelector('[data-test=save-project]:enabled',{timeout:30000});await page.click('[data-test=save-project]')
  let saved
  for(let i=0;i<400;i++){
    const name=readdirSync(downloads).find(n=>n.endsWith('.scanruler'));if(name){saved=join(downloads,name);break}
    await new Promise(r=>setTimeout(r,100))
  }
  assert(saved,'Sheet-capable host must save its project')
  page=await browser.newPage();page.on('dialog',d=>void d.accept());page.on('pageerror',e=>report.consoleErrors.push('reopen: '+e.message))
  await page.goto(url.href,{waitUntil:'domcontentloaded'});await page.waitForSelector('[data-test=project-input]')
  await(await page.$('[data-test=project-input]')).uploadFile(saved);await page.click('[data-test=workspace-reverse]')
  await page.evaluate(async()=>{
    const {useReverse}=await import('/plugins/reverse/state/reStore.ts'),{useNotes}=await import('/plugins/reverse/state/noteStore.ts')
    const {reverseSession}=await import('/plugins/reverse/app/reSession.ts')
    window.g1CurvedReopen={useReverse,useNotes,reverseSession}
  })
  await page.waitForFunction(()=>window.g1CurvedReopen.useReverse.getState().bodies.length===2&&!window.g1CurvedReopen.useReverse.getState().building,{timeout:120000})
  if(annotated)await page.waitForFunction(expected=>window.g1CurvedReopen.useNotes.getState().notes.some(n=>
    n.text===expected.text&&n.attachment?.noteUuid===expected.uuid&&n.attachment?.status==='verified'&&n.on[0]?.body===expected.body),
    {timeout:120000},{text:'Nota G1 curva con Zebra',uuid:applied.notes.find(n=>n.text==='Nota G1 curva con Zebra').attachment.noteUuid,body:applied.receipt.createdBodyIds[0]})
  const reopened=await page.evaluate(async ids=>{
    const q=window.g1CurvedReopen
    return {source:(await q.reverseSession().client().bodyEditSource(ids.source)).text,copy:(await q.reverseSession().client().bodyEditSource(ids.copy)).text,notes:q.useNotes.getState().notes}
  },{source:applied.bodies.find(b=>b.id!==applied.receipt.createdBodyIds[0]).id,copy:applied.receipt.createdBodyIds[0]})
  assert.deepEqual(inspect(reopened.source),inspect(applied.source));assert.deepEqual(inspect(reopened.copy),report.copy)
  if(annotated){const note=applied.notes.find(n=>n.text==='Nota G1 curva con Zebra');check(reopened.notes.some(n=>n.text===note.text&&n.attachment?.noteUuid===note.attachment.noteUuid&&n.attachment?.status==='verified'),'reopening preserves verified note identity')}
  report.persistence='Annotated CAD copy and note only; no editable curved G1 recipe is saved or claimed'
  check(true,'saved/reopened project preserves source and copied shell geometry')
  check(report.consoleErrors.length===0,'no browser application errors')
  report.verdict='PASS'
}catch(error){report.verdict='FAIL';report.error=String(error?.stack??error);process.exitCode=1;if(page)try{await page.screenshot({path:join(out,'failure.png')})}catch{}}
finally{if(browser)await browser.close();owned.forEach(h=>k.release(h));k[Symbol.dispose]();persist();console.log(JSON.stringify({out,...report},null,2))}





