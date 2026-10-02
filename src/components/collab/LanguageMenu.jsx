import { useEffect, useRef, useState } from 'react'
import { languageLabels } from '../../locales/i18n'
import { LanguageIcon } from '../icons'
import './collab.css'
import { useI18n } from '../../locales/i18nContext'

/**
 * The language of the app, behind a button that shows only the language
 * symbol: the languages appear once it is opened. The menu closes on a choice,
 * on Escape and on a click anywhere else.
 */
export default function LanguageMenu({ onChange }) {
  const { language, t } = useI18n()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const buttonRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const label = `${t('home_language')}: ${languageLabels[language] ?? language}`
  return (
    <div className="home-menu" ref={ref}>
      <button ref={buttonRef} type="button" className="collab-btn collab-icon-btn" aria-label={label} title={label}
        aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(v => !v)}>
        <LanguageIcon />
      </button>
      {open && (
        <div className="home-menu-list home-language-list" role="menu">
          {Object.entries(languageLabels).map(([lang, name]) => (
            <button key={lang} type="button" role="menuitemradio" aria-checked={lang === language}
              lang={lang} className={lang === language ? 'current' : ''}
              onClick={() => { setOpen(false); if (lang !== language) onChange(lang) }}>
              <span className="home-language-check" aria-hidden="true">{lang === language ? '✓' : ''}</span>
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
