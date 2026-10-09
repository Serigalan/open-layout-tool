import en from './en.json'
import de from './de.json'

export const translations = { en, de }

export const languageLabels = {
  en: 'English',
  de: 'Deutsch',
}

/**
 * A text with its {placeholders} filled (R6.1): every `{name}` in `text`
 * becomes `params.name`. One syntax, single braces, in every locale file —
 * i18n.test.js checks that both languages use the same placeholders per key.
 * A placeholder without a value stays as it is, so a missing one shows.
 */
export function format(text, params = {}) {
  return String(text ?? '').replace(/\{(\w+)\}/g, (all, name) => (name in params ? String(params[name]) : all))
}

/** The translated text for `key`, filled — `fill(t, 'merge_done', { n: 4 })`. */
export function fill(t, key, params = {}) {
  return format(t(key), params)
}

/**
 * The translation of `key`, or `fallback` where there is none — for keys made
 * up at run time (an error code from the server, a rule id) that may have no
 * text of their own.
 */
export function tOr(t, key, fallback) {
  const s = t(key)
  return s === key ? fallback : s
}

const LOCALE = { de: 'de-DE', en: 'en-GB' }

/**
 * A date (ISO string, number or Date) as the interface language writes it —
 * 02.10.2026 or 02/10/2026, with `time` the hour and minute after it. Empty
 * for no date.
 */
export function formatDate(value, language, { time = false } = {}) {
  if (value == null || value === '') return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(LOCALE[language] ?? LOCALE.de, {
    day: '2-digit', month: '2-digit', year: 'numeric',
    ...(time ? { hour: '2-digit', minute: '2-digit' } : {}),
  })
}

// Numbers as the interface language writes them (R10.8).

/** The decimal separator of a language. */
const decimalOf = (language) => (language === 'en' ? '.' : ',')

/**
 * A number for the screen: `digits` decimals (as it is when left out), the
 * language's decimal separator, and `unit` after a space.
 */
export function formatNum(value, language, { digits = null, unit = null } = {}) {
  if (value === '' || value == null || !Number.isFinite(Number(value))) return value == null ? '' : String(value)
  const text = digits == null ? String(Number(value)) : Number(value).toFixed(digits)
  const out = text.replace('.', decimalOf(language))
  return unit ? `${out} ${unit}` : out
}

/**
 * What was typed, as a number string with a point: a comma is taken as the
 * decimal separator as readily as a point; where both are there the last one
 * is it and the other groups thousands. Anything else is handed on as typed.
 */
export function parseNumText(text) {
  const s = String(text ?? '').trim().replace(/\s+/g, '')
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.')
  if (lastComma < 0) return s
  if (lastDot < 0) return s.replace(',', '.')
  return lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
}

const UNITS = new Set(['m', 'mm', 'cm', 'km', 'km/h', '°', 'gon', '‰', 's', 'kN', 'm²'])

/** A label and the unit it ends in — "Length (m)" → { text: 'Length', unit: 'm' } — or the label alone. */
export function splitUnit(label) {
  const m = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(String(label ?? ''))
  return m && UNITS.has(m[2].trim()) ? { text: m[1], unit: m[2].trim() } : { text: String(label ?? ''), unit: null }
}
