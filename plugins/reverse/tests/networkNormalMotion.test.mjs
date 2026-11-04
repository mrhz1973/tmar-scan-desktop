// SPDX-License-Identifier: AGPL-3.0-only
// Run: node --experimental-strip-types --test plugins/reverse/tests/networkNormalMotion.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCentreOffset, centreOffsetPoint, setCentreOffsetDistance, reanchorCentreOffset,
  readCentreOffset, normalAxisParameter, beginCentreNormalDrag, sampleCentreNormalDrag,
  cancelCentreNormalDrag } from '../core/networkNormalMotion.ts'
const near = (a, b, eps=1e-10) => assert.ok(Math.abs(a-b) < eps, `${a} != ${b}`)
const pointNear = (a,b) => a.forEach((v,i)=>near(v,b[i]))
const offset = () => createCentreOffset([10,20,30],[0,0,1],2)
const pointer = (z, x=0, extras={}) => ({pointerId:1,screen:[x,0],viewKey:'view-1',ray:{origin:[100,20,z],direction:[-1,0,0]},...extras})
const drag = () => beginCentreNormalDrag(offset(),pointer(32),{maxAbsDistance:100})

test('numeric normal offset keeps the on-scan anchor unchanged',()=>{const v=offset();assert.deepEqual(centreOffsetPoint(v),[10,20,32]);assert.deepEqual(v.anchor,[10,20,30])})
test('positive, negative and zero distances are explicit',()=>{for(const n of [5,-5,0])assert.equal(centreOffsetPoint(setCentreOffsetDistance(offset(),n))[2],30+n)})
test('non-unit input normal is normalized without scaling millimetres',()=>{assert.deepEqual(centreOffsetPoint(createCentreOffset([0,0,0],[0,0,9],4)),[0,0,4])})
test('normal on an inclined surface is not silently replaced by world Z',()=>{pointNear(centreOffsetPoint(createCentreOffset([1,2,3],[1,2,2],3)),[2,4,5])})
test('part-Z is supported by explicitly supplying that axis',()=>{assert.deepEqual(centreOffsetPoint(createCentreOffset([1,2,3],[0,0,1],-2)),[1,2,1])})
test('degenerate and nonfinite directions are refused',()=>{for(const d of [[0,0,0],[NaN,0,1],[0,0,Infinity]])assert.throws(()=>createCentreOffset([0,0,0],d))})
test('overflow is refused instead of producing invalid coordinates',()=>{assert.throws(()=>createCentreOffset([0,0,Number.MAX_VALUE],[0,0,1],Number.MAX_VALUE))})
test('input arrays are copied and frozen',()=>{const a=[1,2,3],n=[0,0,1],v=createCentreOffset(a,n,2);a[0]=99;n[2]=-1;assert.deepEqual(centreOffsetPoint(v),[1,2,5]);assert.ok(Object.isFrozen(v.anchor))})
test('JSON round-trip retains anchor, orientation and distance',()=>{const v=createCentreOffset([1.1,2.2,3.3],[1,2,3],-4.5);assert.deepEqual(readCentreOffset(JSON.parse(JSON.stringify(v))),v)})
test('unknown versions, units, frames and fields are rejected',()=>{for(const patch of [{version:2},{units:'m'},{coordinateFrame:'world'},{unexpected:1},{direction:[0,0,2]}])assert.throws(()=>readCentreOffset({...offset(),...patch}))})
test('tangential re-anchoring preserves height and adopts the explicit new normal',()=>{const a=reanchorCentreOffset(offset(),[20,30,40],[0,1,0]);assert.deepEqual(centreOffsetPoint(a),[20,32,40]);assert.deepEqual(offset().anchor,[10,20,30])})
test('orthographic ray measures the normal line in millimetres',()=>{near(normalAxisParameter(offset(),pointer(35).ray),5)})
test('perspective ray to a target gives the same height',()=>{const target=[10,20,37],origin=[100,-50,80];near(normalAxisParameter(offset(),{origin,direction:target.map((x,i)=>x-origin[i])}),7)})
test('head-on normal refuses unstable pointer motion',()=>{assert.throws(()=>normalAxisParameter(offset(),{origin:[10,20,100],direction:[0,0,-1]}),/rotate/);assert.equal(centreOffsetPoint(setCentreOffsetDistance(offset(),8))[2],38)})
test('subthreshold motion and exactly the threshold do not deform',()=>{for(const x of [0,1,4])assert.equal(sampleCentreNormalDrag(drag(),pointer(33,x)).kind,'idle')})
test('drag height is relative to the press, not accumulated per sample',()=>{const d=drag(),a=sampleCentreNormalDrag(d,pointer(35,10));assert.equal(a.kind,'moved');near(a.offset.distance,5);const b=sampleCentreNormalDrag(a.drag,pointer(35,10));assert.deepEqual(b.point,a.point)})
test('threshold stays active when dragging back to the press',()=>{const a=sampleCentreNormalDrag(drag(),pointer(35,10));const b=sampleCentreNormalDrag(a.drag,pointer(32,0));assert.equal(b.kind,'moved');near(b.offset.distance,2)})
test('pointer grab offset does not cause a jump',()=>{const d=beginCentreNormalDrag(offset(),pointer(35),{maxAbsDistance:100});const a=sampleCentreNormalDrag(d,pointer(36,12));near(a.offset.distance,3)})
test('a second pointer cannot change the draft',()=>{assert.equal(sampleCentreNormalDrag(drag(),pointer(40,20,{pointerId:2})).kind,'ignored')})
test('camera or part-frame revision changes reject the gesture',()=>{assert.equal(sampleCentreNormalDrag(drag(),pointer(40,20,{viewKey:'view-2'})).kind,'rejected')})
test('distance guard rejects without silently clamping',()=>{const d=beginCentreNormalDrag(offset(),pointer(32),{maxAbsDistance:3});const r=sampleCentreNormalDrag(d,pointer(40,20));assert.equal(r.kind,'rejected');assert.deepEqual(cancelCentreNormalDrag(r.drag),offset())})
test('Esc/cancel returns the exact pre-gesture constraint',()=>{const d=drag(),r=sampleCentreNormalDrag(d,pointer(40,20));assert.equal(cancelCentreNormalDrag(r.drag),d.before)})
test('rotating part rays, anchor and normal gives covariant motion',()=>{const rot=p=>[p[2]+7,p[0]-3,p[1]+2],dir=p=>[p[2],p[0],p[1]];const v=createCentreOffset(rot([10,20,30]),dir([0,0,1]),2);const r={origin:rot([100,20,35]),direction:dir([-1,0,0])};near(normalAxisParameter(v,r),5)})
test('invalid pointer and negative threshold cannot start a gesture',()=>{assert.throws(()=>beginCentreNormalDrag(offset(),pointer(32,0,{pointerId:-1}),{maxAbsDistance:100}));assert.throws(()=>beginCentreNormalDrag(offset(),pointer(32),{maxAbsDistance:100,thresholdPx:-1}))})
