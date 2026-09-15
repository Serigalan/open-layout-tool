import { useState } from 'react'
import { loadTracks } from '../../storage'
import { fillHeights } from '../../utils/elevationFill'

/**
 * Vertical alignment: pick a track to see its profile in the overlay, and
 * bring heights in from the terrain. Elements without heights are filled
 * automatically after every change; the buttons here are for the rest —
 * reading a whole track again (which overwrites edited heights) or retrying
 * the missing ones after a failed fetch.
 */
export default function ElevationPanel({ t, project, profileTrackId, onShowProfile, onTrackSaved }) {
  const tracks = loadTracks(project?.id ?? '') ?? []
  const [busy, setBusy]     = useState(false)
  const [result, setResult] = useState(null)   // { updated, missing } of the last run

  const run = async (opts) => {
    setBusy(true)
    setResult(null)
    try {
      setResult(await fillHeights(project.id, opts))
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
      <div className="create-element-options">
        {tracks.map((track) => (
          <button
            key={track.id}
            className={`create-element-btn${profileTrackId === track.id ? ' active' : ''}`}
            onClick={() => onShowProfile?.(track.id)}
          >
            {track.name || track.id.slice(0, 8)}
          </button>
        ))}
      </div>
      <button className="panel-btn panel-btn-full" style={{ marginTop: 12 }}
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
