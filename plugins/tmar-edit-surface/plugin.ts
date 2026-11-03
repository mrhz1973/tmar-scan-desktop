// SPDX-License-Identifier: AGPL-3.0-only
import type { ScanRulerPlugin } from '../../src/plugins/api'
import { registerPanelExtension } from '../../src/plugins/panelExtensions'
import { plugins } from '../../src/plugins/registry'
import { EditSurface } from './EditSurface'
const plugin: ScanRulerPlugin = {
  id: 'tmar-edit-surface', name: 'TMAR Edit Surface · CAD prototype',
  install() { if (plugins().some(p => p.id === 'reverse')) registerPanelExtension({ id: 'tmar-edit-surface.open', slot: 'reverse.export', component: EditSurface, order: 10 }) },
}
export default plugin
