import FormSection from '../../form/FormSection'

/** One format of the data exchange: a heading, what it is for behind an ⓘ beside it (decision 329), its controls. */
export default function ExchangeSection({ title, description, children }) {
  return (
    <FormSection title={title} info={description}>
      {children}
    </FormSection>
  )
}
