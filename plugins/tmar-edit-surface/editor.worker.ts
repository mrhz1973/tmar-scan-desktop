// SPDX-License-Identifier: AGPL-3.0-only
import { SurfaceEditorKernel } from './editorKernel'
import wasmUrl from 'occt-wasm/dist/occt-wasm.wasm?url'
import type { Net } from './brep'
export type Request = { id: number } & ({ action: 'open'; step: string } | { action: 'select'; face: number } | { action: 'evaluate'; net: Net; continuity: 'G0' | 'G1'; exportStep?: boolean })
let editor: SurfaceEditorKernel | undefined
let chain = Promise.resolve()
self.onmessage = (event: MessageEvent<Request>) => {
  const req = event.data
  chain = chain.then(async () => {
    try {
      editor ??= await SurfaceEditorKernel.load(wasmUrl)
      const result = req.action === 'open' ? editor.open(req.step) : req.action === 'select' ? editor.select(req.face) : editor.evaluate(req.net, req.continuity, req.exportStep)
      self.postMessage({ id: req.id, result })
    } catch (e) { self.postMessage({ id: req.id, error: e instanceof Error ? e.message : String(e) }) }
  })
}
