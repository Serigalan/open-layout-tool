import { useCallback, useReducer } from 'react'
import { DEFAULT_HEIGHT_EPSG } from '../utils/mapConstants'

const initialState = {
  owner: 'DB',
  type: 'line_track',
  lineNumber: '',
  lineName: '',
  side: 'sorting',
  stationName: '',
  uicStation: '',
  trackNumber: '',
  heightEpsg: String(DEFAULT_HEIGHT_EPSG),
  errors: [],
}

const reducer = (state, { name, value }) => ({ ...state, [name]: value })

export default function useTrackFields() {
  const [state, dispatch] = useReducer(reducer, initialState)

  const { errors, ...fields } = state
  // Stable across renders (dispatch is), so an effect may depend on them.
  const setField  = useCallback((name, value) => dispatch({ name, value }), [])
  const setErrors = useCallback((value) => dispatch({ name: 'errors', value }), [])

  const lineNumberError = (() => {
    const { lineNumber, owner, type } = fields
    if (type !== 'line_track' || !lineNumber) return null
    const str = String(lineNumber)
    if (owner === 'DB'   && !/^\d{4}$/.test(str)) return 'db'
    if (owner === 'SNCF' && !/^\d{6}$/.test(str)) return 'sncf'
    return null
  })()

  return { fields, errors, setErrors, setField, lineNumberError }
}
