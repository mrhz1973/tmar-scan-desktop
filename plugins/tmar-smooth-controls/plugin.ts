// SPDX-License-Identifier: AGPL-3.0-only
import type { ScanRulerPlugin } from '../../src/plugins/api'
import { plugins } from '../../src/plugins/registry'
import { registerPanelExtension } from '../../src/plugins/panelExtensions'
import { SmoothIntensity } from './SmoothIntensity'
const plugin: ScanRulerPlugin = {
  id: 'tmar-smooth-controls', name: 'TMAR Smooth intensity',
  requires: ['mesh-tools'],
  install() {
    if (!plugins().some(p => p.id === 'mesh-tools')) return
    registerPanelExtension({ id: 'tmar-smooth-controls.intensity', slot: 'mesh.smooth.controls', component: SmoothIntensity })
  },
}
export default plugin
