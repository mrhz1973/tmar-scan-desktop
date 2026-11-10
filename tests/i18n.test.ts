// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from 'vitest'
import { coreText, reverseText, pluginText, getLanguage, setLanguage } from '../src/i18n'

afterEach(() => setLanguage('en'))
describe('Italian display boundary', () => {
  it('keeps non-browser command and test consumers in their original language', () => {
    expect(getLanguage()).toBe('en')
    expect(coreText('Apply')).toBe('Apply')
  })
  it('uses the Italian catalog and can return to English without changing source messages', () => {
    setLanguage('it')
    expect(coreText('Apply')).toBe('Applica')
    expect(coreText('Settings')).toBe('Impostazioni')
    expect(pluginText('Edit Surface')).toBe('Modifica superficie')
    setLanguage('en')
    expect(coreText('Settings')).toBe('Settings')
  })
  it('preserves values, objects, names and markup supplied as interpolation parameters', () => {
    setLanguage('it')
    const name = 'Save <b>original.step</b>'
    expect(reverseText('Edit {0}', [name])).toBe('Modifica ' + name)
    const data = { name: 'Apply', note: 'Save', id: 321 }
    expect(coreText(data)).toBe(data)
    expect(coreText(321)).toBe(321)
    expect(coreText(null)).toBeNull()
  })
  it('localizes a display message assembled by an unchanged store', () => {
    setLanguage('it')
    expect(reverseText('Edit Save <b>original.step</b>')).toBe('Modifica Save <b>original.step</b>')
    expect(pluginText('Delete 2 selected notes? This cannot be undone.')).toContain('2')
    expect(pluginText('Delete 2 selected notes? This cannot be undone.')).not.toContain('selected notes')
  })
  it('retains unknown diagnostics and deliberate surrounding whitespace', () => {
    setLanguage('it')
    expect(coreText('  Apply ')).toBe('  Applica ')
    expect(coreText('external-diagnostic: constraint_731')).toBe('external-diagnostic: constraint_731')
    expect(coreText('0.005')).toBe('0.005')
  })
})
