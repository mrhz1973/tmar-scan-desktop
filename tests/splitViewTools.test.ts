// SPDX-License-Identifier: AGPL-3.0-only
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { setLanguage } from '../src/i18n'
import { SplitViewTools } from '../src/ui/SplitViewTools'

const render = (side: 'scan' | 'reference', name = 'part.stl') =>
  renderToStaticMarkup(createElement(SplitViewTools, { side, name }))
afterEach(() => setLanguage('en'))

describe('pane-owned appearance shortcuts', () => {
  it.each(['scan', 'reference'] as const)('%s has three explicitly labelled native buttons', side => {
    const html = render(side)
    expect(html.match(/type="button"/g)).toHaveLength(3)
    expect(html).toContain(`data-test="split-${side}-tools"`)
    for (const key of ['transparent', 'wireframe', 'backfaces'])
      expect(html).toContain(`data-test="split-${side}-${key}"`)
    const label = side === 'scan' ? 'Scan' : 'Reference'
    expect(html).toContain(`aria-label="Display controls for ${label}"`)
    expect(html).toContain(`aria-label="${label}: Triangle wireframe"`)
    expect(html).not.toContain(`split-${side === 'scan' ? 'reference' : 'scan'}-`)
  })
  it.each(['scan', 'reference'] as const)('%s exposes existing default appearance, not new preferences', side => {
    const html = render(side)
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(2)
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1)
  })
  it('translates the part and controls, never the file name', () => {
    setLanguage('it')
    const html = render('reference', 'Scan')
    expect(html).toContain('Comandi di visualizzazione: Riferimento')
    expect(html).toContain('Riferimento: Reticolo triangolare')
    expect(html).toContain('Riferimento: Colora facce posteriori')
    expect(html).toContain('title="Scan">Scan</span>')
  })
  it('escapes file names in the caption and full-name tooltip', () => {
    const html = render('scan', '<img src=x onerror=alert(1)>.stl')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;.stl')
  })
})
