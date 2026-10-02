/** A value the dialog states but does not let one type (R4.3): a label and a read-only field. */
export default function ReadOnlyField({ label, value, type = 'text' }) {
  return (
    <div className="form-field">
      <label>{label}</label>
      <input type={type} readOnly value={value ?? ''} />
    </div>
  )
}
