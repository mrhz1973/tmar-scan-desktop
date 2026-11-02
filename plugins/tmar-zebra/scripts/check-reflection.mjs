// SPDX-License-Identifier: AGPL-3.0-only
// Isolated WebGL checks for the reflection frame, independent of app controls.
// Optional --before renders the recorded pre-fix revision for comparison.
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'
import { CHROME } from '../../../scripts/e2e-lib.mjs'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const output = resolve(root, 'e2e-out/zebra-reference')
mkdirSync(output, { recursive: true })
const before = process.argv.includes('--before')
const prefix = before ? 'before' : 'current'
const baseline = 'cc6ea7e733ef840f01791a2d822ef72bf0a5029f'
const code = `
import * as THREE from 'three';
import { ZebraLayer } from './plugins/tmar-zebra/ZebraLayer';
const scene = new THREE.Scene(); scene.background = new THREE.Color('#b5b5b5');
const camera = new THREE.OrthographicCamera(-26.556,26.556,26.556,-26.556,.1,1000);
camera.position.set(0,0,100); camera.lookAt(0,0,0);
const renderer = new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
renderer.setSize(640,640); renderer.setPixelRatio(1); renderer.outputColorSpace=THREE.SRGBColorSpace;
document.body.style.margin='0'; document.body.append(renderer.domElement);
const material = new THREE.MeshBasicMaterial({color:0x80b7d0,side:THREE.DoubleSide});
const mesh = new THREE.Mesh(new THREE.SphereGeometry(20,128,96),material); scene.add(mesh);
const body2 = new THREE.Mesh(new THREE.BoxGeometry(10,10,10),material);
body2.position.set(70,0,0); body2.visible=false; scene.add(body2);
const bodies=new Map([[1,mesh],[2,body2]]);
let options={target:'visible',selectedIds:[],orientation:'horizontal',width:4,color:'#5388b1'};
const layer = new ZebraLayer({bodies:()=>bodies,scan:()=>null,radius:()=>Math.sqrt(3)*20,invalidate:()=>{}},options);
const render=()=>{layer.tick(); renderer.render(scene,camera); return renderer.domElement.toDataURL();};
window.fixture={render,action(name){
 if(name==='dolly') camera.position.z=500;
 if(name==='translate') {mesh.position.x=80; camera.position.x=80;}
 if(name==='select') {options={...options,target:'selected',selectedIds:[1]};layer.setOptions(options);}
 if(name==='showSecond') {body2.position.x=150;body2.visible=true;}
 if(name==='allBodies') {options={...options,target:'visible'};layer.setOptions(options);}
 if(name==='hideSecond') body2.visible=false;
 if(name==='vertical') {options={...options,orientation:'vertical'};layer.setOptions(options);}
 if(name==='torus') {mesh.geometry.dispose();mesh.geometry=new THREE.TorusGeometry(20,7,64,128);mesh.position.set(0,0,0);camera.position.set(0,0,100);camera.lookAt(0,0,0);camera.left=-36;camera.right=36;camera.top=36;camera.bottom=-36;camera.updateProjectionMatrix();options={...options,orientation:'horizontal'};layer.setOptions(options);}
 if(name==='rotate') {camera.position.set(65,40,100);camera.lookAt(0,0,0);}
 if(name==='back') {mesh.geometry.dispose();mesh.geometry=new THREE.PlaneGeometry(30,30);mesh.rotation.y=Math.PI;camera.position.set(0,0,100);camera.lookAt(0,0,0);}
 if(name==='dispose') layer.dispose();
 return render();
},pixels(){return renderer.domElement.toDataURL();}};
render();`
const result=await build({stdin:{contents:code,resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser',
  plugins:before?[{name:'recorded-before',setup(b){b.onLoad({filter:/[\\/]plugins[\\/]tmar-zebra[\\/]ZebraLayer\.ts$/},()=>({contents:execFileSync('git',['show',baseline+':plugins/tmar-zebra/ZebraLayer.ts'],{cwd:root,encoding:'utf8'}),loader:'ts'}))}}]:[]})
const server=createServer((req,res)=>{
  res.setHeader('Content-Type',req.url==='/fixture.js'?'text/javascript':'text/html');
  res.end(req.url==='/fixture.js'?result.outputFiles[0].text:'<!doctype html><script type="module" src="/fixture.js"></script>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
const errors=[]; const measurements={baseline:before?baseline:null};
try{
  browser=await puppeteer.launch({executablePath:CHROME,headless:true,defaultViewport:{width:640,height:640},args:['--no-sandbox',...(process.env.CI?['--enable-unsafe-swiftshader']:[])]});
  const page=await browser.newPage();
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error') errors.push(m.text());});
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.waitForFunction(()=>window.fixture,{timeout:20000});
  const snapshots={};
  for(const name of ['horizontal','dolly','translate','select','showSecond','allBodies','hideSecond','vertical','torus','rotate','back','dispose']){
    snapshots[name]=await page.evaluate(n=>n==='horizontal'?window.fixture.render():window.fixture.action(n),name);
    writeFileSync(resolve(output,prefix+'-'+name+'.png'),Buffer.from(snapshots[name].split(',')[1],'base64'));
  }
  const diff=(a,b)=>page.evaluate(async(a,b)=>{
    const read=async src=>{const img=new Image();img.src=src;await img.decode();const c=document.createElement('canvas');c.width=c.height=640;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);return ctx.getImageData(0,0,640,640).data;};
    const aa=await read(a),bb=await read(b);let changed=0;
    for(let i=0;i<aa.length;i+=4) if(Math.abs(aa[i]-bb[i])+Math.abs(aa[i+1]-bb[i+1])+Math.abs(aa[i+2]-bb[i+2])>6) changed++;
    return changed/(640*640)*100;
  },snapshots[a],snapshots[b]);
  measurements.dollyChangedPercent=await diff('horizontal','dolly');
  measurements.translateChangedPercent=await diff('dolly','translate');
  measurements.selectionChangedPercent=await diff('translate','select');
  measurements.visibleFrameChangedPercent=await diff('select','showSecond');
  measurements.selectedFrameChangedPercent=await diff('showSecond','allBodies');
  measurements.hiddenFrameRestoreChangedPercent=await diff('select','hideSecond');
  measurements.directionChangedPercent=await diff('select','vertical');
  measurements.rotationChangedPercent=await diff('torus','rotate');
  measurements.backsideRestoreChangedPercent=await diff('back','dispose');
  measurements.errors=errors;
  writeFileSync(resolve(output,prefix+'-measurements.json'),JSON.stringify(measurements,null,2)+'\n');
  console.log(JSON.stringify(measurements,null,2));
  if(errors.length || (!before && (measurements.dollyChangedPercent>.01 || measurements.translateChangedPercent>.01 || measurements.selectionChangedPercent>.01 || measurements.visibleFrameChangedPercent<1 || measurements.selectedFrameChangedPercent>.01 || measurements.hiddenFrameRestoreChangedPercent>.01 || measurements.directionChangedPercent<10 || measurements.rotationChangedPercent<5 || measurements.backsideRestoreChangedPercent>.01))) process.exitCode=1;
}finally{
  await browser?.close();
  await new Promise(r=>server.close(r));
}
