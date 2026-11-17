// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { coreText as text, useLanguage } from '../i18n'
import { boundSplitViewRatio, parseSplitViewRatio, splitViewLayout, SPLIT_VIEW_DEFAULT, SPLIT_VIEW_KEY } from './splitViewLayout'
import './splitViewDivider.css'

function readPreference(): number {
  try { return parseSplitViewRatio(window.localStorage.getItem(SPLIT_VIEW_KEY)) }
  catch { return SPLIT_VIEW_DEFAULT }
}
function savePreference(value: number): void {
  try { window.localStorage.setItem(SPLIT_VIEW_KEY, String(value)) }
  catch { /* Optional browser preference; resizing still works without storage. */ }
}

/** A sibling of both canvases, never a wrapper that would remount either scene. */
export function SplitViewDivider({ active }: { active: boolean }) {
  useLanguage()
  const handle = useRef<HTMLDivElement>(null)
  const [preferred, setPreferred] = useState(readPreference)
  const current = useRef(preferred)
  const [width, setWidth] = useState(0)
  const measured = useRef(0)
  const held = useRef<{ id: number; x: number; left: number; original: number } | null>(null)
  const layout = splitViewLayout(width, preferred)
  const change = useCallback((value: number, persist = false) => {
    current.current = boundSplitViewRatio(value)
    setPreferred(current.current)
    if (persist) savePreference(current.current)
  }, [])
  const finish = useCallback((cancel: boolean) => {
    const drag = held.current, element = handle.current
    if (!drag) return
    held.current = null
    change(cancel ? drag.original : current.current, !cancel)
    element?.parentElement?.classList.remove('compare-resizing')
    if (element?.hasPointerCapture(drag.id)) element.releasePointerCapture(drag.id)
  }, [change])

  useLayoutEffect(() => {
    const element = handle.current, parent = element?.parentElement, stage = parent?.parentElement
    if (!active || !element || !parent) return
    const measure = () => {
      const next = parent.clientWidth
      if (next !== measured.current) finish(true)
      measured.current = next
      setWidth(next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(parent)
    parent.classList.add('compare-resizable')
    stage?.classList.add('compare-resizable')
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !held.current) return
      event.preventDefault(); event.stopImmediatePropagation(); finish(true)
    }
    const blur = () => finish(true)
    window.addEventListener('keydown', escape, true)
    window.addEventListener('blur', blur)
    return () => {
      observer.disconnect()
      window.removeEventListener('keydown', escape, true)
      window.removeEventListener('blur', blur)
      finish(true)
      parent.classList.remove('compare-resizable', 'compare-resizing')
      stage?.classList.remove('compare-resizable')
      parent.style.removeProperty('--compare-left-width')
      stage?.style.removeProperty('--compare-left-width')
    }
  }, [active, finish])
  useLayoutEffect(() => {
    if (!active) return
    const parent = handle.current?.parentElement
    parent?.style.setProperty('--compare-left-width', `${layout.left}px`)
    parent?.parentElement?.style.setProperty('--compare-left-width', `${layout.left}px`)
  }, [active, layout.left])

  return <div ref={handle} hidden={!active} className="split-view-divider" data-test="split-view-divider"
    role="separator" aria-orientation="vertical" aria-label={text('Resize scan and reference views')}
    aria-valuemin={Math.round(layout.min * 100)} aria-valuemax={Math.round(layout.max * 100)}
    aria-valuenow={Math.round(layout.ratio * 100)} aria-disabled={!layout.resizable}
    aria-valuetext={text('Scan {0}%, reference {1}%', [Math.round(layout.ratio * 100), Math.round((1 - layout.ratio) * 100)])}
    tabIndex={layout.resizable ? 0 : -1}
    title={text(layout.resizable
      ? 'Drag to resize the views. Arrow keys adjust; double-click or Enter resets. Escape cancels.'
      : 'The views stay equal while there is not enough space to resize them.')}
    onPointerDown={event => {
      if (event.button !== 0 || held.current || !active || !layout.resizable) return
      event.preventDefault(); event.stopPropagation(); event.currentTarget.focus()
      held.current = { id: event.pointerId, x: event.clientX, left: layout.left, original: current.current }
      event.currentTarget.setPointerCapture(event.pointerId)
      event.currentTarget.parentElement?.classList.add('compare-resizing')
    }}
    onPointerMove={event => {
      const drag = held.current
      if (!drag || drag.id !== event.pointerId) return
      event.preventDefault(); event.stopPropagation()
      const size = splitViewLayout(measured.current, current.current)
      if (!size.resizable) { finish(true); return }
      change(Math.max(size.min, Math.min(size.max, (drag.left + event.clientX - drag.x) / size.available)))
    }}
    onPointerUp={event => {
      if (held.current?.id !== event.pointerId) return
      event.preventDefault(); event.stopPropagation(); finish(false)
    }}
    onPointerCancel={() => finish(true)} onLostPointerCapture={() => finish(true)}
    onDoubleClick={event => {
      event.preventDefault(); event.stopPropagation(); finish(true); change(SPLIT_VIEW_DEFAULT, true)
    }}
    onKeyDown={event => {
      if (!active || !layout.resizable || held.current) return
      let next: number
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        next = layout.ratio + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 0.1 : 0.02)
      } else if (event.key === 'Home') next = layout.min
      else if (event.key === 'End') next = layout.max
      else if (event.key === 'Enter') next = SPLIT_VIEW_DEFAULT
      else return
      event.preventDefault(); event.stopPropagation()
      change(Math.max(layout.min, Math.min(layout.max, next)), true)
    }}>
    <svg width="10" height="32" viewBox="0 0 10 32" aria-hidden="true">
      <path d="M3 5v22M7 5v22" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  </div>
}
