import { useRef, useState } from 'react'
import { GIVEN_MODES, pointGrades, solveHeightPoint, tangentLength } from '../utils/heightUtils'
import { useI18n } from '../locales/i18nContext'
import NumberInput from './form/NumberInput'

/**
 * Which values of point `i` the table lets one type, each with the value that
 * stays while it changes: the two of `mode` — at an end without the gradient
 * a mode names, the station or the height in its place; on a joint (a track
 * end other tracks meet) the station stays whatever is typed. Nothing on a
 * point a turnout's main route sets.
 */
function editableAt(i, n, mode, { joint, locked }) {
  if (locked) return new Map()
  const available = ['s', 'z', i > 0 && 'gb', i < n - 1 && 'ga'].filter(Boolean)
  if (joint) return new Map(available.filter(k => k !== 's').map(k => [k, 's']))
  const pair = [...GIVEN_MODES[mode]]
  for (let k = 0; k < 2; k++) {
    if (!available.includes(pair[k])) pair[k] = pair.includes('s') ? 'z' : 's'
  }
  return new Map([[pair[0], pair[1]], [pair[1], pair[0]]])
}

/**
 * One value of the table: as text where it follows from the others, as a
 * field where it is given — typed, it is applied on Enter or on leaving the
 * field, Escape drops it.
 */
function ValueCell({ value, digits, step, editable, onCommit, className, title }) {
  const { num } = useI18n()
  const [draft, setDraft] = useState(null)
  const done = useRef(false)
  const shown = value == null ? '' : value.toFixed(digits)
  if (!editable) {
    return <td className={className} title={title}>{value == null ? '–' : num(value, { digits })}</td>
  }
  const commit = () => {
    if (done.current) { done.current = false; return }
    if (draft != null && draft.trim() !== '' && Number.isFinite(Number(draft)) && Number(draft) !== Number(shown)) onCommit(Number(draft))
    setDraft(null)
  }
  return (
    <td className={className} title={title}>
      <NumberInput className="track-table-input" step={step} value={draft ?? shown}
        onChange={e => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') { commit(); done.current = true; e.currentTarget.blur() }
          if (e.key === 'Escape') { e.preventDefault(); setDraft(null); done.current = true; e.currentTarget.blur() }
        }} />
    </td>
  )
}

/**
 * The gradient of one track or route as a table (the Höhenplan's second view): every
 * point with its station, height, the gradients before and after it in ‰,
 * the radius of its vertical curve and the tangent length that gives. Two of
 * station, height and the two gradients are given (`mode`, GIVEN_MODES) and
 * can be typed; the other two follow, the points either side stay. A
 * gradient a rule flags and a curve with a finding are coloured as in the
 * graphic view. A row clicked is the selection the graphic view shows.
 *
 * `points` are the profile's (routeProfile): solved along the route, a point
 * is written back by `onWrite(point, { station, z }, rv)` to the track it
 * belongs to. A point at the end of its track — where tracks meet, also
 * between two tracks of a route — keeps its station.
 */
export default function ElevationTable({
  points, length, mode, locked, noteAt,
  stretchAt, curveAt, stretchNote, curveNote, selection, onSelect, onWrite,
}) {
  const { t, fill } = useI18n()
  const [error, setError] = useState(null)       // { index, code } of the last value that could not be taken
  const n = points.length

  const apply = (i, key, value, partner) => {
    const p = points[i]
    const g = pointGrades(points, i)
    const now = { s: p.station, z: p.z, gb: g.before, ga: g.after }
    const r = solveHeightPoint(points, i, { [key]: value, [partner]: now[partner] }, { length })
    if (r.error) { setError({ index: i, code: r.error }); return }
    setError(null)
    onWrite(p, r)
  }
  const applyRadius = (i, rv) => {
    setError(null)
    onWrite(points[i], { station: points[i].station, z: points[i].z }, rv > 0 ? rv : null)
  }

  const sev = (entry) => (entry?.severity && entry.severity !== 'ok' ? `rule-sev-${entry.severity}` : undefined)

  return (
    <div className="track-table-scroll profile-table">
      {error && (
        <p className="form-error profile-table-error">
          {fill(`elevation_table_error_${error.code}`, { n: error.index + 1 })}
        </p>
      )}
      <table className="track-table">
        <thead>
          <tr>
            <th>#</th>
            <th>{t('elevation_station')} [m]</th>
            <th>{t('elevation_height')} [m]</th>
            <th>{t('elevation_grade_before')} [‰]</th>
            <th>{t('elevation_grade_after')} [‰]</th>
            <th title={t('elevation_vcurve_hint')}>{t('elevation_vcurve')} [m]</th>
            <th>T [m]</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p, i) => {
            const isLocked = locked.has(i)
            const joint = points[i].trackEnd != null || points[i].joint
            const edit = editableAt(i, n, mode, { joint, locked: isLocked })
            const g = pointGrades(points, i)
            const cell = (key) => ({
              editable: edit.has(key),
              onCommit: (v) => apply(i, key, key === 'gb' || key === 'ga' ? v / 1000 : v, edit.get(key)),
            })
            const before = stretchAt.get(i), after = stretchAt.get(i + 1), curve = curveAt.get(i)
            const tl = tangentLength(points, i)
            return (
              <tr key={i} className={selection.includes(i) ? 'track-table-row-active' : undefined}
                title={noteAt(i) ?? (joint ? t('elevation_table_joint') : undefined)}
                onClick={() => onSelect([i])}>
                <td>{i + 1}</td>
                <ValueCell value={p.station} digits={3} step={0.1} {...cell('s')} />
                <ValueCell value={p.z} digits={4} step={0.001} {...cell('z')} />
                <ValueCell value={g.before == null ? null : g.before * 1000} digits={2} step={0.1} {...cell('gb')}
                  className={sev(before)} title={before ? stretchNote(before) : undefined} />
                <ValueCell value={g.after == null ? null : g.after * 1000} digits={2} step={0.1} {...cell('ga')}
                  className={sev(after)} title={after ? stretchNote(after) : undefined} />
                <ValueCell value={p.rv ?? null} digits={0} step={100}
                  editable={!isLocked && i > 0 && i < n - 1} onCommit={(v) => applyRadius(i, v)}
                  className={sev(curve)} title={curve ? curveNote(curve) : undefined} />
                <td>{tl == null ? '–' : tl.toFixed(2)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
