import { useEffect, useState } from 'react'
import { currentProject, setTracksPlane, updateTrack } from '../../../storage'
import { LINE_CATEGORIES } from '../../../utils/identifierUtils'
import { projectLineCategory } from '../../../utils/gradientCheck'
import {
  crsChoices, epsgDeviates, ownLineCategory, planeGroup, previewTracksToPlane, projectEpsg, withLineCategory,
} from '../../../utils/projectSettings'
import { crsName } from '../../../utils/coordinateUtils'
import { trackLength } from '../../../utils/heightUtils'
import { trackStatus } from '../../../utils/planStatus'
import { groupHeading, groupTracks, trackListLabel, trackTypeName } from '../../../utils/trackGroups'
import { trackMatches } from '../../../utils/search'
import { fitToTracks } from '../../../utils/mapRenderUtils'
import { formatNum } from '../../../locales/i18n'
import { useI18n } from '../../../locales/i18nContext'
import { useMap } from '../../../map/MapContext'
import { useSelectedOnMap } from '../../../map/useMapPick'
import PlaneChangeDialog from './PlaneChangeDialog'

/**
 * Every track of the project with what it is (decision 321) and the two
 * settings it may keep apart from the project's: its coordinate system and
 * its line category. Each is switched on explicitly by its box; off, the track
 * runs on the project's and the choice shows that.
 *
 * The line category is written the moment the box is ticked — as the
 * project's, so the track keeps it when the project's changes. A coordinate
 * system is the plane the track's numbers are in, so a box alone writes
 * nothing: picking another plane carries the track there (with what its
 * turnouts join it to), and taking the box away carries a deviating track
 * into the project's — each after a dialog that says what it costs.
 */
export default function TrackSettingsList({ project }) {
  const { t, fill } = useI18n()
  const map = useMap()
  const tracks = project.tracks ?? []
  const [query, setQuery] = useState('')
  const [onlyOwn, setOnlyOwn] = useState(false)
  const [folded, setFolded] = useState(() => new Set())
  const [shown, setShown] = useState(null)
  // Tracks whose box for a coordinate system of their own is ticked while
  // they still lie in the project's — nothing is written until one is picked.
  const [crsOpen, setCrsOpen] = useState(() => new Set())
  const [change, setChange] = useState(null)   // { tracks, epsg, report } — the dialog
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  useSelectedOnMap(shown ? { trackId: shown } : null)

  const refEpsg = projectEpsg(project)
  const refCategory = projectLineCategory(project)
  const ownCrs = (tr) => epsgDeviates(tr, project) || crsOpen.has(tr.id)
  const hasOwn = (tr) => ownCrs(tr) || ownLineCategory(tr) != null
  const crsCount = tracks.filter(tr => epsgDeviates(tr, project)).length
  const categoryCount = tracks.filter(tr => ownLineCategory(tr) != null).length

  const searching = !!query.trim() || onlyOwn
  const listed = tracks.filter(tr => (!query.trim() || trackMatches(tr, query)) && (!onlyOwn || hasOwn(tr)))
  const groups = groupTracks(listed)

  // A track that went into the project's plane, or away, has no open box to keep.
  useEffect(() => {
    setCrsOpen(prev => {
      const keep = [...prev].filter(id => (project.tracks ?? []).some(tr => tr.id === id && !epsgDeviates(tr, project)))
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
    if (epsgDeviates(track, project)) { askPlane(track, refEpsg); return }
    setCrsOpen(prev => {
      const next = new Set(prev)
      if (next.has(track.id)) next.delete(track.id)
      else next.add(track.id)
      return next
    })
  }

  const toggleCategory = (track) => {
    updateTrack(withLineCategory(track, ownLineCategory(track) ? null : refCategory))
  }

  const toggleGroup = (key) => setFolded(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  const row = (track) => (
    <TrackSettingsRow key={track.id} track={track} active={shown === track.id} onShow={() => show(track)}
      crsOwn={ownCrs(track)} refEpsg={refEpsg} onToggleCrs={() => toggleCrs(track)}
      onPickCrs={(epsg) => askPlane(track, epsg)} refCategory={refCategory}
      onToggleCategory={() => toggleCategory(track)}
      onPickCategory={(category) => updateTrack(withLineCategory(track, category))}
      busy={busy} />
  )

  return (
    <div className="element-form">
      <span className="create-element-section">{fill('project_settings_tracks', { n: tracks.length })}</span>
      {tracks.length === 0 ? <span className="project-settings-hint">{t('plan_no_tracks')}</span> : (
        <>
          <span className="project-settings-hint">
            {fill('project_settings_tracks_own', { crs: crsCount, category: categoryCount })}
          </span>
          <div className="track-search">
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
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="track-groups">
            {groups.map(group => {
              const open = searching || !folded.has(group.key)
              return (
                <div key={group.key} className="track-group">
                  {(groups.length > 1 || group.kind) && (
                    <div className="track-group-header">
                      <button type="button" className="track-group-toggle" aria-expanded={open} onClick={() => toggleGroup(group.key)}>
                        <span className={`track-group-caret${open ? ' open' : ''}`} aria-hidden="true">▸</span>
                        <span className="track-group-title">{groupHeading(t, group)}</span>
                        <span className="track-group-count">{group.tracks.length}</span>
                      </button>
                    </div>
                  )}
                  {open && <div className="project-settings-tracks">{group.tracks.map(row)}</div>}
                </div>
              )
            })}
          </div>
        </>
      )}
      {change && (
        <PlaneChangeDialog change={change} busy={busy} onConfirm={commitPlane} onCancel={() => setChange(null)} />
      )}
    </div>
  )
}

/**
 * One track: its name (a click shows it on the map), what it is, and its two
 * settings — each a box that switches it on and the choice beside it, which
 * shows the project's while the box is off.
 */
function TrackSettingsRow({
  track, active, onShow, crsOwn, refEpsg, onToggleCrs, onPickCrs,
  refCategory, onToggleCategory, onPickCategory, busy,
}) {
  const { t, fill, language } = useI18n()
  const category = ownLineCategory(track)
  const status = trackStatus(track)
  const heights = track.heights?.length ?? 0
  const facts = [
    t(`type_${trackTypeName(track, 'line_track')}`),
    track.lineNumber && fill('project_settings_track_line', { n: track.lineNumber }),
    track.stationName,
    formatNum(trackLength(track), language, { digits: 2, unit: 'm' }),
    fill('project_settings_track_elements', { n: track.elements?.length ?? 0 }),
    heights ? fill('project_settings_track_heights', { n: heights }) : t('project_settings_track_no_heights'),
    track.trackUse === 'siding' && t('track_use_siding'),
    status !== 'existing' && t(`status_${status}`),
  ].filter(Boolean)
  const crsValue = crsOwn ? Number(track.epsg) : refEpsg
  const choices = crsChoices(track.epsg, refEpsg)

  return (
    <div className={`project-settings-track${active ? ' active' : ''}`}>
      <button type="button" className="project-settings-track-name" onClick={onShow}
        title={t('project_settings_track_show')}>
        {trackListLabel(track)}
      </button>
      <span className="project-settings-track-facts">{facts.join(' · ')}</span>
      <div className="project-settings-own">
        <label>
          <input type="checkbox" checked={crsOwn} onChange={onToggleCrs} disabled={busy} />
          {t('project_settings_own_crs')}
        </label>
        <select value={crsValue ?? ''} disabled={!crsOwn || busy} aria-label={t('project_settings_own_crs')}
          title={crsName(crsValue) ?? ''} onChange={e => onPickCrs(Number(e.target.value))}>
          {choices.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
        </select>
        <label>
          <input type="checkbox" checked={category != null} onChange={onToggleCategory} />
          {t('project_settings_own_category')}
        </label>
        <select value={category ?? refCategory} disabled={category == null} aria-label={t('project_settings_own_category')}
          onChange={e => onPickCategory(e.target.value)}>
          {LINE_CATEGORIES.map(key => <option key={key} value={key}>{t(`line_category_${key}`)}</option>)}
        </select>
      </div>
    </div>
  )
}
