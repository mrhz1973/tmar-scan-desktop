// SPDX-License-Identifier: AGPL-3.0-only
// Localized legacy UI messages for the V5 Edit Surface workspace.
// CAD identifiers, notes, files, units, poles and history recipes are never translated.
import english from './workspaceSurfaceEnglish.json'
import { pluginText } from '../../src/i18n'
import type { Language } from '../../src/i18n'

const englishMessages: Readonly<Record<string, string>> = english

export function workspaceSurfaceText(message: string, language: Language, values?: readonly unknown[]): string {
  const translation = language === 'en' ? englishMessages[message] ?? message : pluginText(message)
  return values ? translation.replace(/\{(\d+)\}/g, (token, index: string) =>
    Number(index) < values.length ? String(values[Number(index)] ?? '') : token) : translation
}

export function hasEnglishWorkspaceText(message: string): boolean {
  return Object.hasOwn(englishMessages, message)
}
