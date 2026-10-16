import { useEffect, useRef, useState } from 'react'
import { currentProject, setTracksPlane, updateTrack } from '../storage'
import { useProject } from '../hooks/useStore'
import { LINE_CATEGORIES } from '../utils/track/identifierUtils'
import { projectLineCategory } from '../utils/elevation/gradientCheck'
import {
  ownLineCategory, planeGroup, planeInSystem, previewTracksToPlane, projectSystem, systemChoices, systemDeviates,
  withLineCategory, zoneChoices,
} from '../utils/project/projectSettings'
import { crsName, crsSystem, crsSystemName } from '../utils/geometry/coordinateUtils'
import { trackLength } from '../utils/track/heightUtils'
import { trackStatus } from '../utils/track/planStatus'
import { groupHeading, groupTracks, trackListLabel, trackTypeName } from '../utils/track/trackGroups'
import { trackMatches } from '../utils/track/search'
import { fitToTracks } from '../map/mapRenderUtils'
import { formatNum } from '../locales/i18n'
import { useI18n } from '../locales/i18nContext'
import { useMap } from '../map/MapContext'
import { useSelectedOnMap } from '../map/useMapPick'
import { useOverlayHeight } from './chart/useChartViewport'
import CloseButton from './form/CloseButton'
import PlaneChangeDialog from './panels/ProjectSettingsPanel/PlaneChangeDialog'

const MIN_OVERLAY_PX = 200

/**
 * The tracks of the project settings, over the map (decision 324): every track
 * with what it is (decision 321) and the settings it may keep apart from the
 * project's — its coordinate system and its line category, each switched on
 * explicitly by its box; off, the choice shows the project's. The meridian
 * strip is the track's own whatever the system (decision 323), and always
 * settable. A table, grouped by line and station, with a search and a filter
 * for the tracks that keep something of their own.
 *
 * The line category is written the moment the box is ticked — as the
 * project's, so the track keeps it when the project's changes. A system and a
 * strip are the plane the track's numbers are in, so a box alone writes
 * nothing: picking another system or strip carries the track there (with what
 * its turnouts join it to, decision 319), and taking the box away carries a
 * deviating track into the project's system — each after a dialog that says
 * what it costs.
 */
export default function ProjectTracksOverlay({ onClose }) {
  const { t, fill } = useI18n()
  const map = useMap()
  const project = useProject()
  const bodyRef = useRef(null)
  const overlay = useOverlayHeight(bodyRef, { min: MIN_OVERLAY_PX })
  const tracks = project?.tracks ?? []
  const [query, setQuery] = useState('')
  const [onlyOwn, setOnlyOwn] = useState(false)
  const [folded, setFolded] = useState(() => new Set())
  const [shown, setShown] = useState(null)
  // Tracks whose box for a system of their own is ticked while they still lie
  // in the project's — nothing is written until one is picked.
  const [crsOpen, setCrsOpen] = useState(() => new Set())
  const [change, setChange] = useState(null)   // { tracks, epsg, report } — the dialog
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  useSelectedOnMap(shown ? { trackId: shown } : null)

  const refSystem = projectSystem(project)
  const refCategory = projectLineCategory(project)
  const ownCrs = (tr) => systemDeviates(tr, project) || crsOpen.has(tr.id)
  const hasOwn = (tr) => ownCrs(tr) || ownLineCategory(tr) != null
  const crsCount = tracks.filter(tr => systemDeviates(tr, project)).length
  const categoryCount = tracks.filter(tr => ownLineCategory(tr) != null).length

  const searching = !!query.trim() || onlyOwn
  const listed = tracks.filter(tr => (!query.trim() || trackMatches(tr, query)) && (!onlyOwn || hasOwn(tr)))
  const groups = groupTracks(listed)

  // A track that went into another system, or away, has no open box to keep.
  useEffect(() => {
    setCrsOpen(prev => {
      const keep = [...prev].filter(id => (project?.tracks ?? []).some(tr => tr.id === id && !systemDeviates(tr, project)))
      return keep.length === prev.size ? prev : new Set(keep)
    })
  }, [project])

  const show = (track) => {
    setShown(track.id)
    fitToTracks(map?.current, [track], { maxZoom: 17 })
  }

  const askPlane = async (track, epsg) => {
    if (epsg == null || Number(epsg) === Number(track.epsg)) return
    setError(null)
    setBusy(true)
    try {
      const p = currentProject()
      // Only what is not in that plane yet goes along, the track itself first.
      const byId = new Map(p.tracks.map(tr => [tr.id, tr]))
      const moving = planeGroup(p, track.id).map(id => byId.get(id))
        .filter(tr => tr && Number(tr.epsg) !== Number(epsg))
      const { report } = await previewTracksToPlane(p, moving.map(tr => tr.id), epsg)
      setChange({ tracks: moving, epsg: Number(epsg), report })
    } catch (err) {
      setError(err.message ?? t('collab_err_generic'))
    } finally {
      setBusy(false)
    }
  }

  const commitPlane = () => {
    const report = setTracksPlane(change.tracks.map(tr => tr.id), change.epsg)
    if (!report || report.refused > 0 || !report.moved) setError(t('project_settings_move_failed'))
    setChange(null)
  }

  const toggleCrs = (track) => {
    if (systemDeviates(track, project)) { askPlane(track, planeInSystem(track, refSystem)); return }
    setCrsOpen(prev => {
      const next = new Set(prev)
      if (next.has(track.id)) next.delete(track.id)
      else next.add(track.id)
      return next
    })
  }

  const toggleGroup = (key) => setFolded(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  const row = (track) => (
    <TrackRow key={track.id} track={track} active={shown === track.id} onShow={() => show(track)}
      crsOwn={ownCrs(track)} refSystem={refSystem} onToggleCrs={() => toggleCrs(track)}
      onPickSystem={(key) => askPlane(track, planeInSystem(track, key))}
      onPickZone={(epsg) => askPlane(track, epsg)} refCategory={refCategory}
      onToggleCategory={() => updateTrack(withLineCategory(track, ownLineCategory(track) ? null : refCategory))}
      onPickCategory={(category) => updateTrack(withLineCategory(track, category))}
      busy={busy} />
  )
  const COLUMNS = 9
  const grouped = groups.length > 1 || groups.some(g => g.kind)

  return (
    <div className="track-table-overlay project-tracks-overlay" style={overlay.style}>
      <div className="profile-resize" onPointerDown={overlay.onResizeStart} />
      <div className="track-table-header">
        <span className="track-table-title">
          {fill('project_settings_tracks', { n: tracks.length })}
          <span className="track-table-subtitle">
            {fill('project_settings_tracks_own', { crs: crsCount, category: categoryCount })}
          </span>
        </span>
        <div className="project-tracks-tools">
          <input type="search" value={query} placeholder={t('search_tracks')} aria-label={t('search_tracks')}
            onChange={e => setQuery(e.target.value)} />
          <label className="project-settings-only-own">
            <input type="checkbox" checked={onlyOwn} onChange={e => setOnlyOwn(e.target.checked)} />
            {t('project_settings_only_own')}
          </label>
          {searching && (
            <span className="track-search-count">
              {listed.length ? fill('search_count', { n: listed.length, total: tracks.length }) : t('search_none')}
            </span>
          )}
          <CloseButton onClick={onClose} />
        </div>
      </div>
      {error && <p className="form-error project-tracks-error">{error}</p>}
      <div className="track-table-scroll" ref={bodyRef}>
        {tracks.length === 0 ? <p className="project-tracks-empty">{t('plan_no_tracks')}</p> : (
          <table className="track-table project-tracks-table">
            <thead>
              <tr>
                <th>{t('project_settings_col_track')}</th>
                <th>{t('type')}</th>
                <th>{t('project_settings_col_where')}</th>
                <th className="num">{t('project_settings_col_length')}</th>
                <th className="num">{t('project_settings_col_elements')}</th>
                <th className="num">{t('project_settings_col_heights')}</th>
                <th>{t('project_settings_own_crs')}</th>
                <th>{t('project_settings_zone')}</th>
                <th>{t('project_settings_own_category')}</th>
              </tr>
            </thead>
            {groups.map(group => {
              const open = searching || !folded.has(group.key)
              return (
                <tbody key={group.key}>
                  {grouped && (
                    <tr className="project-tracks-group">
                      <td colSpan={COLUMNS}>
                        <button type="button" className="track-group-toggle" aria-expanded={open} onClick={() => toggleGroup(group.key)}>
                          <span className={`track-group-caret${open ? ' open' : ''}`} aria-hidden="true">▸</span>
                          <span className="track-group-title">{groupHeading(t, group)}</span>
                          <span className="track-group-count">{group.tracks.length}</span>
                        </button>
                      </td>
                    </tr>
                  )}
                  {open && group.tracks.map(row)}
                </tbody>
              )
            })}
          </table>
        )}
      </div>
      {change && (
        <PlaneChangeDialog change={change} busy={busy} onConfirm={commitPlane} onCancel={() => setChange(null)} />
      )}
    </div>
  )
}

/**
 * One track: its name (a click shows it on the map), what it is, and its
 * settings — the system and the line category each a box that switches it on
 * and the choice beside it, which shows the project's while the box is off;
 * between them the meridian strip of the system it lies in.
 */
function TrackRow({
  track, active, onShow, crsOwn, refSystem, onToggleCrs, onPickSystem, onPickZone,
  refCategory, onToggleCategory, onPickCategory, busy,
}) {
  const { t, fill, language } = useI18n()
  const category = ownLineCategory(track)
  const status = trackStatus(track)
  const ownSystem = crsSystem(track.epsg)
  const systemValue = crsOwn ? ownSystem : refSystem
  const systems = [...new Set([...systemChoices(track.epsg), ownSystem, refSystem].filter(Boolean))]
  const zones = zoneChoices(track)
  const hasZones = zones.some(z => z.zone != null)
  const where = [track.lineNumber && fill('project_settings_track_line', { n: track.lineNumber }), track.stationName]
    .filter(Boolean).join(' · ')
  const kind = [
    t(`type_${trackTypeName(track, 'line_track')}`),
    track.trackUse === 'siding' && t('track_use_siding'),
    status !== 'existing' && t(`status_${status}`),
  ].filter(Boolean).join(' · ')

  return (
    <tr className={active ? 'active' : undefined}>
      <td>
        <button type="button" className="project-settings-track-name" onClick={onShow} title={t('project_settings_track_show')}>
          {trackListLabel(track)}
        </button>
      </td>
      <td>{kind}</td>
      <td>{where}</td>
      <td className="num">{formatNum(trackLength(track), language, { digits: 2, unit: 'm' })}</td>
      <td className="num">{track.elements?.length ?? 0}</td>
      <td className="num">{track.heights?.length ?? 0}</td>
      <td>
        <span className="project-tracks-own">
          <input type="checkbox" checked={crsOwn} onChange={onToggleCrs} disabled={busy} aria-label={t('project_settings_own_crs')} />
          <select value={systemValue ?? ''} disabled={!crsOwn || busy} aria-label={t('project_settings_own_crs')}
            onChange={e => onPickSystem(e.target.value)}>
            {systems.map(key => <option key={key} value={key}>{crsSystemName(key)}</option>)}
          </select>
        </span>
      </td>
      <td>
        {hasZones && (
          <select value={Number(track.epsg)} disabled={busy} aria-label={t('project_settings_zone')}
            title={crsName(track.epsg) ?? ''} onChange={e => onPickZone(Number(e.target.value))}>
            {zones.map(z => (
              <option key={z.code} value={z.code}>{fill('project_settings_zone_option', { zone: z.zone, cm: z.centre, code: z.code })}</option>
            ))}
          </select>
        )}
      </td>
      <td>
        <span className="project-tracks-own">
          <input type="checkbox" checked={category != null} onChange={onToggleCategory} aria-label={t('project_settings_own_category')} />
          <select value={category ?? refCategory} disabled={category == null} aria-label={t('project_settings_own_category')}
            onChange={e => onPickCategory(e.target.value)}>
            {LINE_CATEGORIES.map(key => <option key={key} value={key}>{t(`line_category_${key}`)}</option>)}
          </select>
        </span>
      </td>
    </tr>
  )
}
