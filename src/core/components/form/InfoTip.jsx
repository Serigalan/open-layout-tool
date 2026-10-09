import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../locales/i18nContext'

const TEXT_PX = 320

/**
 * An explanation folded away behind an ⓘ: a click on it opens the text
 * below, another click, Escape or a click elsewhere closes it again — so a
 * header keeps its room for what one works with.
 */
export default function InfoTip({ text, label = null }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [side, setSide] = useState('left')    // the edge of the ⓘ the text lines up with
  const boxRef = useRef(null)
  useEffect(() => {
    if (!open) return
    const away = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false) }
    // Escape closes the text only — not the window or dialog it stands in.
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false) } }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key, true) }
  }, [open])
  return (
    <span className="info-tip" ref={boxRef}>
      <button type="button" className={`info-tip-btn${open ? ' open' : ''}`} aria-expanded={open}
        aria-label={label ?? t('info_tip')} title={label ?? t('info_tip')} onClick={(e) => {
          // Opened towards the side with room for it.
          const r = e.currentTarget.getBoundingClientRect()
          setSide(r.left + TEXT_PX > window.innerWidth - 8 ? 'right' : 'left')
          setOpen(o => !o)
        }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="9.5" />
          <path d="M12 11 V17" />
          <circle cx="12" cy="7.5" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      </button>
      {open && <span className={`info-tip-text info-tip-${side}`} role="note">{text}</span>}
    </span>
  )
}
