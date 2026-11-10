// SPDX-License-Identifier: AGPL-3.0-only
import type { ScanRulerPlugin } from '../../src/plugins/api'
import { registerPanelExtension } from '../../src/plugins/panelExtensions'
import { plugins } from '../../src/plugins/registry'
import { BodyStlExport } from './BodyStlExport'

const plugin: ScanRulerPlugin = {
  id: 'tmar-body-export',
  requires: ['reverse'],
  name: 'TMAR CAD body STL export',
  install() {
    if (!plugins().some((p) => p.id === 'reverse')) return
    registerPanelExtension({ id: 'tmar-body-export.stl', slot: 'reverse.export', component: BodyStlExport })
  },
}
export default plugin
