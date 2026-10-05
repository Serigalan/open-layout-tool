import { useEffect, useState } from 'react'
import { groupHeading, groupTracks, trackListLabel } from '../../utils/trackGroups'
import { trackMatches } from '../../utils/search'
import { fitToTracks } from '../../utils/mapRenderUtils'
import { useI18n } from '../../locales/i18nContext'
import { useMap } from '../../map/MapContext'

/**
 * A project's tracks under the line or station they belong to (see
 * trackGroups), each group folding away under its header. Where no track
 * belongs to anything the headers would only say so once more, and the list
 * is flat as before.
 *
 * `isActive(track)` marks a track, `onPick(track)` is what a click on one does.
 * With `onPickGroup(group)` the header carries a button that picks the group
 * as a whole — the list of a form that takes several tracks at once —, named
 * by `groupLabel(group)` where picking means something else. With
 * `isChecked(track)` every track is a checkbox instead of a button, and
 * ticking it is the pick.
 *
 * Above it a search (R10.6): any part of a name, line number or station, and
 * the kind of track. A search that leaves one track zooms the map to it.
 */
export default function GroupedTrackList({ tracks: all, isActive, onPick, onPickGroup, groupLabel, isChecked }) {
  const { t, fill } = useI18n()
  const map = useMap()
  const [folded, setFolded] = useState(() => new Set())
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('')
  const searching = !!(query.trim() || kind)
  const tracks = searching ? all.filter(tr => trackMatches(tr, query, kind)) : all
  const groups = groupTracks(tracks)

  // One track found: the map goes there.
  const only = query.trim() && tracks.length === 1 ? tracks[0] : null
  useEffect(() => {
    if (only) fitToTracks(map?.current, [only], { maxZoom: 17 })
  }, [only, map])

  const search = (
    <div className="track-search">
      <input type="search" value={query} placeholder={t('search_tracks')} aria-label={t('search_tracks')}
        onChange={e => setQuery(e.target.value)} />
      <select value={kind} onChange={e => setKind(e.target.value)} aria-label={t('type')}>
        <option value="">{t('search_kind_all')}</option>
        <option value="line">{t('search_kind_line')}</option>
        <option value="station">{t('search_kind_station')}</option>
      </select>
      {searching && (
        <span className="track-search-count">
          {tracks.length ? fill('search_count', { n: tracks.length, total: all.length }) : t('search_none')}
        </span>
      )}
    </div>
  )

  const item = (track) => (isChecked ? (
    <label key={track.id} className="transition-curve-row overlay-item track-group-item">
      <input type="checkbox" checked={isChecked(track)} onChange={() => onPick?.(track)} />
      <span>{trackListLabel(track)}</span>
    </label>
  ) : (
    <button
      key={track.id}
      className={`create-element-btn track-group-item${isActive?.(track) ? ' active' : ''}`}
      onClick={() => onPick?.(track)}
    >
      {trackListLabel(track)}
    </button>
  ))

  if (!groups.length) return search
  if (groups.length === 1 && !groups[0].kind) {
    return <>{search}<div className="create-element-options">{groups[0].tracks.map(item)}</div></>
  }

  const toggle = (key) => setFolded(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  return (
    <>
    {search}
    <div className="track-groups">
      {groups.map((group) => {
        // A search opens every group it found something in.
        const open = searching || !folded.has(group.key)
        const activeCount = isActive ? group.tracks.filter(isActive).length : 0
        return (
          <div key={group.key} className="track-group">
            <div className="track-group-header">
              <button type="button" className="track-group-toggle" aria-expanded={open} onClick={() => toggle(group.key)}>
                <span className={`track-group-caret${open ? ' open' : ''}`} aria-hidden="true">▸</span>
                <span className="track-group-title">{groupHeading(t, group)}</span>
                <span className="track-group-count">
                  {activeCount > 0 && !open ? `${activeCount}/${group.tracks.length}` : group.tracks.length}
                </span>
              </button>
              {onPickGroup && (
                <button type="button" className="track-group-all" onClick={() => onPickGroup(group)}>
                  {groupLabel ? groupLabel(group) : t('track_group_pick_all')}
                </button>
              )}
            </div>
            {open && <div className="track-group-list">{group.tracks.map(item)}</div>}
          </div>
        )
      })}
    </div>
    </>
  )
}
