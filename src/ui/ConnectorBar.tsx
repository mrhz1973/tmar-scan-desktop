// SPDX-License-Identifier: AGPL-3.0-only
// The strip under the top bar that tells the person their AI app's
// ScanRuler connector — the scanruler-mcp server it starts — is older than
// this page's commands assume, and how to update it: a sentence to ask the
// agent with, or by hand one copy-ready step per app, then quitting the app
// and opening it again. Shown while the agent connection is on and the server
// it reached is too old.

import { useState } from 'react'
import { CONNECTOR_ASK, CONNECTOR_STEPS, serverTooOld, useAgentLink, WANTS_SERVER } from '../commands/agentLink'
import { usePrefs } from '../state/prefsStore'
import { CopyButton } from './CopyButton'
import { coreText as tmarText, useLanguage as useTmarLanguage } from '../i18n'


export function ConnectorBar() {
  useTmarLanguage()

  const agentLink = usePrefs((s) => s.agentLink)
  const server = useAgentLink((s) => s.server)
  const [hidden, setHidden] = useState<string | null>(null)
  if (!agentLink || !serverTooOld(server)) return null
  const which = server?.version ?? 'old'
  if (hidden === which) return null
  return (
    <aside className="connector-bar" data-test="connector-bar" aria-label={tmarText("ScanRuler connector out of date")}>
      <p>
        <b>{tmarText("Your ScanRuler connector is out of date.")}</b>{tmarText(" Your AI app started scanruler-mcp")}{' '}
        {server?.version ? server.version : tmarText("older than {0}", [WANTS_SERVER])}{tmarText("; this ScanRuler needs ")}{WANTS_SERVER}{tmarText(" or newer, so some of what the agent asks may not work.")}</p>
      <div className="connector-ask" data-test="connector-bar-ask">
        <b>{tmarText("Easiest: ask your AI agent.")}</b>{tmarText(" Paste this into its chat:")}<code>{tmarText(CONNECTOR_ASK)}</code>
        <CopyButton label={tmarText("Copy")} className="ghost" onCopy={() => void navigator.clipboard?.writeText(tmarText(CONNECTOR_ASK))} />
      </div>
      <p>
        <b>{tmarText("Or by hand:")}</b>{tmarText(" change the app's ScanRuler setting to the one below, then ")}<b>{tmarText("quit the app completely")}</b>{tmarText(" (not just its window)")}{' '}
        <b>{tmarText("and open it again")}</b>{tmarText(". With more than one AI app open, the old connector may be another app's — one left open in the background holds the connection for all of them: quit it.")}</p>
      <ul>
        {CONNECTOR_STEPS.map((step) => (
          <li key={step.app}>
            <span>
              <b>{step.app}</b> — {tmarText(step.how)}:
            </span>
            <code>{step.text}</code>
            <CopyButton label={tmarText("Copy")} className="ghost" onCopy={() => void navigator.clipboard?.writeText(step.text)} />
          </li>
        ))}
      </ul>
      <button className="ghost" data-test="connector-bar-hide" onClick={() => setHidden(which)}>{tmarText("Hide")}</button>
    </aside>
  )
}
