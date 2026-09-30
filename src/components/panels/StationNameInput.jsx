import { useEffect, useRef, useState } from 'react'

// Module-level cache – fetched and preprocessed once
let _uicStations = null
let _uicFetchPromise = null

function loadUicStations() {
  if (_uicStations) return Promise.resolve(_uicStations)
  if (_uicFetchPromise) return _uicFetchPromise
  _uicFetchPromise = fetch('/uic_station_numbers.json')
    .then((r) => r.json())
    .then((data) => {
      _uicStations = data.map((s) => ({ ...s, nameLower: s.name.toLowerCase() }))
      return _uicStations
    })
    .catch(() => {
      _uicFetchPromise = null
      return []
    })
  return _uicFetchPromise
}

export default function StationNameInput({ value, onChange, onSelectSuggestion }) {
  const [suggestions, setSuggestions] = useState([])
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)
  // The name a suggestion just put into the field. The search that follows
  // the new value would find that very station and open the list again — so
  // a second click was needed to close it — which is why it stays shut for it.
  const pickedRef = useRef(null)

  useEffect(() => {
    loadUicStations()
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      const trimmed = value.trim()
      if (trimmed.length < 2 || !_uicStations) {
        setSuggestions([])
        return
      }
      const lower = trimmed.toLowerCase()
      const matches = []
      for (const s of _uicStations) {
        if (s.nameLower.includes(lower)) {
          matches.push(s)
          if (matches.length === 8) break
        }
      }
      setSuggestions(matches)
      const picked = pickedRef.current === value
      pickedRef.current = null
      setOpen(matches.length > 0 && !picked)
    }, 80)
    return () => clearTimeout(timer)
  }, [value])

  useEffect(() => {
    function handleClick(e) {
      if (!containerRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      <input
        type="text"
        value={value}
        onChange={onChange}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        autoComplete="off"
        style={{ width: '100%', boxSizing: 'border-box' }}
      />
      {open && (
        <ul className="uic-suggestions">
          {suggestions.map((s) => (
            <li
              key={s.uic}
              onMouseDown={(e) => {
                e.preventDefault()
                pickedRef.current = s.name
                onSelectSuggestion(s)
                setOpen(false)
              }}
            >
              <span className="uic-suggestion-name">{s.name}</span>
              <span className="uic-suggestion-uic">{s.uic}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
