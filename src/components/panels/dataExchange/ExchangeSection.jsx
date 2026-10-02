import FormSection from '../../form/FormSection'

/** One format of the data exchange: a heading, what it is for, its controls. */
export default function ExchangeSection({ title, description, children }) {
  return (
    <FormSection title={title}>
      {description && <p className="msg-hint">{description}</p>}
      {children}
    </FormSection>
  )
}
