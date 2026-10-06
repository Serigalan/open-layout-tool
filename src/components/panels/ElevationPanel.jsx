import { useState } from 'react'
import { loadTracks, currentProject, setHeightsForTracks, updateProject } from '../../storage'
import { useProject } from '../../hooks/useStore'
import { LINE_CATEGORIES } from '../../utils/identifierUtils'
import { projectLineCategory } from '../../utils/gradientCheck'
import { fillHeights } from '../../utils/elevationFill'
import { chosenTerrainSource } from '../../utils/elevationSource'
import TerrainSourceSelect from '../TerrainSourceSelect'
import GroupedTrackList from './GroupedTrackList'
import GradientFindings from './GradientFindings'
import FormSection from '../form/FormSection'
import { useI18n } from '../../locales/i18nContext'
import useMapPick from '../../map/useMapPick'

/**
 * Vertical alignment: pick a track to see its profile in the overlay, and
 * bring heights in from the terrain. Nothing is read on its own — a track has
 * a gradient once it is stated or asked for: in the profile of a track without
 * one, or with the buttons here — reading a whole track again (which
 * overwrites edited heights), or every track that still lacks heights.
 *
 * Above the list, what the Höhenplan rules say about the gradient on show,
 * and the line category of the project they judge a line track by — above
 * it, since the list of a large project runs far below the screen.
 */
export default function ElevationPanel({ profileTrackId, onShowProfile }) {
  const { t, fill } = useI18n()
  const tracks = loadTracks() ?? []
  const [busy, setBusy]     = useState(false)
  const [result, setResult] = useState(null)   // { updated, missing } of the last run
  const [terrainSource, setTerrainSource] = useState(chosenTerrainSource)
  const project = useProject()

  // A track is picked on the map as readily as from the list, and the one under
  // the cursor is drawn on the hover layer so it is clear which it would be.
  // Unlike the element table, the profile overlay takes no clicks of its own —
  // it only marks the elements its selection falls in — so this stays live
  // while a profile is open, and a click swaps it over to the track clicked.
  useMapPick({ hover: 'track', onPick: ({ trackId }) => onShowProfile?.(trackId) })

  const run = async (opts) => {
    setBusy(true)
    setResult(null)
    try {
      const r = await fillHeights(currentProject, { ...opts, source: terrainSource })
      if (r.heights.size) setHeightsForTracks(r.heights, { undo: !!opts?.force })
      setResult(r)
    } catch {
      setResult({ updated: 0, missing: 0, failed: true })
    } finally {
      setBusy(false)
    }
  }

  const resultText = (r) => r.failed
    ? t('elevation_failed')
    : fill('elevation_result', { updated: r.updated, missing: r.missing })

  return (
    <>
      <h2>{t('elevation_title')}</h2>
      <p>{t('elevation_hint')}</p>
      {tracks.length === 0 && <p className="form-error">{t('plan_no_tracks')}</p>}
      <FormSection title={t('elevation_rules')}>
        <p className="selecting-hint">{t('elevation_rules_hint')}</p>
        <div className="form-field">
          <label title={t('elevation_line_category_hint')}>{t('elevation_line_category')}</label>
          <select value={projectLineCategory(project)} title={t('elevation_line_category_hint')}
            onChange={(e) => updateProject({ lineCategory: e.target.value })}>
            {LINE_CATEGORIES.map(key => <option key={key} value={key}>{t(`line_category_${key}`)}</option>)}
          </select>
        </div>
        <GradientFindings trackId={profileTrackId} />
      </FormSection>
      <GroupedTrackList tracks={tracks}
        isActive={(track) => track.id === profileTrackId}
        onPick={(track) => onShowProfile?.(track.id)} />
      <div className="form-field mt-12">
        <label>{t('terrain_source')}</label>
        <TerrainSourceSelect value={terrainSource} onChange={setTerrainSource} />
      </div>
      <button className="panel-btn panel-btn-full mt-4"
        disabled={busy || !profileTrackId} onClick={() => run({ force: true, trackId: profileTrackId })}>
        {t('elevation_reload_track')}
      </button>
      <button className="panel-btn panel-btn-full mt-2 secondary"
        disabled={busy} onClick={() => run({})}>
        {t('elevation_load_missing')}
      </button>
      {busy && <p className="selecting-hint">{t('elevation_loading')}</p>}
      {result && !busy && <p className={result.failed ? 'form-error' : 'selecting-hint'}>{resultText(result)}</p>}
    </>
  )
}
