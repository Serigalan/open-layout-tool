import { useState } from 'react'
import { groupHeading, groupTracks, trackListLabel } from '../../utils/trackGroups'
import { useI18n } from '../../locales/i18nContext'

/**
 * A project's tracks under the line or station they belong to (see
 * trackGroups), each group folding away under its header. Where no track
 * belongs to anything the headers would only say so once more, and the list
 * is flat as before.
 *
 * `isActive(track)` marks a track, `onPick(track)` is what a click on one does.
 * With `onPickGroup(group)` the header carries a button that picks the group
 * as a whole — the list of a form that takes several tracks at once.
 */
export default function GroupedTrackList({ tracks, isActive, onPick, onPickGroup }) {
  const { t } = useI18n()
  const [folded, setFolded] = useState(() => new Set())
  const groups = groupTracks(tracks)

  const item = (track) => (
    <button
      key={track.id}
      className={`create-element-btn track-group-item${isActive?.(track) ? ' active' : ''}`}
      onClick={() => onPick?.(track)}
    >
      {trackListLabel(track)}
    </button>
  )

  if (groups.length === 1 && !groups[0].kind) {
    return <div className="create-element-options">{groups[0].tracks.map(item)}</div>
  }

  const toggle = (key) => setFolded(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  return (
    <div className="track-groups">
      {groups.map((group) => {
        const open = !folded.has(group.key)
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
                  {t('track_group_pick_all')}
                </button>
              )}
            </div>
            {open && <div className="track-group-list">{group.tracks.map(item)}</div>}
          </div>
        )
      })}
    </div>
  )
}
