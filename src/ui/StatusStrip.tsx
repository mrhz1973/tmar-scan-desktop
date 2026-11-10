// SPDX-License-Identifier: AGPL-3.0-only
// Machine status strip: ready-lamp, what the tool is doing right now, the
// running tally of what has been measured, and the imprint. Nothing that is a
// switch — the ways of looking at the part are on the view bar in the corner
// of the stage, and what is set once and left is in Settings; a strip that
// held both was a row of small print nobody could find anything in.

import { useStore } from '../state/store'
import { useSyncExternalStore } from 'react'
import { pluginBusy, useCommandActivity, watchSession } from '../commands/activity'
import { useAgentLink } from '../commands/agentLink'
import { progressPhaseText, useTaskActivity } from '../state/taskActivity'
import { useDeviation } from '../state/deviationStore'
import { useThickness } from '../state/thicknessStore'
import { useFlat } from '../state/flatStore'
import { coreText as tmarText, useLanguage as useTmarLanguage } from '../i18n'


export function StatusStrip() {
  useTmarLanguage()

  const busy = useStore((s) => s.busy)
  const errorText = useStore((s) => s.errorText)
  const statusText = useStore((s) => s.statusText)
  const elements = useStore((s) => s.elements)
  const draft = useStore((s) => s.draft)
  const openImprint = useStore((s) => s.openImprint)
  // A command an agent is running: named here, for as long as it runs.
  const agent = useCommandActivity((s) => s.running)
  const agentConnected = useAgentLink((s) => s.status === 'connected')
  const tasks = useTaskActivity((s) => s.tasks)
  const taskList = Object.values(tasks)
  const task = taskList.find((t) => t.percent !== null) ?? taskList[0]
  const progress = useStore((s) => s.progress)
  const working = useStore((s) => s.working)
  const pluginWork = useSyncExternalStore(watchSession, pluginBusy, pluginBusy)
  const nominalBusy = useDeviation((s) => s.nominalBusy)
  const aligning = useDeviation((s) => s.alignStatus === 'running')
  const mapping = useDeviation((s) => s.mapStatus === 'running' || s.referenceStatus === 'running' || s.elementStatus === 'running')
  const volume = useDeviation((s) => s.volumeStatus === 'running')
  const measuring = useThickness((s) => s.status === 'running')
  const imageBusy = useFlat((s) => s.imageBusy)
  const edges = useFlat((s) => s.edgeStatus === 'running')

  const fitting = draft?.status === 'fitting' || elements.some((e) => e.status === 'fitting')
  const activity = working ?? (nominalBusy ? 'Loading reference' : imageBusy ? 'Loading image' : fitting ? 'Fitting elements'
    : aligning ? 'Aligning scan' : mapping ? 'Measuring deviation' : volume ? 'Finding volume errors'
      : measuring ? 'Measuring wall thickness' : edges ? 'Detecting image edges' : pluginWork)
  const active = Boolean(busy || agent || activity || task)
  const lamp = errorText ? 'lamp err' : active ? 'lamp busy' : 'lamp'
  const state = errorText ? 'ERROR' : active ? 'WORKING' : 'READY'
  const fraction = (busy || working || aligning || mapping || volume || measuring) && progress !== null && Number.isFinite(progress)
    ? Math.round(Math.max(0, Math.min(100, progress * 100))) : null
  const percent = task ? task.percent : fraction
  const note = task?.text ?? (busy || working ? statusText || activity : activity) ?? statusText
  const phase = progressPhaseText(tmarText(note), percent)

  const done = elements.filter((e) => e.fit)
  const dimensions = useStore((s) => s.dimensions)

  return (
    <footer className="strip">
      <div data-test="app-activity-state" role="status">
        <span className={lamp} /> {tmarText(state)}{state === 'WORKING' && percent !== null ? tmarText(" {0}%", [percent]) : ''}
      </div>
      {elements.length > 0 && (
        <div>{tmarText("ELEMENTS ")}<b>{done.length}</b>
          {done.length !== elements.length && (tmarText(" of {0}", [elements.length]))}{tmarText(" · DIM")}{' '}
          <b>{dimensions.length}</b>
        </div>
      )}
      <div className="msg grow">
        {errorText ? (
          <span className="warn">⚠ {tmarText(errorText)}</span>
        ) : agent ? (
          <span data-test="agent-running">
            <b>{tmarText(agent.title)}</b> <code>{agent.name}</code>
            {phase ? tmarText(" — {0}", [tmarText(phase)]) : ''}
          </span>
        ) : active ? (
          <span data-test="task-progress">{tmarText(phase)}</span>
        ) : (
          tmarText(statusText)
        )}
      </div>
      <button
        className="stripimprint"
        onClick={() => openImprint(true)}
        title={tmarText("Impressum & Datenschutzerklärung")}
      >
        § <span className="btxt">{tmarText("IMPRINT")}</span>
      </button>
      <a href="https://www.cnckitchen.com" target="_blank" rel="noreferrer" data-test="local-note">
        {agentConnected ? (
          <>{tmarText("AGENT CONNECTED")}<span className="ltxt">{tmarText(" · WHAT IT READS GOES TO ITS AI MODEL")}</span>
          </>
        ) : (
          <>{tmarText("LOCAL ONLY")}<span className="ltxt">{tmarText(" · FILES NEVER LEAVE YOUR BROWSER")}</span>
          </>
        )}
      </a>
    </footer>
  )
}
