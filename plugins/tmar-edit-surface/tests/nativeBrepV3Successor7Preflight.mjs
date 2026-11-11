// SPDX-License-Identifier: AGPL-3.0-only
// Read-only preflight for successor7 native V3. Never consumes a CAD marker.
import {readFileSync,existsSync,writeFileSync} from 'node:fs'
import {join,resolve,sep} from 'node:path'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'

const root=resolve(process.env.TMAR_NATIVE_V3_SUCCESSOR_ROOT||'D:/TMAR_EDIT_SURFACE_NATIVE_V3_INPUTS_20261111')
const repo=resolve(process.env.TMAR_NATIVE_V3_REPO||process.cwd())
const original=resolve(process.env.TMAR_NATIVE_V3_PROTECTED_REPO||
  'C:/Users/mrhz/.codex/worktrees/edit-surface-tubo-periodic/tmar-scan-desktop-zebra')
const detached=resolve(process.env.TMAR_NATIVE_V3_FROZEN_DIR||
  'D:/TMAR_EDIT_SURFACE_NATIVE_20261111')
const sha=b=>createHash('sha256').update(b).digest('hex')
const manifest=[
  ['supports/face-321.net.json','ae008b6e187bb262be0d48e78c49e18504998cb123e9e2766c198c909ee57b75'],
  ['supports/face-322.net.json','b60b126dac307bb90c96c8bd4e2618250bdb2e7bb6cc4441179f55f8079af054'],
  ['supports/face-323.net.json','aff35bb02ec4fcca3029b4a5e18dd99c51e7645be0ddf652d2d43a10bcc22e4e'],
  ['supports/protected-face-324-reference.net.json','bd07285b2c59bdd70d94ad98be1d38356baa41fe1eabe79c5ae5e291835bf9d3'],
  ['seams/face-321-quintic-v-curve.json','b87273febbfacdc5b377dbaefc24088e777176ab2331d722359a6f5795175a87'],
  ['seams/face-323-quintic-v-curve.json','ffdd04576cd54c58c2142403dcaed470c34cdbe1da1fe1ac81ef3595b0f028f7']
]
const candidate=[
  ['stored-candidate-successor7.local/candidate.local/candidate.coefficients.local.json','65aad438fef18cbf67a10d9c356b353d58f31011f5bad025041c094ec45c0bc4'],
  ['stored-candidate-successor7.local/candidate.local/qualification.receipt.local.json','aca25e62b0f222c91406ba51b10b45634158a712c4dcb99d48d459e7afb5a847'],
  ['continuous-successor7.local/t2-frozen-target.local.json','9c1212e391c43fd5a124ba6edd88a1a5d5b50ea523c233758fe4843d33598ae7'],
  ['native-successor7-contract.local/native-contract.local.json','149def38ba1bc766efdc14cb36ca463e5fc74e3deaa48b14de5ae184c020962b']
]
const pinned=[
  ['face-321.source.brep','10c20fdbd4752cb4642ffd9ec8a4d6f7860dd8d4ef9c93d979bcc7e6cda5ce0a'],
  ['face-322.source.brep','9ee0420ec25064f89bdaa049f9f1e6899c6c0a185d4797f53831bd0212ccfa64'],
  ['face-323.source.brep','be5d618395055efb262e53c200e435754a5675b870a9d19e8d422f2156ef2148']
]
const check=(folder,relative,expected)=> {
  const file=join(folder,relative)
  if(!existsSync(file))return {path:file,status:'MISSING'}
  const bytes=readFileSync(file)
  const current=sha(bytes)
  return {path:file,status:current===expected?'PIN_VERIFIED':'PIN_MISMATCH',
    sha256:current,bytes:bytes.length}
}
const git=(folder,args)=>execFileSync('git',['-C',folder,...args],{encoding:'utf8'}).trim()
const receipt={schema:'TMAR_NATIVE_V3_SUCCESSOR7_PREFLIGHT_V1',dateUtc:new Date().toISOString(),
  scope:'input+runtime+Windows protection preflight, no CAD run',
  candidateId:'tubo-6b-t2-successor7-storage-candidate-1',candidateRoot:root,
  detachedFiles:pinned.map(([p,h])=>check(detached,p,h)),
  supportAndSeamFiles:manifest.map(([p,h])=>check(join(root,'native-successor7-contract.local'),p,h)),
  savedCandidateAndContract:candidate.map(([p,h])=>check(root,p,h)),
  runtime:[],sourceCapture:{},originalProtection:{},code:{},missing:[],mismatch:[],
  markerCreated:false,kernelInitializations:0,solverCalls:0,CADLiveActions:0,STEPExports:0}
const expectedSource='f0b051806750fb503519c13f2f24e9e2b2e97221'
receipt.code={branch:git(repo,['branch','--show-current']),sha:git(repo,['rev-parse','HEAD'])}
const bp=join(original,'plugins/tmar-edit-surface/evidence/candidate-t2-f0b0518.local/baseline.local.json')
const baseline=JSON.parse(readFileSync(bp,'utf8'))
let match=0,failed=0
for(const f of baseline.protectedFiles){
  const full=resolve(original,f.path)
  if(!full.toLowerCase().startsWith(original.toLowerCase()+sep)||!existsSync(full)){failed++;continue}
  const b=readFileSync(full)
  if(b.length===f.bytes&&sha(b)===f.sha256)match++;else failed++
}
receipt.originalProtection={head:git(original,['rev-parse','HEAD']),
  branch:git(original,['branch','--show-current']),
  wip:git(original,['status','--porcelain=v1','--untracked-files=all']).split(/\r?\n/).filter(Boolean).length,
  staged:git(original,['diff','--cached','--name-only']).length,
  protectedExpected:baseline.protectedFiles.length,protectedVerified:match,protectedFailed:failed}
receipt.sourceCapture=check(join(original,'plugins/tmar-edit-surface/evidence/modified-candidate-1887859.local'),
  'source-capture.local.json','02a34618425c96fe82e7355a9b31467a09399849b7cb3339d6b1fda89e7d1539')
const pkg=join(original,'node_modules/occt-wasm')
receipt.runtime=[
  check(join(pkg,'dist'),'occt-wasm.js','1f9068dcef229e4c1e39126710012c92211d46e577520adc6e40716f862b6ceb'),
  check(join(pkg,'dist'),'occt-wasm.wasm','bb664d8f07c11b0d2ea1fc5a0bfd858e8cc927088c7c37ad24a86e50c004dca2')
]
const all=[...receipt.detachedFiles,...receipt.supportAndSeamFiles,...receipt.savedCandidateAndContract,...receipt.runtime,receipt.sourceCapture]
receipt.missing=all.filter(x=>x.status==='MISSING').map(x=>x.path)
receipt.mismatch=all.filter(x=>x.status==='PIN_MISMATCH').map(x=>x.path)
const protectionGood=receipt.originalProtection.head===expectedSource&&
  receipt.originalProtection.branch==='codex/edit-surface-tubo-periodic'&&
  receipt.originalProtection.wip===66&&receipt.originalProtection.staged===0&&
  receipt.originalProtection.protectedVerified===194&&failed===0
const isReady=receipt.missing.length===0&&receipt.mismatch.length===0&&protectionGood&&
  receipt.code.branch==='codex/edit-surface-native-v3-20261111'
receipt.status=isReady?'INPUT_PREFLIGHT_READY_NO_NATIVE_ATTEMPT':'WAIT_INPUT_OR_PROTECTION'
const out=resolve(process.env.TMAR_NATIVE_V3_PREFLIGHT_RECEIPT||'D:/TMAR_EDIT_SURFACE_NATIVE_V3_QA_20261111/successor7-preflight.readonly.json')
writeFileSync(out,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'})
console.log(JSON.stringify({status:receipt.status,verifiedFiles:all.filter(x=>x.status==='PIN_VERIFIED').length,
  missing:receipt.missing,hashMismatches:receipt.mismatch,protection:receipt.originalProtection,
  code:receipt.code,receiptSha256:sha(readFileSync(out)),
  kernelInitializations:0,markerCreated:false},null,2))
