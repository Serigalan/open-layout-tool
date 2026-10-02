import { useEffect, useState } from 'react'
import { loadTracks, replaceAllTracks } from '../../../storage'
import useTrackPick from '../../../hooks/useTrackPick'
import useNearbyLines from '../../../hooks/useNearbyLines'
import useLineNameSuggestion from '../../../hooks/useLineNameSuggestion'
import {
  assignTracks, assignmentFields, groupTitle, groupTracks, plannedNames, trackGroupKey, trackListLabel,
} from '../../../utils/trackGroups'
import { elementsPath, identifyTrackLine } from '../../../utils/lineLookup'
import { FILTER_NONE, mapIsLive } from '../../../utils/mapConstants'
import GroupedTrackList from '../GroupedTrackList'
import StationNameInput from '../StationNameInput'

const SELECTED_LAYER = 'tracks-selected-layer'
const NEW = 'new'
/** How long the line number has to hold still before the tracks are measured against it. */
const SETTLE_MS = 300

const filterForTracks = (ids) => ['in', ['get', 'trackId'], ['literal', ids]]

/**
 * Put tracks on a line (Strecke) or into a station (Bahnhof), several at once:
 * the tracks are picked from the grouped list or on the map, the line or
 * station from those the project already has, or entered anew. Taking tracks
 * out of whatever they were in is the third choice.
 *
 * Their names can be given anew on the way: on a line from the line number and
 * the kilometrage of each track's middle (`6344.02912`), in a station from the
 * station and each track's number (`Könnern.3`), shown before they are taken.
 *
 * The form stays open after a commit — the list regroups at once, and the
 * next tracks are usually just picked for the next line or station.
 */
export default function AssignTracksForm({ t, map, project, onCommitted }) {
  const [selected, setSelected] = useState(() => new Set())
  const [kind, setKind]         = useState('line')
  const [choice, setChoice]     = useState(NEW)
  const [entry, setEntry]       = useState({ lineNumber: '', lineName: '', stationName: '', uicStation: '' })
  const [error, setError]       = useState(null)
  const [done, setDone]         = useState(null)
  const [rename, setRename]     = useState(false)
  const [numbers, setNumbers]   = useState({})    // id → track number as typed
  const [kmLookup, setKmLookup] = useState({ key: null, km: {} })
  const lineOptions = useNearbyLines(map)

  const tracks = loadTracks()
  const groups = groupTracks(tracks)
  const existing = groups.filter(g => g.kind === kind)
  // An existing line or station that has since gone (its last track moved
  // elsewhere) is no choice any more; the form falls back to a new one.
  const chosen = existing.find(g => g.key === choice) ?? null

  const toggle = (id) => {
    setDone(null)
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const toggleGroup = (group) => {
    setDone(null)
    setSelected(prev => {
      const next = new Set(prev)
      const all = group.tracks.every(tr => next.has(tr.id))
      for (const tr of group.tracks) {
        if (all) next.delete(tr.id)
        else next.add(tr.id)
      }
      return next
    })
  }

  useTrackPick(map, true, ({ trackId }) => toggle(trackId), { highlight: true })

  // The tracks picked so far are drawn on the selection layer; it is given
  // back empty when the form goes.
  const selectedKey = [...selected].join('|')
  useEffect(() => {
    const m = map?.current
    if (!m?.getLayer(SELECTED_LAYER)) return
    m.setFilter(SELECTED_LAYER, selectedKey ? filterForTracks(selectedKey.split('|')) : FILTER_NONE)
  }, [map, selectedKey])
  useEffect(() => {
    const m = map?.current
    return () => {
      if (mapIsLive(map, m) && m.getLayer(SELECTED_LAYER)) m.setFilter(SELECTED_LAYER, FILTER_NONE)
    }
  }, [map])

  const setField = (name, value) => { setError(null); setEntry(prev => ({ ...prev, [name]: value })) }
  const changeKind = (next) => { setError(null); setKind(next); setChoice(NEW) }
  useLineNameSuggestion(entry.lineNumber, entry.lineName, setField, kind === 'line' && !chosen)

  const target = () => {
    if (kind === 'none') return { kind: null }
    if (chosen) return chosen
    return { kind, ...entry }
  }
  const to = target()
  const ids = tracks.filter(tr => selected.has(tr.id)).map(tr => tr.id)
  const renaming = rename && to.kind != null && ids.length > 0

  // Where on the line each track lies — what its name is built from — asked
  // for once the selection and the line number hold still.
  const kmLine = renaming && to.kind === 'line' ? String(to.lineNumber ?? '').trim() : ''
  const kmKey = kmLine ? `${kmLine}|${selectedKey}` : null
  useEffect(() => {
    if (!kmLine || !selectedKey) return
    let live = true
    const timer = setTimeout(() => {
      const all = loadTracks()
      Promise.all(selectedKey.split('|').map(async (id) => {
        const track = all.find(tr => tr.id === id)
        const geometry = track ? elementsPath(track.elements, track.epsg) : null
        const hit = geometry ? await identifyTrackLine(geometry, kmLine).catch(() => null) : null
        return [id, hit?.km ?? null]
      })).then((entries) => {
        if (live) setKmLookup({ key: `${kmLine}|${selectedKey}`, km: Object.fromEntries(entries) })
      })
    }, SETTLE_MS)
    return () => { live = false; clearTimeout(timer) }
  }, [kmLine, selectedKey, project.id])
  const kmPending = kmKey != null && kmLookup.key !== kmKey

  const numberOf = (track) => numbers[track.id] ?? (track.trackNumber != null ? String(track.trackNumber) : '')
  const numberById = Object.fromEntries(tracks.filter(tr => selected.has(tr.id)).map(tr => [tr.id, numberOf(tr)]))
  // A line without a number, a station without a name, names nothing yet; the
  // commit says what is missing.
  const nameable = to.kind === 'line' ? /^\d+$/.test(kmLine)
    : String(to.stationName ?? '').trim() !== '' || String(to.uicStation ?? '').trim() !== ''
  const plan = renaming && !kmPending && nameable
    ? plannedNames(tracks, ids, to, { kmById: kmLookup.km, numberById })
    : null

  const handleCommit = () => {
    if (!ids.length) { setError('assign_error_no_tracks'); return }
    if (to.kind === 'line' && !/^\d+$/.test(String(to.lineNumber ?? '').trim())) {
      setError('assign_error_line_number'); return
    }
    if (to.kind === 'station' && !String(to.stationName ?? '').trim() && !String(to.uicStation ?? '').trim()) {
      setError('assign_error_station_name'); return
    }
    if (renaming && !plan) return
    if (plan?.clashes.size) { setError('assign_error_name_clash'); return }
    replaceAllTracks(assignTracks(tracks, ids, to, {
      names: plan?.names ?? null,
      // The numbers a station track's name was built from are its own now.
      trackNumbers: renaming && to.kind === 'station' ? numberById : null,
    }))
    setSelected(new Set())
    setError(null)
    setDone({ count: ids.length, kind: to.kind ?? null, title: to.kind ? groupTitle(to) : '' })
    // What was just entered is a line or station of the project now, so the
    // next tracks are put there by picking it rather than typing it again.
    setChoice(trackGroupKey(assignmentFields(to)) ?? NEW)
    setEntry({ lineNumber: '', lineName: '', stationName: '', uicStation: '' })
    setNumbers({})
  }

  const doneText = (d) => {
    const base = t(d.kind ? 'assign_done' : 'assign_done_none').replace('{{count}}', d.count)
    return d.kind
      ? base.replace('{{target}}', `${t(d.kind === 'line' ? 'track_group_line' : 'track_group_station')} ${d.title}`)
      : base
  }

  return (
    <>
      <p>{t('assign_hint')}</p>
      {tracks.length === 0 && <p className="form-error">{t('plan_no_tracks')}</p>}
      <GroupedTrackList t={t} tracks={tracks}
        isActive={(tr) => selected.has(tr.id)}
        onPick={(tr) => toggle(tr.id)}
        onPickGroup={toggleGroup} />
      <p className="selecting-hint">{t('assign_selected').replace('{{count}}', selected.size)}</p>

      <div className="element-form">
        <span className="create-element-section">{t('assign_target')}</span>
        <div className="form-field">
          <label>{t('assign_kind')}</label>
          <select value={kind} onChange={(e) => changeKind(e.target.value)}>
            <option value="line">{t('track_group_line')}</option>
            <option value="station">{t('track_group_station')}</option>
            <option value="none">{t('assign_kind_none')}</option>
          </select>
        </div>

        {kind !== 'none' && (
          <div className="form-field">
            <label>{t(kind === 'line' ? 'assign_line' : 'assign_station')}</label>
            <select value={chosen ? chosen.key : NEW} onChange={(e) => { setError(null); setChoice(e.target.value) }}>
              {existing.map(g => (
                <option key={g.key} value={g.key}>{`${groupTitle(g)} (${g.tracks.length})`}</option>
              ))}
              <option value={NEW}>{t(kind === 'line' ? 'assign_new_line' : 'assign_new_station')}</option>
            </select>
          </div>
        )}

        {kind === 'line' && !chosen && (
          <>
            <div className="form-field">
              <label>{t('line_number')}</label>
              <input type="number" value={entry.lineNumber} onChange={(e) => setField('lineNumber', e.target.value)} />
              {lineOptions.length > 0 && (
                <div className="line-suggestions">
                  {lineOptions.map(({ lineNumber: number, distance }) => (
                    <button
                      key={number}
                      type="button"
                      className={`line-suggestion${String(number) === String(entry.lineNumber) ? ' active' : ''}`}
                      onClick={() => setField('lineNumber', String(number))}
                    >
                      {number}
                      <span className="line-suggestion-distance">{distance} m</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="form-field">
              <label>{t('line_name')}</label>
              <input type="text" value={entry.lineName} onChange={(e) => setField('lineName', e.target.value)} />
            </div>
          </>
        )}

        {kind === 'station' && !chosen && (
          <>
            <div className="form-field">
              <label>{t('station_name')}</label>
              <StationNameInput
                value={entry.stationName}
                onChange={(e) => setField('stationName', e.target.value)}
                onSelectSuggestion={(s) => { setField('stationName', s.name); setField('uicStation', s.uic) }}
              />
            </div>
            <div className="form-field">
              <label>{t('uic_station_number')}</label>
              <input type="text" value={entry.uicStation} onChange={(e) => setField('uicStation', e.target.value)} />
            </div>
          </>
        )}
      </div>

      {kind !== 'none' && (
        <div className="element-form">
          <label className="transition-curve-row">
            <input type="checkbox" checked={rename} onChange={(e) => { setError(null); setRename(e.target.checked) }} />
            <span>{t('assign_rename')}</span>
          </label>
          {rename && (
            <p className="selecting-hint" style={{ margin: 0 }}>
              {t(kind === 'line' ? 'assign_rename_line_hint' : 'assign_rename_station_hint')}
            </p>
          )}
          {renaming && (
            <div className="rename-rows">
              {tracks.filter(tr => selected.has(tr.id)).map((tr) => {
                const next = plan?.names.get(tr.id)
                const clash = plan?.clashes.has(tr.id)
                const fallback = plan?.fallback.has(tr.id)
                return (
                  <div key={tr.id} className="rename-row">
                    {kind === 'station' && (
                      <input type="text" inputMode="numeric" className="rename-number" value={numberOf(tr)}
                        placeholder={t('track_number')} title={t('track_number')}
                        onChange={(e) => { setError(null); setNumbers(prev => ({ ...prev, [tr.id]: e.target.value })) }} />
                    )}
                    <span className="rename-old">{trackListLabel(tr)}</span>
                    <span className="rename-arrow" aria-hidden="true">→</span>
                    <span className={`rename-new${clash ? ' clash' : ''}${fallback ? ' fallback' : ''}`}
                      title={fallback ? t(kind === 'line' ? 'assign_rename_no_km' : 'assign_rename_no_number') : undefined}>
                      {next ?? '…'}
                    </span>
                  </div>
                )
              })}
              {plan?.fallback.size > 0 && (
                <span className="rename-note">
                  {t(kind === 'line' ? 'assign_rename_no_km' : 'assign_rename_no_number')}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {error && <p className="form-error">{t(error)}</p>}
      {done && !error && <p className="selecting-hint">{doneText(done)}</p>}

      <button className="panel-btn panel-btn-full" style={{ marginTop: 8 }}
        disabled={selected.size === 0 || kmPending} onClick={handleCommit}>
        {t('assign_commit')}
      </button>
      <button className="panel-btn panel-btn-full" style={{ marginTop: 2, background: '#888' }} onClick={onCommitted}>
        {t('btn_back')}
      </button>
    </>
  )
}
