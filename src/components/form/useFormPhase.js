import { useCallback, useState } from 'react'

/**
 * The two-step life of a map dialog (R4.3): first 'select' — the user picks
 * something on the map — then a working phase on what was picked. `begin`
 * moves on with the pick, `reset` goes back to the start and forgets it.
 */
export default function useFormPhase(start = 'select') {
  const [state, setState] = useState({ phase: start, pick: null })
  const begin = useCallback((pick, phase = 'editing') => setState({ phase, pick }), [])
  const setPhase = useCallback(phase => setState(s => ({ ...s, phase })), [])
  const reset = useCallback(() => setState({ phase: start, pick: null }), [start])
  return { phase: state.phase, pick: state.pick, begin, setPhase, reset }
}
