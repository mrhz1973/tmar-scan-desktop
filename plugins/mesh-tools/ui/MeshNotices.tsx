// SPDX-License-Identifier: AGPL-3.0-only

import { pluginText as tmarText, useLanguage as useTmarLanguage } from '../../../src/i18n'
// What the imprint owes the libraries this workspace ships.

export function MeshNotices() {
  useTmarLanguage()

  return (
    <p>{tmarText("The Mesh Tools workspace reduces meshes with")}{' '}
      <a href="https://github.com/zeux/meshoptimizer" target="_blank" rel="noopener noreferrer">{tmarText("meshoptimizer")}</a>{' '}{tmarText("(© Arseny Kapoulkine, MIT) and makes its booleans with")}{' '}
      <a href="https://github.com/elalish/manifold" target="_blank" rel="noopener noreferrer">{tmarText("Manifold")}</a>{' '}{tmarText("(© The Manifold Authors, Apache-2.0). Both are loaded as WebAssembly when they are first used, and are used unmodified.")}</p>
  )
}
