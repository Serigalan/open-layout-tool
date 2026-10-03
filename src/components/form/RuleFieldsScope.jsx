import { useState } from 'react'
import { RuleFieldsContext } from './ruleFieldsContext'

/** Where a dialog's rule findings reach its fields: around the panel (R10.4). */
export default function RuleFieldsScope({ children }) {
  const [fields, setFields] = useState(null)
  return <RuleFieldsContext.Provider value={{ fields, setFields }}>{children}</RuleFieldsContext.Provider>
}
