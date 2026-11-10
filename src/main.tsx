// SPDX-License-Identifier: AGPL-3.0-only
// The app's stylesheet first: a plugin's own stylesheet, loaded with the
// plugin, builds on it and has to come after it.
import './styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installWorkspaceEditorIntegration } from './plugins/workspaceEditorIntegration'
import { installPlugins } from './plugins/registry'
import { initializeLanguage } from './i18n'

// Before anything renders: what the plugins register is part of the app
// from its first frame.
initializeLanguage()
installPlugins()
installWorkspaceEditorIntegration()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
