// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { setLanguage, coreText, pluginText } from '../../../src/i18n'
import { useComb } from '../../../src/state/combStore'
import { CombControls } from '../../../src/ui/CombControls'
import { EditedCopyNote } from '../ui/EditedCopyNote'

afterEach(() => {
  useComb.getState().setOn(false)
  setLanguage('en')
})

describe('TMAR V7 integrated upstream 0.11.2 bilingual presentation', () => {
  it('localizes the curvature comb and its settings without changing values', () => {
    setLanguage('it')
    useComb.getState().setOn(true)
    const italian = renderToStaticMarkup(createElement(CombControls, { where: 'sheet' }))
    expect(italian).toContain('Pettine di curvatura')
    expect(coreText('Smoothing')).toBe('Levigatura')
    expect(coreText('Length')).toBe('Lunghezza')

    setLanguage('en')
    const english = renderToStaticMarkup(createElement(CombControls, { where: 'part' }))
    expect(english).toContain('Curvature comb')
    expect(coreText('Smoothing')).toBe('Smoothing')
    expect(coreText('Length')).toBe('Length')
    expect(coreText('Copy position')).toBe('Copy position')
  })

  it('localizes edited mesh copy warning and context menu labels', () => {
    setLanguage('it')
    const html = renderToStaticMarkup(createElement(EditedCopyNote, {
      edits: 2, busy: false, onUse: () => {}, onShow: () => {}, onDismiss: () => {},
    }))
    expect(html).toContain('Strumenti mesh conserva una copia modificata')
    expect(html).toContain('Usa per l')
    expect(html).toContain('Mostra')
    expect(coreText('Copy reading')).toBe('Copia lettura')
    expect(coreText('Hide in viewport')).toBe('Nascondi nella vista')

    setLanguage('en')
    expect(pluginText('Show')).toBe('Show')
    expect(pluginText('Use for analysis')).toBe('Use for analysis')
  })
})
