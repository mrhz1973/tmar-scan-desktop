// SPDX-License-Identifier: AGPL-3.0-only
import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { effectivePanelWidth, panelLimits, PANEL_DEFAULT, PANEL_MIN, PANEL_MAX, usePanelWidth } from './panelWidth'
import './panelResize.css'

export function PanelResizeHandle() {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; width: number; original: number } | null>(null)
  const [available, setAvailable] = useState(1200)
  const width = usePanelWidth((s) => s.width)
  const actual = effectivePanelWidth(width, available), limits = panelLimits(available)
  useLayoutEffect(() => {
    const parent = ref.current?.parentElement
    if (!parent) return
    const measure = () => setAvailable(parent.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(parent)
    parent.classList.add('tmar-resizable-panel')
    return () => { observer.disconnect(); parent.classList.remove('tmar-resizable-panel', 'tmar-panel-dragging'); parent.style.removeProperty('--tmar-panel-width') }
  }, [])
  useLayoutEffect(() => { ref.current?.parentElement?.style.setProperty('--tmar-panel-width', `${actual}px`) }, [actual])
  const finish = (event: PointerEvent<HTMLDivElement>, cancel = false) => {
    const held = drag.current
    if (!held) return
    drag.current = null
    usePanelWidth.getState().setWidth(cancel ? held.original : usePanelWidth.getState().width)
    ref.current?.parentElement?.classList.remove('tmar-panel-dragging')
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return <div ref={ref} className="tmar-panel-resizer" data-test="panel-resize" role="separator"
    aria-label="Resize left panel" aria-orientation="vertical" aria-valuemin={limits.min} aria-valuemax={limits.max}
    aria-valuenow={actual} aria-valuetext={`${actual} pixels`} tabIndex={0}
    title="Drag to resize the left panel. Arrow keys adjust width; double-click resets."
    onPointerDown={(event) => {
      if (event.button !== 0) return
      event.preventDefault(); event.stopPropagation(); event.currentTarget.focus()
      drag.current = { x: event.clientX, width: actual, original: width }
      event.currentTarget.setPointerCapture(event.pointerId)
      ref.current?.parentElement?.classList.add('tmar-panel-dragging')
    }}
    onPointerMove={(event) => {
      if (!drag.current) return
      event.preventDefault(); event.stopPropagation()
      usePanelWidth.getState().setWidth(effectivePanelWidth(drag.current.width + event.clientX - drag.current.x, available), false)
    }}
    onPointerUp={(event) => finish(event)} onPointerCancel={(event) => finish(event, true)}
    onLostPointerCapture={(event) => finish(event)}
    onDoubleClick={() => usePanelWidth.getState().setWidth(PANEL_DEFAULT)}
    onKeyDown={(event) => {
      if (event.key === 'Escape' && drag.current) {
        const original = drag.current.original; drag.current = null
        ref.current?.parentElement?.classList.remove('tmar-panel-dragging')
        usePanelWidth.getState().setWidth(original)
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        usePanelWidth.getState().setWidth(effectivePanelWidth(actual + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 64 : 16), available))
      } else if (event.key === 'Home') usePanelWidth.getState().setWidth(limits.min)
      else if (event.key === 'End') usePanelWidth.getState().setWidth(limits.max)
      else if (event.key === 'Enter') usePanelWidth.getState().setWidth(PANEL_DEFAULT)
      else return
      event.preventDefault(); event.stopPropagation()
    }}>
    <svg width="10" height="28" viewBox="0 0 10 28" aria-hidden="true"><path d="M3 3v22M7 3v22" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
  </div>
}

export function PanelWidthSettings() {
  const width = usePanelWidth((s) => s.width)
  return <section data-test="panel-layout-settings"><h3>Panel layout</h3>
    <label className="setting">Left panel width
      <input data-test="panel-width-setting" type="range" min={PANEL_MIN} max={PANEL_MAX} step={1} value={width}
        onChange={(e) => usePanelWidth.getState().setWidth(Number(e.target.value))}/><output>{width} px</output>
    </label>
    <p className="hint">Drag the vertical divider beside the panel. Width is remembered in this browser and limited to leave room for the model. Phone layouts keep their stacked panels.</p>
    <button onClick={() => usePanelWidth.getState().setWidth(PANEL_DEFAULT)}>Reset panel width</button>
  </section>
}
