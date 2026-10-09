import { languageLabels } from '../../locales/i18n'
import { LanguageIcon } from '../icons'
import './collab.css'
import { useI18n } from '../../locales/i18nContext'
import useMenu from '../form/useMenu'

/**
 * The language of the app, behind a button that shows only the language
 * symbol: the languages appear once it is opened. The menu works by keyboard
 * and closes on a choice, on Escape and on a click anywhere else (useMenu).
 */
export default function LanguageMenu({ onChange }) {
  const { language, t } = useI18n()
  const { open: menuOpen, close: closeMenu, rootRef: menuRootRef, buttonRef: menuButtonRef, buttonProps: menuButtonProps } = useMenu()
  const label = `${t('home_language')}: ${languageLabels[language] ?? language}`
  return (
    <div className="home-menu" ref={menuRootRef}>
      <button ref={menuButtonRef} type="button" className="collab-btn collab-icon-btn" aria-label={label} title={label}
        {...menuButtonProps}>
        <LanguageIcon />
      </button>
      {menuOpen && (
        <div className="home-menu-list home-language-list" role="menu">
          {Object.entries(languageLabels).map(([lang, name]) => (
            <button key={lang} type="button" role="menuitemradio" aria-checked={lang === language}
              lang={lang} className={lang === language ? 'current' : ''}
              onClick={() => { closeMenu(); if (lang !== language) onChange(lang) }}>
              <span className="home-language-check" aria-hidden="true">{lang === language ? '✓' : ''}</span>
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
