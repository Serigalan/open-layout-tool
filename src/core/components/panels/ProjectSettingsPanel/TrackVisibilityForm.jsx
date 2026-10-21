import { setKmLinesHidden, setTracksHidden } from '../../../storage'
import { useHiddenKmLines, useHiddenTracks, useProject, useTracks } from '../../../hooks/useStore'
import GroupedTrackList from '../GroupedTrackList'
import FormSection from '../../form/FormSection'
import { useI18n } from '../../../locales/i18nContext'

/** Where a project's kilometrage line came from, as its row says it. */
const SOURCE_KEYS = { vermesn: 'track_visibility_km_source_vermesn', mdb: 'track_visibility_km_source_mdb' }

/** A kilometrage in kilometres to the metre: 163417.026 m → "163,417". */
const kmText = (metres) => (metres / 1000).toFixed(3).replace('.', ',')

/** The kilometrages a line covers, lowest and highest, or null. */
function kmRange(kmLine) {
  let lo = Infinity, hi = -Infinity
  for (const run of kmLine.runs ?? []) {
    for (const [, , km] of run) {
      if (km < lo) lo = km
      if (km > hi) hi = km
    }
  }
  return Number.isFinite(lo) ? [lo, hi] : null
}

/**
 * Which tracks the map shows (Projekteinstellungen → Gleise ein-/ausblenden,
 * decision 327): a tick a track, a group's at once from its header, all of
 * them with the buttons. It is kept on this device per project (storage.hiddenTracks) and changes
 * nothing about the tracks — the checks, the plan and the exchange file have
 * them all the same.
 *
 * Below them the project's own kilometrage lines, one tick each (decision
 * 354): a tick is what the map shows, so with the overlay of them switched off
 * (Ebenen, `kmLocalOn`) a tick switches it on with that line alone.
 */
export default function TrackVisibilityForm({ kmLocalOn = false, onKmLocalChange }) {
  const { t, fill } = useI18n()
  const project = useProject()
  const tracks = useTracks()
  const hidden = useHiddenTracks()
  const hiddenKm = useHiddenKmLines()
  const shown = (track) => !hidden.has(track.id)
  const hiddenCount = tracks.filter(tr => hidden.has(tr.id)).length
  const allShown = (list) => list.every(shown)
  const ids = (list) => list.map(tr => tr.id)

  const kmLines = project?.kmLines ?? []
  const numbers = kmLines.map(l => String(l.lineNumber))
  const kmShown = (n) => kmLocalOn && !hiddenKm.has(n)
  const toggleKm = (n) => {
    if (!kmLocalOn) {
      setKmLinesHidden(numbers.filter(x => x !== n), true)
      setKmLinesHidden([n], false)
      onKmLocalChange?.(true)
    } else {
      setKmLinesHidden([n], kmShown(n))
    }
  }
  const showAllKm = () => { setKmLinesHidden(numbers, false); onKmLocalChange?.(true) }

  return (
    <>
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

      <FormSection title={t('track_visibility_km')} info={t('track_visibility_km_hint')}>
        {!kmLines.length ? (
          <span className="msg-hint msg-small">{t('track_visibility_km_none')}</span>
        ) : (
          <>
            <div className="track-visibility-actions">
              <button type="button" className="panel-btn" disabled={numbers.every(kmShown)} onClick={showAllKm}>
                {t('track_visibility_show_all')}
              </button>
              <button type="button" className="panel-btn" disabled={!numbers.some(kmShown)}
                onClick={() => onKmLocalChange?.(false)}>
                {t('track_visibility_hide_all')}
              </button>
            </div>
            {!kmLocalOn && <p className="msg-hint msg-small">{t('track_visibility_km_off')}</p>}
            <div className="create-element-options">
              {kmLines.map((kmLine) => {
                const n = String(kmLine.lineNumber)
                const range = kmRange(kmLine)
                return (
                  <label key={kmLine.id ?? n} className="transition-curve-row overlay-item track-group-item">
                    <input type="checkbox" checked={kmShown(n)} onChange={() => toggleKm(n)} />
                    <span>
                      {fill('track_visibility_km_line', { line: n })}
                      <span className="msg-hint msg-small">
                        {' · '}{t(SOURCE_KEYS[kmLine.source] ?? 'track_visibility_km_source_db')}
                        {range && ` · km ${kmText(range[0])} – ${kmText(range[1])}`}
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>
          </>
        )}
      </FormSection>
    </>
  )
}
