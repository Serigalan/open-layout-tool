import { useMemo } from 'react'
import { loadTracks, loadSwitches, loadEndMarks, saveEndMark, deleteEndMark } from '../../storage'
import { classifyTrackEnds, isOpenState } from '../../utils/topology'
import { newBoundary, BOUNDARY } from '../../utils/trackEndMarks'
import { useI18n } from '../../locales/i18nContext'
import { useMap } from '../../map/MapContext'
import { useProject } from '../../hooks/useStore'

/** How far in a click on an entry takes the map, at least. */
const END_ZOOM = 17

/**
 * The open track ends of the project, under the topology switch (AP 9.4): how
 * many there are, each with a click that puts it on the map, and the one step
 * that settles an end which is open on purpose — marking it as the boundary of
 * the planning area (ROADMAP decision 81), where the line runs on but is not
 * drawn. The boundaries set so far are listed below it and can be lifted
 * again.
 *
 * `project` is the store's live record, so the lists follow every edit and
 * every undo.
 */
export default function TopologyEndsList() {
  const { t, fill } = useI18n()
  const map = useMap()
  const project = useProject()
  const { open, boundaries } = useMemo(() => {
    if (!project) return { open: [], boundaries: [] }
    const ends = classifyTrackEnds(loadTracks(), loadSwitches(), loadEndMarks())
    return {
      open: ends.filter(e => isOpenState(e.state)),
      boundaries: ends.filter(e => e.state === BOUNDARY),
    }
    // `project` is the store's live record: it changes with every write.
  }, [project])

  if (!project) return null

  const label = (end) => `${end.trackName || end.trackId.slice(0, 8)} · ${t(end.endpoint === 'BEGIN' ? 'end_begin' : 'end_end')}`

  const show = (end) => {
    const m = map?.current
    if (!m) return
    m.easeTo({ center: end.lngLat, zoom: Math.max(m.getZoom(), END_ZOOM) })
  }

  const markBoundary = (end) => {
    saveEndMark(newBoundary(end.trackId, end.endpoint))
  }

  const liftBoundary = (end) => {
    if (!end.markId) return
    deleteEndMark(end.markId)
  }

  return (
    <div className="topology-ends">
      <p className={open.length ? 'topology-ends-count topology-ends-open' : 'topology-ends-count'}>
        {open.length ? fill('topology_open_ends', { n: open.length }) : t('topology_no_open_ends')}
      </p>
      {open.length > 0 && (
        // Every one of them: the list is there to be worked through, and a cap
        // would hide exactly the ends still to be looked at.
        <ul className="form-list topology-ends-list">
          {open.map(end => (
            <li key={`${end.trackId}|${end.endpoint}`}>
              <button type="button" className="link-joint-btn" onClick={() => show(end)}>{label(end)}</button>
              {' '}
              <button type="button" className="topology-ends-action" onClick={() => markBoundary(end)}
                title={t('topology_mark_boundary_hint')}>
                {t('topology_mark_boundary')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {boundaries.length > 0 && (
        <>
          <p className="topology-ends-count">{fill('topology_boundaries', { n: boundaries.length })}</p>
          <ul className="form-list topology-ends-list">
            {boundaries.map(end => (
              <li key={`${end.trackId}|${end.endpoint}`}>
                <button type="button" className="link-joint-btn" onClick={() => show(end)}>{label(end)}</button>
                {' '}
                <button type="button" className="topology-ends-action" onClick={() => liftBoundary(end)}>
                  {t('topology_lift_boundary')}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
