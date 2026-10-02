/**
 * One block of a dialog's fields under a heading (R4.3) — "Geometry data",
 * "Meta data", … `title` is the text, already translated.
 */
export default function FormSection({ title, children, className = '' }) {
  return (
    <div className={`element-form ${className}`.trim()}>
      {title && <span className="create-element-section">{title}</span>}
      {children}
    </div>
  )
}
