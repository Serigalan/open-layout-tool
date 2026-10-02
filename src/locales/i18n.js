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
