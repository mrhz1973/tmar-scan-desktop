// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { hasEnglishWorkspaceText, workspaceSurfaceText } from '../workspaceSurfaceLanguage'

describe('V5 Edit Surface complete bilingual workspace messages', () => {
  it('maps every statically authored user-facing panel message to English', () => {
    const code = readFileSync(new URL('../WorkspaceSurfaceParameters.tsx', import.meta.url), 'utf8')
    const messages = [...new Set([...code.matchAll(/surfaceText\("([^"]*)"/g)]
      .map(match => match[1].replace(/\\n/g, '\n')))]
    expect(messages.length).toBeGreaterThanOrEqual(185)
    const missing = messages.filter(message => !hasEnglishWorkspaceText(message))
    expect(missing).toEqual([])
  })

  it('translates instructions and technical controls without altering dynamic units', () => {
    expect(workspaceSurfaceText('Protezione dei bordi', 'en')).toBe('Boundary protection')
    expect(workspaceSurfaceText('Seleziona liberi', 'en')).toBe('Select editable')
    expect(workspaceSurfaceText('G0 · mantieni la posizione dei bordi', 'en')).toContain('Keep boundaries fixed')
    expect(workspaceSurfaceText('Punti raccolti: {0} di 8. {1} Destinazione: {2}.',
      'en', [2, 'Continue', 'CAD'])).toBe('Collected points: 2 of 8. Continue Target: CAD.')
    expect(workspaceSurfaceText('Spostamento · ', 'en')).toBe('Displacement · ')
    expect(workspaceSurfaceText('Seleziona liberi', 'it')).toBe('Seleziona liberi')
    expect(workspaceSurfaceText('user-defined CAD note', 'en')).toBe('user-defined CAD note')
  })
})
