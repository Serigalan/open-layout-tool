import { useEffect, useState } from 'react'
import { loadTracks, replaceAllTracks } from '../../../storage'
import useTrackPick from '../../../hooks/useTrackPick'
import useNearbyLines from '../../../hooks/useNearbyLines'
import { assignTracks, assignmentFields, groupTitle, groupTracks, trackGroupKey } from '../../../utils/trackGroups'
import { FILTER_NONE, mapIsLive } from '../../../utils/mapConstants'
import GroupedTrackList from '../GroupedTrackList'
import StationNameInput from '../StationNameInput'

const SELECTED_LAYER = 'tracks-selected-layer'
const NEW = 'new'

const filterForTracks = (ids) => ['in', ['get', 'trackId'], ['literal', ids]]

/**
 * Put tracks on a line (Strecke) or into a station (Bahnhof), several at once:
 * the tracks are picked from the grouped list or on the map, the line or
 * station from those the project already has, or entered anew. Taking tracks
 * out of whatever they were in is the third choice.
 *
 * The form stays open after a commit — the list regroups at once, and the
 * next tracks are usually just picked for the next line or station.
 */
export default function AssignTracksForm({ t, map, project, onTrackSaved, onCommitted }) {
  const [selected, setSelected] = useState(() => new Set())
  const [kind, setKind]         = useState('line')
  const [choice, setChoice]     = useState(NEW)
  const [entry, setEntry]       = useState({ lineNumber: '', lineName: '', stationName: '', uicStation: '' })
  const [error, setError]       = useState(null)
  const [done, setDone]         = useState(null)
  const lineOptions = useNearbyLines(map)

  const tracks = loadTracks(project.id)
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

  const target = () => {
    if (kind === 'none') return { kind: null }
    if (chosen) return chosen
    return { kind, ...entry }
  }

  const handleCommit = () => {
    const ids = [...selected].filter(id => tracks.some(tr => tr.id === id))
    if (!ids.length) { setError('assign_error_no_tracks'); return }
    const to = target()
    if (to.kind === 'line' && !/^\d+$/.test(String(to.lineNumber ?? '').trim())) {
      setError('assign_error_line_number'); return
    }
    if (to.kind === 'station' && !String(to.stationName ?? '').trim() && !String(to.uicStation ?? '').trim()) {
      setError('assign_error_station_name'); return
    }
    replaceAllTracks(project.id, assignTracks(tracks, ids, to))
    onTrackSaved?.()
    setSelected(new Set())
    setError(null)
    setDone({ count: ids.length, kind: to.kind ?? null, title: to.kind ? groupTitle(to) : '' })
    // What was just entered is a line or station of the project now, so the
    // next tracks are put there by picking it rather than typing it again.
    setChoice(trackGroupKey(assignmentFields(to)) ?? NEW)
    setEntry({ lineNumber: '', lineName: '', stationName: '', uicStation: '' })
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

      {error && <p className="form-error">{t(error)}</p>}
      {done && !error && <p className="selecting-hint">{doneText(done)}</p>}

      <button className="panel-btn panel-btn-full" style={{ marginTop: 8 }}
        disabled={selected.size === 0} onClick={handleCommit}>
        {t('assign_commit')}
      </button>
      <button className="panel-btn panel-btn-full" style={{ marginTop: 2, background: '#888' }} onClick={onCommitted}>
        {t('btn_back')}
      </button>
    </>
  )
}
