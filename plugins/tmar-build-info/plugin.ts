// SPDX-License-Identifier: AGPL-3.0-only
import type { ScanRulerPlugin } from '../../src/plugins/api'
import { registerPanelExtension } from '../../src/plugins/panelExtensions'
import { BuildBadge, BuildSettings } from './BuildInfo'
const plugin: ScanRulerPlugin = {
  id: 'tmar-build-info', name: 'TMAR build identification',
  install() {
    registerPanelExtension({ id: 'tmar-build-info.badge', slot: 'topbar.identity', component: BuildBadge })
    registerPanelExtension({ id: 'tmar-build-info.settings', slot: 'settings.tools', component: BuildSettings, order: -20 })
  },
}
export default plugin
