import { createContext, useContext } from 'react'

// The rule findings of the dialog on screen, per field (R10.4): RuleFindings
// works them out and publishes them here, the fields read theirs.
export const RuleFieldsContext = createContext(null)

/** The finding at field `name` — { severity, ids } — or null. */
export function useRuleField(name) {
  return useContext(RuleFieldsContext)?.fields?.[name] ?? null
}
