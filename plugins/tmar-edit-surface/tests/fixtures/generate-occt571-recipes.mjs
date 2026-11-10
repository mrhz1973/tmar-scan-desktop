// SPDX-License-Identifier: AGPL-3.0-only
// Run with the pinned old checkout's vite-node. It reads that checkout only;
// TMAR_LEGACY_FIXTURE_OUT names the synthetic JSON written by this generator.
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const root = process.env.TMAR_LEGACY_SOURCE_ROOT
const output = process.env.TMAR_LEGACY_FIXTURE_OUT
if (!root || !output) throw new Error('Explicit old source root and fixture output are required.')
const packageJson = JSON.parse(readFileSync(join(root, 'node_modules/occt-wasm/package.json'), 'utf8'))
if (packageJson.version !== '5.7.1') throw new Error('Fixture generation requires the actual occt-wasm 5.7.1 runtime.')
const { SurfaceEditorKernel } = await import(join(root, 'plugins/tmar-edit-surface/editorKernel.ts'))
const { replaceSurface, surfaceTable } = await import(join(root, 'plugins/tmar-edit-surface/brep.ts'))
const { refineClampedNet } = await import(join(root, 'plugins/tmar-edit-surface/refineClampedNet.ts'))
const { encodeRecipePoint } = await import(join(root, 'plugins/tmar-edit-surface/recipe.ts'))
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const cases = []

function geometry(k, step) {
  const shape = k.importStep(step), faces = k.getSubShapes(shape, 'face'), solids = k.getSubShapes(shape, 'solid')
  try {
    return { valid: k.isValid(shape), faceCount: faces.length, solidCount: solids.length,
      volumeInformative: k.getVolume(shape), faces: faces.map(face => {
        const bounds = k.uvBounds(face), samples = []
        for (const s of [0, .25, .5, .75, 1]) for (const t of [0, .25, .5, .75, 1]) {
          const u = bounds.uMin + s * (bounds.uMax - bounds.uMin), v = bounds.vMin + t * (bounds.vMax - bounds.vMin)
          const p = k.pointOnSurface(face, u, v), n = k.surfaceNormal(face, u, v)
          samples.push({ u, v, point: [p.x, p.y, p.z], normal: [n.x, n.y, n.z] })
        }
        return { kind: k.surfaceType(face), bounds, samples }
      }) }
  } finally { [...faces, ...solids, shape].forEach(h => k.release(h)) }
}
function remember(name, editor, sourceStep, resultStep, recipe, net) {
  if (recipe.engine !== 'occt-wasm-5.7.1/brep-v3') throw new Error('The old producer did not identify itself correctly.')
  cases.push({ name, sourceStep, resultStep, recipe,
    expectedNet: { ...net, poles: net.poles.map(encodeRecipePoint) },
    sourceGeometry: geometry(editor.kernel, sourceStep), resultGeometry: geometry(editor.kernel, resultStep) })
}

for (const [version, free] of [[2, false], [3, true], [4, false], [4, true]]) {
  const editor = await SurfaceEditorKernel.load(), k = editor.kernel
  const owned = [], own = h => (owned.push(h), h)
  try {
    const box = own(k.makeBox(20, 30, 10)), faces = k.getSubShapes(box, 'face'); owned.push(...faces)
    const sourceStep = k.exportStep(free ? faces[5] : box), opened = editor.open(sourceStep)
    const face = free ? 0 : opened.faces.find(f => editor.select(f.index).poles.every(p => Math.abs(p[2] - 10) < 1e-6)).index
    let net = editor.select(face)
    if (version === 4) net = editor.select(face, [{ axis: 'U', value: (net.ku[0] + net.ku.at(-1)) / 2, count: 1 }])
    const index = free ? 0 : Math.floor(net.nu / 2) * net.nv + Math.floor(net.nv / 2)
    net.poles[index][2] += .15
    const continuity = free ? 'G0' : 'G1', result = editor.evaluate(net, continuity, true, free)
    const recipe = await editor.createRecipe(net, continuity, [index], `legacy-v${version}-${free ? 'free' : 'locked'}`, free)
    if (recipe.version !== version) throw new Error('Unexpected generated recipe version.')
    remember(`v${version}-${free ? 'free-sheet' : 'locked-solid'}`, editor, sourceStep, result.step, recipe, net)
  } finally { owned.reverse().forEach(h => k.release(h)); editor.dispose() }
}

{
  const editor = await SurfaceEditorKernel.load(), k = editor.kernel
  const owned = [], own = h => (owned.push(h), h)
  const rectangle = x => {
    const p = [{x,y:0,z:0},{x:x+10,y:0,z:0},{x:x+10,y:10,z:0},{x,y:10,z:0}]
    return own(k.makeFace(own(k.makeWire(p.map((a,i) => own(k.makeLineEdge(a,p[(i+1)%4])))))))
  }
  try {
    const shell = own(k.sew([rectangle(0), rectangle(10)], 1e-7)), sourceStep = k.exportStep(shell)
    const opened = editor.open(sourceStep), face = opened.faces.findIndex(f => !f.reason), base = editor.select(face)
    const {candidates:[choice]} = await editor.g1SupportCandidates()
    const u = choice.side === 'uMin' ? 1 : choice.side === 'uMax' ? base.nu-2 : Math.floor(base.nu/2)
    const v = choice.side === 'vMin' ? 1 : choice.side === 'vMax' ? base.nv-2 : Math.floor(base.nv/2)
    base.poles[u*base.nv+v][2] += .2; base.poles[0][2] = -0
    editor.evaluate(base, 'G0')
    const proposal = await editor.proposeG1PlaneTangency({net:base,choice})
    const accepted = await editor.publishG1PlaneTangency({baseNet:base,net:proposal.net,choice})
    const net = structuredClone(accepted.net); net.poles[12][2] += .08
    const result = await editor.evaluateG1PlaneTangency({constraintId:accepted.constraintId,net,exportStep:true})
    const recipe = await editor.createRecipe(net, 'G0', [], 'legacy-v5-plane', false, accepted.constraintId)
    remember('v5-plane-g1-signed-zero', editor, sourceStep, result.step, recipe, net)
  } finally { owned.reverse().forEach(h => k.release(h)); editor.dispose() }
}

{
  const editor = await SurfaceEditorKernel.load(), k = editor.kernel
  const owned = [], own = h => (owned.push(h), h)
  const build = (start, curved) => {
    const p = [{x:start,y:0,z:0},{x:start+10,y:0,z:0},{x:start+10,y:10,z:0},{x:start,y:10,z:0}]
    const seed = own(k.makeFace(own(k.makeWire(p.map((a,i) => own(k.makeLineEdge(a,p[(i+1)%4])))))))
    const text = k.toBREP(seed), record = surfaceTable(text).find(r => r.kind === 1), b = k.uvBounds(seed)
    const poles = [], q = [0,0,.2,0,0], greville = [0,1/6,.5,5/6,1]
    for (let u=0;u<4;u++) for (let v=0;v<5;v++) poles.push([start+10*u/3,10*greville[v],curved?(10*u/3)*q[v]:0])
    const net = refineClampedNet({nu:4,nv:5,du:3,dv:3,poles,weights:poles.map(()=>1),rational:[0,0],
      ku:[b.uMin,b.uMax],kv:[b.vMin,(b.vMin+b.vMax)/2,b.vMax],mu:[4,4],mv:[4,1,4]},
      [{axis:'U',value:(b.uMin+b.uMax)/2,count:1}])
    const support = own(k.fromBREP(replaceSurface(text,record,net)))
    const border = (ids, axis) => {
      const points=ids.map(i=>net.poles[i]),a=points[0],z=points.at(-1),d=z.map((x,i)=>x-a[i]),length=Math.hypot(...d)
      const straight=points.every(p=>Math.hypot(...p.map((x,i)=>x-a[i]-(d[i]/length)*p.reduce((sum,y,j)=>sum+(y-a[j])*d[j]/length,0)))<1e-9)
      return straight ? own(k.makeLineEdge({x:a[0],y:a[1],z:a[2]},{x:z[0],y:z[1],z:z[2]})) :
        own(k.makeBSplineEdge(points.flat(),ids.map(i=>net.weights[i]),axis==='u'?net.ku:net.kv,axis==='u'?net.mu:net.mv,3))
    }
    const wire=own(k.makeWire([border([0,5,10,15,20],'u'),border([20,21,22,23,24],'v'),border([24,19,14,9,4],'u'),border([4,3,2,1,0],'v')]))
    return own(k.fixShape(own(k.makeFaceOnSurface(support,wire))))
  }
  try {
    const shell=own(k.sew([build(0,false),build(10,true),build(-10,false)],1e-7)),sourceStep=k.exportStep(shell)
    editor.open(sourceStep)
    const shape=own(k.importStep(sourceStep)),faces=k.getSubShapes(shape,'face');owned.push(...faces)
    let selected=-1,support=-1
    faces.forEach((face,i)=>{const b=k.uvBounds(face),p=k.pointOnSurface(face,(b.uMin+b.uMax)/2,(b.vMin+b.vMax)/2)
      if(p.x>0&&p.x<10)selected=i
      if(p.x>10&&p.z>.1)support=i})
    const base=editor.select(selected);base.poles[0][2]=-0
    editor.evaluate(base,'G0')
    const choice=(await editor.g1CurvedSupportCandidates()).candidates.find(c=>c.supportFaceIndex===support)
    if (!choice) throw new Error('Synthetic curved support was not identified.')
    const proposal=await editor.proposeG1CurvedTangency({net:base,choice})
    const accepted=await editor.publishG1CurvedTangency({baseNet:base,net:proposal.net,choice})
    const net=structuredClone(accepted.net);net.poles[12][2]+=.08
    const result=await editor.evaluateG1CurvedTangency({constraintId:accepted.constraintId,net,exportStep:true})
    const recipe=await editor.createCurvedRecipe(net,'G0',[],'legacy-v6-curved',accepted.constraintId)
    remember('v6-curved-g1-signed-zero',editor,sourceStep,result.step,recipe,net)
  } finally { owned.reverse().forEach(h=>k.release(h));editor.dispose() }
}

const provenance = { package: packageJson.name, version: packageJson.version,
  sourceCommit: execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  editorKernelSha256: hash(readFileSync(join(root,'plugins/tmar-edit-surface/editorKernel.ts'))),
  recipeSha256: hash(readFileSync(join(root,'plugins/tmar-edit-surface/recipe.ts'))),
  wasmSha256: hash(readFileSync(join(root,'node_modules/occt-wasm/dist/occt-wasm.wasm'))) }
writeFileSync(output, JSON.stringify({schema:'tmar.synthetic-legacy-recipes-v1',provenance,cases},null,2)+'\n')
console.log(JSON.stringify({output,cases:cases.map(c=>c.name),provenance}))
