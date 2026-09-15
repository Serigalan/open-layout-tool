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
      setOpen(matches.length > 0)
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
