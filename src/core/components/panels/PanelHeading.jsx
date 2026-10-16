import { useRef, useState } from 'react'
import InfoTip from '../form/InfoTip'
import { SearchIcon } from '../icons'

/**
 * A panel's heading with, beside it, a small search field (decision 330): a
 * magnifier only, until it is clicked — then it grows over the rest of the
 * row and takes what is typed. It stays open while it holds something or the
 * focus is in it; Escape empties it. What it searches is up to the panel —
 * `search` is { value, onChange, placeholder }. `info` is an explanation
 * behind an ⓘ.
 */
export default function PanelHeading({ title, info = null, search = null }) {
  const [focus, setFocus] = useState(false)
  const inputRef = useRef(null)
  const open = !!search && (focus || !!search.value)

  return (
    <div className={`panel-heading${open ? ' searching' : ''}`}
      onFocus={() => setFocus(true)}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setFocus(false) }}>
      <div className="panel-heading-row">
      <h2 title={title}>{title}{info && <InfoTip text={info} />}</h2>
      {search && (
        <div className="panel-search" onClick={() => inputRef.current?.focus()}>
          <SearchIcon />
          <input ref={inputRef} type="search" value={search.value} title={search.placeholder}
            placeholder={open ? search.placeholder : ''} aria-label={search.placeholder}
            onChange={e => search.onChange(e.target.value)}
            onKeyDown={e => {
              if (e.key !== 'Escape' || !search.value) return
              e.stopPropagation()
              search.onChange('')
            }} />
        </div>
      )}
      </div>
    </div>
  )
}
