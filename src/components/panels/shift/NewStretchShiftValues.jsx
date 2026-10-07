import { useMemo } from 'react'
import { comparedLine } from '../../../utils/shiftValues'
import { trackLabel } from '../../../utils/trackModel'
import { trackLength } from '../../../utils/heightUtils'
import { useI18n } from '../../../locales/i18nContext'
import ShiftValuesSection from './ShiftValuesSection'

/**
 * The shift values of what a connect dialog would append to `track`
 * (Paket V, Entscheidung 200): `elements` the new ones, in the track's plane.
 * They have no gradient yet, so only across.
 */
export default function NewStretchShiftValues({ id, track, elements }) {
  const { t } = useI18n()
  const line = useMemo(
    () => (track && elements?.length ? comparedLine(elements, track.epsg, { station0: trackLength(track) }) : null),
    [track, elements])
  if (!line) return null
  return (
    <ShiftValuesSection id={id} line={line} epsg={track.epsg} heightNote={t('shift_no_heights_new')} name={trackLabel(track)} />
  )
}
