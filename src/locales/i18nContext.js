import { createContext, useContext } from 'react'
import { translations } from './i18n'
import { fill as fillText } from './i18n'

export const DEFAULT_LANGUAGE = 'en'

/** The translate function for a language: the key itself where it has no text. */
function makeT(language) {
  const dict = translations[language] ?? translations[DEFAULT_LANGUAGE]
  return (key) => dict[key] ?? key
}

/** What the context carries for a language. */
export function i18nValue(language, setLanguage) {
  const t = makeT(language)
  return { language, setLanguage, t, fill: (key, params) => fillText(t, key, params) }
}

// Outside a provider (a test rendering one component) the app speaks English.
export const I18nContext = createContext(i18nValue(DEFAULT_LANGUAGE, () => {}))

/**
 * The language of the interface and its texts (R2.2): `t(key)`, `fill(key,
 * params)`, `language` and `setLanguage`, which also remembers the choice.
 */
export const useI18n = () => useContext(I18nContext)
