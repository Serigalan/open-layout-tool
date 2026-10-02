import { useCallback, useMemo, useState } from 'react'
import { DEFAULT_LANGUAGE, I18nContext, i18nValue } from './i18nContext'
import { loadSettings, saveSettings } from '../utils/settings'

/** Holds the interface language, starting from the one last chosen. */
export default function I18nProvider({ children }) {
  const [language, setLanguageState] = useState(() => loadSettings().language ?? DEFAULT_LANGUAGE)
  const setLanguage = useCallback((lang) => {
    setLanguageState(lang)
    saveSettings({ language: lang })
  }, [])
  const ctx = useMemo(() => i18nValue(language, setLanguage), [language, setLanguage])
  return <I18nContext.Provider value={ctx}>{children}</I18nContext.Provider>
}
