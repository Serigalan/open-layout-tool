import { useState } from 'react'

/** The state of a track search (GroupedTrackList): what is typed. */
export function useTrackSearch() {
  const [query, setQuery] = useState('')
  return { query, setQuery }
}

/** A track search as the field beside a panel's heading takes it (PanelHeading, decision 330). */
export function trackSearchField(search, t) {
  return { value: search.query, onChange: search.setQuery, placeholder: t('search_tracks') }
}
