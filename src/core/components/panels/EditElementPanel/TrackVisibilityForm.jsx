import { setTracksHidden } from '../../../storage'
import { useHiddenTracks, useTracks } from '../../../hooks/useStore'
import GroupedTrackList from '../GroupedTrackList'
import { useI18n } from '../../../locales/i18nContext'

/**
 * Which tracks the map shows (Bearbeiten → Gleise ein-/ausblenden): a tick a
 * track, a group's at once from its header, all of them with the buttons. It
 * is kept on this device per project (storage.hiddenTracks) and changes
 * nothing about the tracks — the checks, the plan and the exchange file have
 * them all the same.
 */
export default function TrackVisibilityForm() {
  const { t, fill } = useI18n()
  const tracks = useTracks()
  const hidden = useHiddenTracks()
  const shown = (track) => !hidden.has(track.id)
  const hiddenCount = tracks.filter(tr => hidden.has(tr.id)).length
  const allShown = (list) => list.every(shown)
  const ids = (list) => list.map(tr => tr.id)

  return (
    <>
      <p>{t('track_visibility_hint')}</p>
      <div className="track-visibility-actions">
        <button type="button" className="panel-btn" disabled={!hiddenCount}
          onClick={() => setTracksHidden(ids(tracks), false)}>
          {t('track_visibility_show_all')}
        </button>
        <button type="button" className="panel-btn" disabled={hiddenCount === tracks.length}
          onClick={() => setTracksHidden(ids(tracks), true)}>
          {t('track_visibility_hide_all')}
        </button>
      </div>
      {hiddenCount > 0 && (
        <p className="msg-hint msg-small">{fill('track_visibility_count', { n: hiddenCount, total: tracks.length })}</p>
      )}
      <GroupedTrackList tracks={tracks} isChecked={shown} isActive={shown}
        onPick={(track) => setTracksHidden([track.id], shown(track))}
        onPickGroup={(group) => setTracksHidden(ids(group.tracks), allShown(group.tracks))}
        groupLabel={(group) => t(allShown(group.tracks) ? 'track_visibility_hide_group' : 'track_visibility_show_group')} />
    </>
  )
}
