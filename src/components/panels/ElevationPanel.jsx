import { useState } from 'react'
import { loadTracks, currentProject, setHeightsForTracks } from '../../storage'
import { fillHeights } from '../../utils/elevationFill'
import useTrackPick from '../../hooks/useTrackPick'
import { chosenTerrainSource } from '../../utils/elevationSource'
import TerrainSourceSelect from '../TerrainSourceSelect'
import GroupedTrackList from './GroupedTrackList'

/**
 * Vertical alignment: pick a track to see its profile in the overlay, and
 * bring heights in from the terrain. Nothing is read on its own — a track has
 * a gradient once it is stated or asked for: in the profile of a track without
 * one, or with the buttons here — reading a whole track again (which
 * overwrites edited heights), or every track that still lacks heights.
 */
export default function ElevationPanel({ t, map, profileTrackId, onShowProfile, onTrackSaved }) {
  const tracks = loadTracks() ?? []
  const [busy, setBusy]     = useState(false)
  const [result, setResult] = useState(null)   // { updated, missing } of the last run
  const [terrainSource, setTerrainSource] = useState(chosenTerrainSource)

  // A track is picked on the map as readily as from the list, and the one under
  // the cursor is drawn on the hover layer so it is clear which it would be.
  // Unlike the element table, the profile overlay takes no clicks of its own —
  // it only marks the elements its selection falls in — so this stays live
  // while a profile is open, and a click swaps it over to the track clicked.
  useTrackPick(map, true, ({ trackId }) => onShowProfile?.(trackId), { highlight: true })

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
      onTrackSaved?.()
    }
  }

  const resultText = (r) => r.failed
    ? t('elevation_failed')
    : t('elevation_result').replace('{{updated}}', r.updated).replace('{{missing}}', r.missing)

  return (
    <>
      <h2>{t('elevation_title')}</h2>
      <p>{t('elevation_hint')}</p>
      {tracks.length === 0 && <p className="form-error">{t('plan_no_tracks')}</p>}
      <GroupedTrackList t={t} tracks={tracks}
        isActive={(track) => track.id === profileTrackId}
        onPick={(track) => onShowProfile?.(track.id)} />
      <div className="form-field" style={{ marginTop: 12 }}>
        <label>{t('terrain_source')}</label>
        <TerrainSourceSelect t={t} value={terrainSource} onChange={setTerrainSource} />
      </div>
      <button className="panel-btn panel-btn-full" style={{ marginTop: 4 }}
        disabled={busy || !profileTrackId} onClick={() => run({ force: true, trackId: profileTrackId })}>
        {t('elevation_reload_track')}
      </button>
      <button className="panel-btn panel-btn-full" style={{ marginTop: 2, background: '#888' }}
        disabled={busy} onClick={() => run({})}>
        {t('elevation_load_missing')}
      </button>
      {busy && <p className="selecting-hint">{t('elevation_loading')}</p>}
      {result && !busy && <p className={result.failed ? 'form-error' : 'selecting-hint'}>{resultText(result)}</p>}
    </>
  )
}
