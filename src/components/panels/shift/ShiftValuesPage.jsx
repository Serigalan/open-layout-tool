import { useMemo } from 'react'
import { comparedLine } from '../../../utils/shiftValues'
import { trackLabel } from '../../../utils/trackModel'
import { useTracks } from '../../../hooks/useStore'
import { useI18n } from '../../../locales/i18nContext'
import useMapPick, { useSelectedOnMap } from '../../../map/useMapPick'
import GroupedTrackList from '../GroupedTrackList'
import ShiftValuesSection from './ShiftValuesSection'

/**
 * Prüfen › Verschiebewerte (Paket V): a track, picked from the list or on the
 * map, against a reference axis — its whole length, its gradient with it.
 */
export default function ShiftValuesPage({ trackId, onPick }) {
  const { t } = useI18n()
  const tracks = useTracks()
  const track = tracks.find(tr => tr.id === trackId) ?? null
  useMapPick({ active: true, hover: 'track', onPick: ({ trackId: id }) => onPick(id) })
  useSelectedOnMap(track ? { trackId: track.id } : null)
  const line = useMemo(
    () => (track ? comparedLine(track.elements, track.epsg, { heights: track.heights }) : null),
    [track])
  return (
    <>
      <h2>{t('shift_title')}</h2>
      <p className="selecting-hint">{t('shift_page_hint')}</p>
      {track && (
        <ShiftValuesSection id="shift-check" line={line} epsg={track.epsg} heightEpsg={track.heightEpsg}
          heightNote={!track.heights?.length ? t('shift_no_heights_track') : null} name={trackLabel(track)} open />
      )}
      <GroupedTrackList tracks={tracks} isActive={(tr) => tr.id === trackId} onPick={(tr) => onPick(tr.id)} />
    </>
  )
}
