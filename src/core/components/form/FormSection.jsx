import { useState } from 'react'
import InfoTip from './InfoTip'

/**
 * One block of a dialog's fields under a heading (R4.3) — "Geometry data",
 * "Meta data", … `title` is the text, already translated; `info` an
 * explanation of the block, folded away behind an ⓘ beside it (decision 329).
 * `folded` (true or false) makes the heading fold the block away and open it
 * again, starting as given.
 */
export default function FormSection({ title, info = null, children, className = '', folded }) {
  const foldable = folded != null
  const [shut, setShut] = useState(!!folded)
  return (
    <div className={`element-form ${className}`.trim()}>
      {title && (foldable ? (
        <span className="create-element-section">
          <button type="button" className="form-section-fold" aria-expanded={!shut} onClick={() => setShut(v => !v)}>
            <span aria-hidden="true">{shut ? '▸' : '▾'}</span> {title}
          </button>
          {info && <InfoTip text={info} />}
        </span>
      ) : <span className="create-element-section">{title}{info && <InfoTip text={info} />}</span>)}
      {!(foldable && shut) && children}
    </div>
  )
}
