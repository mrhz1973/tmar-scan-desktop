// SPDX-License-Identifier: AGPL-3.0-only
import type { ScanRulerPlugin } from '../../src/plugins/api'
import { registerPanelExtension } from '../../src/plugins/panelExtensions'
import { plugins } from '../../src/plugins/registry'
import { CadEdgeButton, CadEdgePanel, useCadEdgeDisplay } from './CadEdgeControls'
const plugin: ScanRulerPlugin = {
  id:'tmar-cad-edges',name:'TMAR CAD face edges',
  requires: ['reverse'],
  install(){
    if(!plugins().some(p=>p.id==='reverse'))return
    registerPanelExtension({id:'tmar-cad-edges.reverse',slot:'reverse.analysis',component:CadEdgePanel,order:20})
    registerPanelExtension({id:'tmar-cad-edges.mesh',slot:'mesh.analysis',component:CadEdgePanel,order:20})
    registerPanelExtension({id:'tmar-cad-edges.deviation',slot:'deviation.extra',component:CadEdgePanel,order:20})
    registerPanelExtension({id:'tmar-cad-edges.quick',slot:'view.tools',component:CadEdgeButton,order:35})
  },
  usePlugin(){ useCadEdgeDisplay();return {} },
}
export default plugin
