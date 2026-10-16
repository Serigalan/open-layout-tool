import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../../locales/i18nContext'
import './InfoTip.css'

const TEXT_PX = 320
const EDGE_PX = 8

/**
 * An explanation folded away behind an ⓘ (decision 329): a click on it opens
 * the text, another click, Escape, a click elsewhere or scrolling closes it
 * again — so a panel shows what one works with, and says why only when
 * asked. The text stands over everything (a portal to the page, placed by
 * the ⓘ), so a scrolling panel cannot cut it off; below the ⓘ where there is
 * room, above it otherwise. `text` may be a string or a few paragraphs.
 */
export default function InfoTip({ text, label = null }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [place, setPlace] = useState(null)
  const btnRef = useRef(null)
  const boxRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const inside = (e) => btnRef.current?.contains(e.target) || boxRef.current?.contains(e.target)
    const away = (e) => { if (!inside(e)) setOpen(false) }
    // Escape closes the text only — not the window or dialog it stands in.
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false) } }
    const gone = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', key, true)
    document.addEventListener('scroll', gone, true)
    window.addEventListener('resize', gone)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', key, true)
      document.removeEventListener('scroll', gone, true)
      window.removeEventListener('resize', gone)
    }
  }, [open])

  // Placed once it is drawn and its height is known.
  useLayoutEffect(() => {
    if (!open || !btnRef.current || !boxRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    const width = Math.min(TEXT_PX, window.innerWidth - 2 * EDGE_PX)
    const left = Math.max(EDGE_PX, Math.min(r.left - 6, window.innerWidth - width - EDGE_PX))
    const height = boxRef.current.offsetHeight
    const below = r.bottom + 6 + height <= window.innerHeight - EDGE_PX || r.top < height + 12
    setPlace({ left, width, top: below ? r.bottom + 6 : r.top - 6 - height })
  }, [open, text])

  return (
    <span className="info-tip">
      <button ref={btnRef} type="button" className={`info-tip-btn${open ? ' open' : ''}`} aria-expanded={open}
        aria-label={label ?? t('info_tip')} title={label ?? t('info_tip')}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPlace(null); setOpen(o => !o) }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="9.5" />
          <path d="M12 11 V17" />
          <circle cx="12" cy="7.5" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      </button>
      {open && createPortal(
        <div ref={boxRef} className="info-tip-text" role="note"
          style={place ? { left: place.left, top: place.top, width: place.width } : { visibility: 'hidden', left: 0, top: 0 }}>
          {text}
        </div>,
        document.body,
      )}
    </span>
  )
}
