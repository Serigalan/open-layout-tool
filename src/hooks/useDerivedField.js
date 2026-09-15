import { useState } from 'react'

/**
 * A form field that shows a computed value until the user overrides it, and
 * follows the computation again as soon as its inputs change. `key` stands for
 * those inputs — an override counts only for the key it was made under.
 *
 * Derived while rendering rather than pushed by an effect, so the field can
 * never show a value computed from inputs that have already changed.
 * Returns [value, override, clear].
 */
export default function useDerivedField(key, computed) {
  const [edit, setEdit] = useState(null)   // { key, value }
  return [
    edit?.key === key ? edit.value : computed,
    (value) => setEdit({ key, value }),
    () => setEdit(null),
  ]
}
