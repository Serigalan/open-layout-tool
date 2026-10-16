import { useState } from 'react'
import TrackKindSelect from './TrackKindSelect'

/** The state of a track search (GroupedTrackList): what is typed and the kind of track. */
export function useTrackSearch() {
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('')
  return { query, setQuery, kind, setKind }
}

/** A track search as the field beside a panel's heading takes it (PanelHeading, decision 330). */
export function trackSearchField(search, t) {
  return {
    value: search.query, onChange: search.setQuery, active: !!search.kind,
    placeholder: t('search_tracks'), children: <TrackKindSelect search={search} />,
  }
}
