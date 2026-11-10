// SPDX-License-Identifier: AGPL-3.0-only
// The warning before the agent connection first comes on, in Settings or by a
// pairing link: from then on the person's data does not stay on this computer.
// Up while prefsStore's agentDataAsking is; nothing connects until "Connect the
// agent" is pressed, and Cancel, Escape or a click beside it leave it off. The
// answer "yes" is remembered in this browser.

import { usePrefs } from '../state/prefsStore'
import { useDismiss } from './useDismiss'
import { coreText as tmarText, useLanguage as useTmarLanguage } from '../i18n'


export function AgentDataWarning() {
  useTmarLanguage()

  const asking = usePrefs((s) => s.agentDataAsking)
  const answer = usePrefs((s) => s.answerAgentData)
  useDismiss(asking, () => answer(false))

  if (!asking) return null
  return (
    <div className="modalback" onClick={() => answer(false)}>
      <div
        className="modal agentdata"
        data-test="agent-data-warning"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-data-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modalhead">
          <h2 id="agent-data-title">{tmarText("Your data will no longer stay on this computer")}</h2>
          <button className="x" onClick={() => answer(false)} aria-label={tmarText("Cancel")}>{tmarText("×")}</button>
        </div>
        <p>{tmarText("Without an agent, everything stays in this browser. With one connected, what the agent reads — measurements, reports, pictures of the part, file names, notes, and any file it opens itself — is processed by the agent and the AI model behind it. ")}<b>{tmarText("Unless that model runs on this computer, all of this goes to the model’s provider")}</b>{tmarText(", under that provider’s terms.")}</p>
        <p>{tmarText("ScanRuler itself sends nothing anywhere: the connection only reaches the agent’s helper on this computer. Don’t connect an agent while you work on parts you may not share with its provider.")}</p>
        <p className="dim">{tmarText("Asked once in this browser. Settings → Agents switches the connection off at any time.")}</p>
        <div className="modalfoot">
          <button data-test="agent-data-decline" onClick={() => answer(false)}>{tmarText("Cancel")}</button>
          <button className="primary" data-test="agent-data-accept" onClick={() => answer(true)}>{tmarText("Connect the agent")}</button>
        </div>
      </div>
    </div>
  )
}
