// Isolated synthetic-project check: a real worker Apply reply is held at the
// client boundary, the Reverse panel is unmounted, then the late reply is
// delivered to the captured callback. No project fixture or host source is edited.
import { launchApp } from '../../../scripts/e2e-lib.mjs'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'

assert(process.env.APP_URL, 'Supply an isolated application URL')
assert.equal(process.env.SCANRULER_ISOLATED, '1', 'Only run against a disposable isolated host')
const { browser, page, consoleErrors } = await launchApp({
  url: process.env.APP_URL, width: 1440, height: 1000, agentDataOk: false,
})

try {
  await page.click('[data-test=workspace-reverse]')
  await page.waitForFunction(() => window.__re?.store.getState().kernelStatus === 'ready', { timeout: 60000 })
  const before = await page.evaluate(() => {
    const state = window.__re.store.getState()
    return { bodies: state.bodies.length, features: state.features.length, stepFiles: Object.keys(state.stepFiles).length }
  })
  assert.deepEqual(before, { bodies: 0, features: 0, stepFiles: 0 }, 'This scenario requires a fresh synthetic project')

  // Keep the real client callback, but hold only the STEP-export evaluation's
  // reply. Other worker messages, including normal preview validation, pass.
  await page.evaluate(() => {
    let nativeOnMessage
    for (let prototype = Worker.prototype; prototype && !nativeOnMessage; prototype = Object.getPrototypeOf(prototype)) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'onmessage')
      if (descriptor?.set) nativeOnMessage = descriptor
    }
    if (!nativeOnMessage) throw new Error('Worker.onmessage accessor not found')

    Object.defineProperty(Worker.prototype, 'onmessage', {
      configurable: true,
      enumerable: nativeOnMessage.enumerable,
      get() { return nativeOnMessage.get?.call(this) },
      set(handler) {
        if (typeof handler !== 'function') { nativeOnMessage.set.call(this, handler); return }
        const worker = this
        nativeOnMessage.set.call(this, function (event) {
          if (window.__holdSurfaceApplyReply && worker === window.__surfaceApplyWorker &&
              event.data?.id === window.__surfaceApplyId) {
            window.__heldSurfaceApplyReply = { worker, handler, event }
            window.__holdSurfaceApplyReply = false
            return
          }
          return handler.call(worker, event)
        })
      },
    })

    const postMessage = Worker.prototype.postMessage
    Worker.prototype.postMessage = function (message, ...rest) {
      if (message?.action === 'evaluate' && message.exportStep === true) {
        window.__surfaceApplyWorker = this
        window.__surfaceApplyId = message.id
      }
      return postMessage.call(this, message, ...rest)
    }
    window.__holdSurfaceApplyReply = true
  })

  await page.click('[data-test=edit-surface-entry] button')
  await (await page.$('[data-test=surface-step-file]')).uploadFile(resolve('plugins/tmar-edit-surface/evidence/input-solid.step'))
  await page.waitForFunction(() => document.querySelectorAll('[data-test=surface-face] option').length === 7, { timeout: 60000 })
  await page.select('[data-test=surface-face]', '5')
  await page.waitForFunction(() => document.querySelector('[data-test=surface-status]')?.textContent.includes('CAD valido') &&
    !document.querySelector('[data-test=surface-apply]')?.disabled, { timeout: 60000 })

  await page.click('[data-test=surface-apply]')
  await page.waitForFunction(() => !!window.__heldSurfaceApplyReply, { timeout: 60000 })

  // The busy modal intentionally prevents its own close button. Switch the
  // actual workspace through its store action, which unmounts ReversePanel.
  await page.evaluate(async () => {
    const { useShell } = await import('/src/state/shellStore.ts')
    useShell.getState().setWorkspace('elements')
  })
  await page.waitForFunction(() => !document.querySelector('[data-test=edit-surface-dialog]') &&
    document.querySelector('[data-test=workspace-elements]')?.getAttribute('aria-selected') === 'true', { timeout: 60000 })

  // Deliver the genuine worker response after disposal. The disposed client
  // must reject/ignore it, so finish() cannot dispatch reverse.import.step.
  await page.evaluate(() => {
    const held = window.__heldSurfaceApplyReply
    held.handler.call(held.worker, held.event)
  })
  await page.waitForFunction(() => !window.__re.store.getState().building, { timeout: 60000 })
  await new Promise(resolve => setTimeout(resolve, 100))
  const after = await page.evaluate(() => {
    const state = window.__re.store.getState()
    return { bodies: state.bodies.length, features: state.features.length, stepFiles: Object.keys(state.stepFiles).length }
  })
  assert.deepEqual(after, before, 'A late Apply reply after session disposal must not import a project feature')
  assert.deepEqual(consoleErrors, [])
  console.log(JSON.stringify({ pass: true, before, after, lateWorkerReplyDelivered: true, importStarted: false }))
} finally {
  await browser.close()
}
