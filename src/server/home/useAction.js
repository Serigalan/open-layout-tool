import { useState } from 'react'
import { errorText } from '../collab/errorText'

/** Run an async action with busy and error state for a dialog. */
export default function useAction(t) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const run = async (fn) => {
    setBusy(true)
    setError(null)
    try { await fn() } catch (err) { setError(errorText(t, err.code)); setBusy(false) }
  }
  return { busy, error, run }
}
