import { useState } from 'react'
import { loadSwitches } from '../storage'
import { switchDesignation, nextSwitchNumber, switchNumbersInUse } from '../utils/identifierUtils'

/**
 * The number a new switch is created under, and the designation composed from
 * it. A number identifies one turnout in a project — a plan names it by that
 * number alone — so it may be given out only once; `claim` says whether the
 * number entered is still free and flags the field when it is not.
 */
export default function useSwitchNumber(projectId) {
  const [number, setNumber] = useState(() => nextSwitchNumber(loadSwitches(projectId)))
  const [taken, setTaken] = useState(false)

  return {
    number,
    name: switchDesignation(number),
    taken,
    setNumber: (value) => { setNumber(value); setTaken(false) },
    claim: (alsoTaken = []) => {
      const used = switchNumbersInUse(loadSwitches(projectId))
      const free = Number.isInteger(number) && number > 0
        && !used.has(number) && !alsoTaken.includes(number)
      setTaken(!free)
      return free
    },
    reset: () => { setNumber(nextSwitchNumber(loadSwitches(projectId))); setTaken(false) },
  }
}
