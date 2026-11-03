// SPDX-License-Identifier: AGPL-3.0-only
// Human version, technical disclosure, theme and reload checks in an owned profile.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { launchApp } from '../../../scripts/e2e-lib.mjs'
assert(process.env.APP_URL, 'Provide an isolated preview URL')
const out=resolve(process.env.OUT_DIR ?? 'e2e-out/tmar-numbered-version');mkdirSync(out,{recursive:true})
const {browser,page,consoleErrors}=await launchApp({url:process.env.APP_URL,agentDataOk:false,width:1440,height:1000,userDataDir:mkdtempSync(join(out,'owned-profile-'))})
const expected=JSON.parse(readFileSync('tmar-version.json','utf8')),label=`Versione ${expected.number}`
const checks=[],check=(condition,label)=>{assert(condition,label);checks.push(label);console.log('PASS: '+label)}
try {
  const snapshot=()=>page.$eval('[data-test=tmar-build-version]',e=>({text:e.innerText,number:e.dataset.version,channel:e.dataset.channel,revision:e.dataset.revision,title:e.title,label:e.getAttribute('aria-label')}))
  const before=await snapshot()
  check(before.number===String(expected.number) && before.text.includes(label),'Human version is visible')
  check(before.channel===expected.channel && before.text.includes(expected.channel==='preview'?'Anteprima':'Stabile'),'Preview status is distinct')
  check(/^[a-f0-9]{40}$/.test(before.revision),'Actual source provenance remains available')
  check(!before.text.includes(before.revision.slice(0,7)) && !before.title.includes(before.revision.slice(0,7)),'No commit code is presented as the visible version or tooltip')
  check(before.label.includes(label),'Accessible name includes the human version')
  for(const theme of ['dark','light']) {
    await page.evaluate(theme=>{document.documentElement.dataset.theme=theme},theme)
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
    const box=await page.$eval('[data-test=tmar-build-version]',e=>{const r=e.getBoundingClientRect();return {width:r.width,height:r.height,inside:r.left>=0&&r.right<=innerWidth,notClipped:e.scrollWidth<=e.clientWidth+1}})
    check(box.width>0&&box.height>0&&box.inside&&box.notClipped,`Readable uncut version badge in ${theme} theme`)
    await (await page.$('.top')).screenshot({path:join(out,`version-header-${theme}.png`)})
  }
  await page.evaluate(()=>{document.documentElement.dataset.theme='dark'})
  await page.click('[data-test=tmar-build-version]');await page.waitForSelector('[data-test=tmar-build-details]')
  // Settings headings use text-transform: uppercase; compare the rendered wording case-insensitively.
  check((await page.$eval('[data-test=tmar-build-details]',e=>e.innerText)).toLowerCase().includes(label.toLowerCase()),'Settings repeats the same number')
  check(!(await page.$eval('[data-test=tmar-technical-details]',e=>e.open)),'Technical details initially collapsed')
  await page.click('[data-test=tmar-technical-details] summary')
  check((await page.$eval('[aria-label="TMAR source revision"]',e=>e.value))===before.revision,'Expanding details reveals the exact commit')
  await page.screenshot({path:join(out,'version-settings.png')})
  await page.click('[data-test=settings-close]');await page.reload({waitUntil:'networkidle0'})
  const after=await snapshot();check(after.number===before.number&&after.revision===before.revision,'Reload does not increment the version or replace source identity')
  check(consoleErrors.length===0,'No captured application errors')
  writeFileSync(join(out,'result.json'),JSON.stringify({pass:true,before,after,checks,consoleErrors},null,2))
} catch(error) {writeFileSync(join(out,'failure.json'),JSON.stringify({error:String(error),stack:error.stack,checks,consoleErrors},null,2));await page.screenshot({path:join(out,'failure.png')});throw error}
finally {await browser.close()}
