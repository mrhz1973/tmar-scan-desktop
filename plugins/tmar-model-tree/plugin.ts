// SPDX-License-Identifier: AGPL-3.0-only
import type { ScanRulerPlugin } from '../../src/plugins/api'
import { plugins } from '../../src/plugins/registry'
import { registerFeatureListExtension } from '../reverse/app/listExtensions'
import { FeatureSelection, FeatureSelectionRow } from './FeatureSelection'
import { registerFeatureVisibilityHistory } from './featureVisibility'
import './modelTree.css'
const plugin: ScanRulerPlugin = {
  id: 'tmar-model-tree', name: 'TMAR feature multi-selection',
  install() {
    if (!plugins().some((p) => p.id === 'reverse')) return
    registerFeatureListExtension({ list: FeatureSelection, row: FeatureSelectionRow })
    registerFeatureVisibilityHistory()
  },
}
export default plugin
