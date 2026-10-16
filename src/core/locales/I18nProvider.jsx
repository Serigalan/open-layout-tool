import { useCallback, useMemo, useState } from 'react'
import { DEFAULT_LANGUAGE, I18nContext, i18nValue } from './i18nContext'
import { translations } from './i18n'
import { loadSettings, saveSettings } from '../utils/common/settings'

/**
 * Holds the interface language, starting from `initial` where it is one (a
 * link made in a language — not remembered unless chosen here), else from the
 * one last chosen.
 */
export default function I18nProvider({ children, initial = null }) {
  const [language, setLanguageState] = useState(() => (translations[initial] ? initial : loadSettings().language ?? DEFAULT_LANGUAGE))
  const setLanguage = useCallback((lang) => {
    setLanguageState(lang)
    saveSettings({ language: lang })
  }, [])
  const ctx = useMemo(() => i18nValue(language, setLanguage), [language, setLanguage])
  return <I18nContext.Provider value={ctx}>{children}</I18nContext.Provider>
}
