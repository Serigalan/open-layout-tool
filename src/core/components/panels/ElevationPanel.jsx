import { useState } from 'react'
import { loadTracks, currentProject, setHeightsForTracks } from '../../storage'
import { fillHeights, chosenTerrainSource } from '../../utils/elevation'
import { useProject } from '../../hooks/useStore'
import TerrainSourceSelect from '../TerrainSourceSelect'
import GroupedTrackList from './GroupedTrackList'
import { trackSearchField, useTrackSearch } from './trackSearch'
import PanelHeading from './PanelHeading'
import RouteList from './RouteList'
import { resolveRoute } from '../../utils/track'
import useRouteOnMap from '../../map/useRouteOnMap'
import GradientFindings from './GradientFindings'
import SwitchDesignSection from './SwitchDesignSection'
import FormSection from '../form/FormSection'
import { useI18n } from '../../locales/i18nContext'
import useMapPick from '../../map/useMapPick'
import { heightPointAt, isPickingDependent } from '../../map/pick'

/**
 * Vertical alignment: pick a track to see its profile in the overlay, and
 * bring heights in from the terrain. Nothing is read on its own — a track has
 * a gradient once it is stated or asked for: in the profile of a track without
 * one, or with the buttons here — reading a whole track again (which
 * overwrites edited heights), or every track that still lacks heights.
 *
 * Under the heading the switch of the design mode for turnouts (decision
 * 384). Above the list, what the Höhenplan rules say about the gradient on
 * show, folded away until opened — above it, since the list of a large
 * project runs far below the screen. The line category they judge a track
 * by is set in the project settings (decision 320).
 */
export default function ElevationPanel({ profileTrackId, profileRouteId = null, onShowProfile, onShowRouteProfile }) {
  const { t, fill } = useI18n()
  const tracks = loadTracks() ?? []
  const [busy, setBusy]     = useState(false)
  const [result, setResult] = useState(null)   // { updated, missing } of the last run
  const [terrainSource, setTerrainSource] = useState(chosenTerrainSource)
  const project = useProject()
  const search = useTrackSearch()

  // A track is picked on the map as readily as from the list, and the one under
  // the cursor is drawn on the hover layer so it is clear which it would be.
  // Unlike the element table, the profile overlay takes no clicks of its own —
  // it only marks the elements its selection falls in — so this stays live
  // while a profile is open, and a click swaps it over to the track clicked.
  // The route on show (Paket RT), drawn on the map; its tracks are what a reload reads.
  const route = profileRouteId ? (project?.routes ?? []).find(r => r.id === profileRouteId) ?? null : null
  const resolvedRoute = route && project ? resolveRoute(route, project.tracks, project.switches) : null
  useRouteOnMap('elevation-route', resolvedRoute)
  // A click on one of the route's own tracks keeps the route.
  // A height point of the profile on show is the profile's to open (decision 389).
  useMapPick({ hover: 'track', onPick: ({ trackId }, e) => {
    if (isPickingDependent() || heightPointAt(e.target, e.point)) return
    if (!resolvedRoute?.parts.some(p => p.trackId === trackId)) onShowProfile?.(trackId)
  } })
  const shownTrackIds = resolvedRoute ? resolvedRoute.parts.map(p => p.trackId) : profileTrackId ? [profileTrackId] : []

  const run = async (opts, trackIds = [null]) => {
    setBusy(true)
    setResult(null)
    try {
      // One track or every track of the route on show, read in one go and written as one step.
      const r = { heights: new Map(), updated: 0, missing: 0 }
      for (const trackId of trackIds) {
        const one = await fillHeights(currentProject, { ...opts, ...(trackId ? { trackId } : {}), source: terrainSource })
        for (const [id, h] of one.heights) r.heights.set(id, h)
        r.updated += one.updated
        r.missing += one.missing
      }
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
      <PanelHeading title={t('elevation_title')} search={trackSearchField(search, t)} />
      <p>{t('elevation_hint')}</p>
      <SwitchDesignSection onShowProfile={onShowProfile} />
      {tracks.length === 0 && <p className="form-error">{t('plan_no_tracks')}</p>}
      {/* Only once there is something to judge (decision 331). */}
      {(resolvedRoute || profileTrackId) && <FormSection title={t('elevation_rules')} folded>
        {resolvedRoute ? resolvedRoute.parts.map(p => (
          <div key={p.trackId} className="route-findings">
            <span className="create-element-section">{p.track.name || p.trackId.slice(0, 8)}</span>
            <GradientFindings trackId={p.trackId} />
          </div>
        )) : profileTrackId && <GradientFindings trackId={profileTrackId} />}
      </FormSection>}
      <RouteList activeId={profileRouteId} onPick={(r) => onShowRouteProfile?.(r.id)} />
      <GroupedTrackList tracks={tracks} search={search}
        isActive={(track) => track.id === profileTrackId}
        onPick={(track) => onShowProfile?.(track.id)} />
      <div className="form-field mt-12">
        <label>{t('terrain_source')}</label>
        <TerrainSourceSelect value={terrainSource} onChange={setTerrainSource} />
      </div>
      <button className="panel-btn panel-btn-full mt-4"
        disabled={busy || !shownTrackIds.length} onClick={() => run({ force: true }, shownTrackIds)}>
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
