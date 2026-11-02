// SPDX-License-Identifier: AGPL-3.0-only
// Public UI against a compiled bundle, fresh browser contexts, no user profiles.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { preview } from 'vite'
import puppeteer from 'puppeteer-core'
const root = fileURLToPath(new URL('../', import.meta.url))
const out = process.env.OUT_DIR ?? join(root, 'e2e-out', 'dark-default')
mkdirSync(out, { recursive: true })
const server = process.env.APP_URL ? null : await preview({ root, preview: { host: '127.0.0.1', port: 0, open: false } })
const url = process.env.APP_URL ?? server.resolvedUrls.local[0]
const executablePath = process.env.CHROME ?? (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome')
let browser; let checks = 0; const errors = []
const check = (ok, label) => { assert.ok(ok, label); checks++; console.log('PASS: ' + label) }
try {
  browser = await puppeteer.launch({ executablePath, headless: true, userDataDir: mkdtempSync(join(out, 'owned-profile-')), defaultViewport: { width: 1500, height: 1000 } })
  for (const c of [
    { name: 'fresh-light-os', os: 'light', saved: null, expected: 'dark', choice: 'dark' },
    { name: 'fresh-dark-os', os: 'dark', saved: null, expected: 'dark', choice: 'dark' },
    { name: 'invalid', os: 'light', saved: 'invalid', expected: 'dark', choice: 'dark' },
    { name: 'saved-light', os: 'dark', saved: 'light', expected: 'light', choice: 'light' },
    { name: 'saved-dark', os: 'light', saved: 'dark', expected: 'dark', choice: 'dark' },
    { name: 'saved-system-light', os: 'light', saved: 'system', expected: 'light', choice: 'system' },
    { name: 'saved-system-dark', os: 'dark', saved: 'system', expected: 'dark', choice: 'system' },
    { name: 'storage-blocked', os: 'light', saved: null, blocked: true, expected: 'dark', choice: 'dark' },
  ]) {
    const context = await browser.createBrowserContext(), page = await context.newPage()
    page.on('pageerror', e => errors.push(c.name + ': ' + e.message))
    page.on('console', m => { if (m.type() === 'error') errors.push(c.name + ': ' + m.text()) })
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: c.os }])
    await page.evaluateOnNewDocument(c => {
      if (c.blocked) Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('Blocked storage', 'SecurityError') } })
      else if (c.saved !== null && !sessionStorage.getItem('theme-fixture-seeded')) {
        localStorage.setItem('scanruler.uitheme', c.saved); sessionStorage.setItem('theme-fixture-seeded', '1')
      }
    }, c)
    await page.goto(url, { waitUntil: 'networkidle0' }); await page.waitForSelector('.panel')
    check(await page.$eval('html', e => e.dataset.theme) === c.expected, c.name + ': compiled app resolves the expected theme')
    await page.click('[data-test=open-settings]'); await page.waitForSelector('[data-test=settings-modal]')
    check(await page.$eval(`[data-test=ui-theme-${c.choice}]`, e => e.getAttribute('aria-checked') === 'true'), c.name + ': Settings agrees with the rendered theme')
    check(await page.$eval('[data-test=toggle-agent-link]', e => !e.checked), c.name + ': no agent connection is enabled')
    if (c.name === 'fresh-light-os') {
      await page.screenshot({ path: join(out, 'dark-settings.png') })
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }])
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
      check(await page.$eval('html', e => e.dataset.theme) === 'dark', 'default Dark ignores OS theme changes')
      await page.click('[data-test=ui-theme-light]')
      check(await page.$eval('html', e => e.dataset.theme) === 'light', 'explicit Light is still available')
      await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('.panel')
      check(await page.$eval('html', e => e.dataset.theme) === 'light', 'explicit Light persists after reload')
      await page.click('[data-test=open-settings]'); await page.click('[data-test=ui-theme-system]')
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }])
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
      check(true, 'explicit System follows a live change to dark')
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
      check(true, 'explicit System follows a live change to light')
      await page.click('[data-test=ui-theme-dark]'); await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('.panel')
      check(await page.$eval('html', e => e.dataset.theme) === 'dark', 'explicit Dark persists on a light OS')
    }
    await context.close()
  }
  check(errors.length === 0, 'no application console/page errors: ' + JSON.stringify(errors))
  writeFileSync(join(out, 'result.json'), JSON.stringify({ checks, errors, platform: process.platform, browser: await browser.version(), checkedAt: new Date().toISOString() }, null, 2))
  console.log(`ALL PASS: ${checks} browser checks`)
} catch (e) { console.error(e); process.exitCode = 1 }
finally { if (browser) await browser.close(); if (server) await new Promise(r => { server.httpServer.close(r); server.httpServer.closeAllConnections() }) }
