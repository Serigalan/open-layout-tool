import InfoTip from './InfoTip'

/**
 * One block of a dialog's fields under a heading (R4.3) — "Geometry data",
 * "Meta data", … `title` is the text, already translated; `info` an
 * explanation of the block, folded away behind an ⓘ beside it (decision 329).
 */
export default function FormSection({ title, info = null, children, className = '' }) {
  return (
    <div className={`element-form ${className}`.trim()}>
      {title && <span className="create-element-section">{title}{info && <InfoTip text={info} />}</span>}
      {children}
    </div>
  )
}
