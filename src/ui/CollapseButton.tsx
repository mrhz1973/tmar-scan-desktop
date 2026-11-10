// SPDX-License-Identifier: AGPL-3.0-only
import './collapseButton.css'
import { coreText as tmarText, useLanguage as useTmarLanguage } from '../i18n'


/** A full-width, keyboard-accessible disclosure header. The caller localizes its label. */
export function CollapseButton({ label, collapsed, count, controls, testId, onToggle }: {
  label: string; collapsed: boolean; count: number; controls: string; testId: string; onToggle: () => void
}) {
  useTmarLanguage()

  return <button type="button" className="collapse-header" data-test={testId}
    aria-expanded={!collapsed} aria-controls={controls}
    aria-label={tmarText("{0} {1}", [collapsed ? tmarText("Expand") : tmarText("Collapse"), label])}
    title={tmarText("{0} {1}", [collapsed ? tmarText("Expand") : tmarText("Collapse"), label])} onClick={onToggle}>
    <svg className={collapsed ? '' : 'expanded'} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>
    <span>{label}</span><b className="collapse-count">{count}</b>
    <small>{collapsed ? tmarText("Expand") : tmarText("Collapse")}</small>
  </button>
}
