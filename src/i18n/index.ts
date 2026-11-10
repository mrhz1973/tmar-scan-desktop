// SPDX-License-Identifier: AGPL-3.0-only
// Translate at the rendering boundary: project data and command results retain
// their original values, regardless of the operator's display language.
import { useSyncExternalStore } from 'react'
import coreItalian from './it/core.json'
import reverseItalian from './it/reverse.json'
import pluginsItalian from './it/plugins.json'

export type Language = 'it' | 'en'
export type TranslationDomain = 'core' | 'reverse' | 'plugins'
const catalogs: Record<TranslationDomain, Readonly<Record<string, string>>> = {
  core: normalizeCatalog(coreItalian), reverse: normalizeCatalog(reverseItalian), plugins: normalizeCatalog(pluginsItalian),
}
function normalizeCatalog(raw: Record<string, string>): Record<string, string> {
  const entities: Record<string, string> = { amp: '&', apos: "'", quot: '"', lt: '<', gt: '>', nbsp: '\u00a0', rsquo: '\u2019' }
  const decode = (text: string) => text.replace(/&(amp|apos|quot|lt|gt|nbsp|rsquo);/g, (_, key: string) => entities[key])
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => [decode(key), decode(value)]))
}
const preference = 'tmar.language'
function initialLanguage(): Language {
  if (typeof window === 'undefined') return 'en'
  try {
    const requested = new URL(window.location.href).searchParams.get('lang')
    if (requested === 'it' || requested === 'en') return requested
    const saved = window.localStorage.getItem(preference)
    if (saved === 'it' || saved === 'en') return saved
  } catch { /* Storage may be disabled; the Italian default still works. */ }
  return 'it'
}
let language = initialLanguage()
const listeners = new Set<() => void>()
export const getLanguage = () => language
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export function useLanguage(): Language {
  return useSyncExternalStore(subscribe, getLanguage, getLanguage)
}
export function setLanguage(next: Language): void {
  if (next !== 'it' && next !== 'en') return
  language = next
  if (typeof document !== 'undefined') document.documentElement.lang = next
  if (typeof window !== 'undefined') {
    try { window.localStorage.setItem(preference, next) } catch { /* Optional preference persistence. */ }
    try {
      const url = new URL(window.location.href)
      if (url.searchParams.has('lang')) {
        url.searchParams.set('lang', next)
        window.history.replaceState(window.history.state, '', url)
      }
    } catch { /* A sandbox may not permit history changes. */ }
  }
  for (const listener of listeners) listener()
}
export function initializeLanguage(): void {
  if (typeof document !== 'undefined') document.documentElement.lang = language
}

type Pattern = { matcher: RegExp; indexes: number[]; translated: string }
const patterns = new Map<TranslationDomain, Pattern[]>()
const cache = new Map<string, string>()
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
function catalogOrder(domain: TranslationDomain): TranslationDomain[] {
  return [domain, ...(['core', 'reverse', 'plugins'] as const).filter(value => value !== domain)]
}
function messagePatterns(domain: TranslationDomain): Pattern[] {
  const saved = patterns.get(domain)
  if (saved) return saved
  const seen = new Set<string>(), result: (Pattern & { weight: number })[] = []
  for (const name of catalogOrder(domain)) for (const [source, translated] of Object.entries(catalogs[name])) {
    if (seen.has(source)) continue
    seen.add(source)
    const tokens = [...source.matchAll(/\{(\d+)\}/g)]
    const literal = source.replace(/\{\d+\}/g, '')
    // Short generic templates could accidentally treat a name as interface text.
    if (!tokens.length || literal.replace(/\W/g, '').length < 3 || source === translated) continue
    let position = 0, expression = '^'
    const indexes: number[] = []
    for (const token of tokens) {
      expression += escapeRegex(source.slice(position, token.index)) + '([\\s\\S]*?)'
      indexes.push(Number(token[1]))
      position = token.index! + token[0].length
    }
    expression += escapeRegex(source.slice(position)) + '$'
    result.push({ matcher: new RegExp(expression), indexes, translated, weight: literal.length })
  }
  result.sort((a, b) => b.weight - a.weight)
  patterns.set(domain, result)
  return result
}
function interpolate(message: string, values: readonly unknown[]): string {
  return message.replace(/\{(\d+)\}/g, (token, index: string) =>
    Number(index) < values.length ? String(values[Number(index)] ?? '') : token)
}
function italian(message: string, domain: TranslationDomain): string {
  const key = domain + '\0' + message
  const saved = cache.get(key)
  if (saved !== undefined) return saved
  const trimmed = message.trim()
  let result: string | undefined
  for (const name of catalogOrder(domain)) {
    if (Object.hasOwn(catalogs[name], trimmed)) { result = catalogs[name][trimmed]; break }
  }
  if (result === undefined && /[A-Za-z]/.test(trimmed)) {
    for (const { matcher, indexes, translated } of messagePatterns(domain)) {
      const match = matcher.exec(trimmed)
      if (!match) continue
      const values: string[] = []
      indexes.forEach((index, i) => { values[index] = match[i + 1] })
      result = interpolate(translated, values)
      break
    }
  }
  const output = result === undefined ? message : message.slice(0, message.indexOf(trimmed)) + result + message.slice(message.indexOf(trimmed) + trimmed.length)
  if (cache.size >= 1024) cache.delete(cache.keys().next().value!)
  cache.set(key, output)
  return output
}
interface TextTranslator {
  (message: string, values?: readonly unknown[]): string
  <T>(message: T, values?: readonly unknown[]): T
}
function translator(domain: TranslationDomain): TextTranslator {
  return ((message: unknown, values?: readonly unknown[]) => {
    if (typeof message !== 'string') return message
    const translated = language === 'it' ? italian(message, domain) : message
    return values ? interpolate(translated, values) : translated
  }) as TextTranslator
}
export const coreText = translator('core')
export const reverseText = translator('reverse')
export const pluginText = translator('plugins')
