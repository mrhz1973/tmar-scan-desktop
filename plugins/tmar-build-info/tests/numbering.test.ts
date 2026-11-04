// SPDX-License-Identifier: AGPL-3.0-only
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BuildBadge, BuildSettings } from '../BuildInfo'
import { tmarVersionLabel, tmarChannelLabel, TMAR_VERSION } from '../../../src/tmarVersion'
import { BUILD_IDENTITY } from '../../../src/buildIdentity'
import { APP_VERSION } from '../../../src/version'
describe('chronological human TMAR delivery numbers', () => {
  it('formats sequential integers without deriving them from commits', () => {
    for (const number of [1, 2, 3, 12, 100]) expect(tmarVersionLabel({ number, channel: 'preview' })).toBe(`Versione ${number}`)
  })
  it('does not fabricate a number when unavailable', () => expect(tmarVersionLabel({ number: null, channel: 'preview' })).toBe('Versione non assegnata'))
  it('separates preview status from a stable release', () => {
    expect(tmarChannelLabel({ number: 1, channel: 'preview' })).toBe('Anteprima')
    expect(tmarChannelLabel({ number: 1, channel: 'stable' })).toBe('Stabile')
  })
  it('displays a human version but not the commit as the visible badge text', () => {
    const html = renderToStaticMarkup(createElement(BuildBadge)), text = html.replace(/<[^>]+>/g, '')
    expect(text).toContain(tmarVersionLabel(TMAR_VERSION)); expect(text).toContain('TMAR web')
    expect(text).not.toContain(BUILD_IDENTITY.revision.slice(0, 7)); expect(html).not.toContain('<code>')
    expect(html).toContain('aria-label="TMAR Versione '); expect(html).toContain('data-revision=')
  })
  it('keeps provenance in initially collapsed Settings details', () => {
    const html = renderToStaticMarkup(createElement(BuildSettings))
    expect(html).toContain(tmarVersionLabel(TMAR_VERSION)); expect(html).toContain(APP_VERSION)
    expect(html).toContain('<summary>Dettagli tecnici</summary>')
    expect(html).toContain(BUILD_IDENTITY.revision); expect(html).not.toMatch(/<details[^>]*\bopen/)
  })
})
