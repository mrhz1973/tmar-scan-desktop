// SPDX-License-Identifier: AGPL-3.0-only
import type { ScanRulerPlugin } from '../../src/plugins/api'
import { registerPanelExtension } from '../../src/plugins/panelExtensions'
import { plugins } from '../../src/plugins/registry'
import { ZebraPanel } from './ZebraPanel'

const plugin: ScanRulerPlugin = {
  id: 'tmar-zebra',
  name: 'TMAR Zebra surface analysis',
  install() {
    if (!plugins().some((p) => p.id === 'reverse')) return
    registerPanelExtension({ id: 'tmar-zebra.analysis', slot: 'reverse.analysis', component: ZebraPanel })
  },
}

export default plugin
