// SPDX-License-Identifier: AGPL-3.0-only
import type { ScanRulerPlugin } from '../../src/plugins/api'
import { registerPanelExtension } from '../../src/plugins/panelExtensions'
import { plugins } from '../../src/plugins/registry'
import { DisplayControls, useDisplayControls } from './DisplayControls'
const plugin: ScanRulerPlugin = {
  id: 'tmar-display-controls', name: 'TMAR workspace labels',
  install() {
    if (!plugins().some((p) => p.id === 'reverse')) return
    registerPanelExtension({ id: 'tmar-display-controls.visibility', slot: 'view.tools', component: DisplayControls, order: 20 })
  },
  usePlugin() { useDisplayControls(); return {} },
}
export default plugin
