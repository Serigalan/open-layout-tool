import { useState } from 'react'
import { commitSwitchConnection, loadSwitches, loadTracks, nextTrackName } from '../../../storage'
import { findTrackJoints, linkRecord, linkSymbol } from '../../../utils/trackLinkUtils'
import { utmToWgs84, crsName } from '../../../utils/coordinateUtils'

/** How many joints the list shows before it says how many more there are. */
const SHOWN = 12

/** Where a picked joint is put on the map. */
const JOINT_ZOOM = 17

/**
 * Link the track ends that belong together (see trackLinkUtils).
 *
 * The joints are found rather than clicked: a change of coordinate system cuts
 * every chain that crosses it, and the test database has 115 such points on one
 * import — picking them off the map one at a time is not a way to work. What
 * the scan found is listed before anything is written, with the distance
 * between the two statements of each node, so a pair that is not one is
 * visible; clicking a row puts it on the map.
 */
export default function TrackLinkForm({ t, map, project, onTrackSaved, onCommitted }) {
  const [crsOnly, setCrsOnly] = useState(false)
  const [created, setCreated] = useState(0)
  // Scanned once when the form opens, and again after a commit: the links just
  // written claim their ends, so what comes back is what is still open.
  const scan = () => findTrackJoints(loadTracks(project.id), loadSwitches(project.id))
  const [{ joints, fanned }, setScan] = useState(scan)

  const shown = crsOnly ? joints.filter(j => j.crsChange) : joints
  const crsCount = joints.filter(j => j.crsChange).length

  const fill = (key, values) =>
    Object.entries(values).reduce((msg, [k, v]) => msg.replace(`{{${k}}}`, v), t(key))

  const endLabel = (end) => `${end.trackName || end.trackId.slice(0, 8)} ${end.endpoint}`

  const showOnMap = (joint) => {
    const m = map?.current
    if (!m) return
    const [lng, lat] = utmToWgs84(joint.a.easting, joint.a.northing, joint.a.epsg)
    m.easeTo({ center: [lng, lat], zoom: Math.max(m.getZoom(), JOINT_ZOOM) })
  }

  const handleCreate = () => {
    if (!shown.length) return
    const tracks = loadTracks(project.id)
    const byId = Object.fromEntries(tracks.map(tr => [tr.id, tr]))
    const names = new Set(loadSwitches(project.id).map(sw => sw.name).filter(Boolean))
    const records = shown.map((joint) => {
      const name = nextTrackName('link', names)
      names.add(name)
      return linkSymbol(linkRecord(joint, name), byId)
    })
    // One commit, one undo step — a whole system boundary is dozens of nodes,
    // and saving them one at a time would leave as many steps behind.
    commitSwitchConnection(project.id, {
      removeTrackIds: [], addTracks: [], addSwitches: records, remap: [],
    })
    setCreated(records.length)
    setScan(scan())
    onTrackSaved?.()
  }

  return (
    <>
      <p className="selecting-hint">{t('switch_link_hint')}</p>

      {created > 0 && <p>{fill('switch_link_done', { n: created })}</p>}

      {joints.length === 0 ? (
        <p>{t('switch_link_none')}</p>
      ) : (
        <>
          <p>{fill('switch_link_found', { n: joints.length, crs: crsCount })}</p>
          <label className="transition-curve-row">
            <input type="checkbox" checked={crsOnly} onChange={e => setCrsOnly(e.target.checked)} />
            {t('switch_link_crs_only')}
          </label>
          <ul className="form-list">
            {shown.slice(0, SHOWN).map((joint, i) => (
              <li key={`${joint.a.trackId}|${joint.a.endpoint}|${i}`}>
                <button type="button" className="link-joint-btn" onClick={() => showOnMap(joint)}>
                  {endLabel(joint.a)} ↔ {endLabel(joint.b)}
                </button>
                {' · '}
                {fill('switch_link_gap', { mm: Math.round(joint.gap * 1000) })}
                {joint.crsChange && (
                  <span className="link-joint-crs"
                    title={`${crsName(joint.a.epsg) ?? joint.a.epsg} → ${crsName(joint.b.epsg) ?? joint.b.epsg}`}>
                    {' · '}{t('switch_link_crs')}
                  </span>
                )}
              </li>
            ))}
            {shown.length > SHOWN && <li>{fill('switch_link_more', { n: shown.length - SHOWN })}</li>}
          </ul>
          <button className="panel-btn panel-btn-full" disabled={shown.length === 0} onClick={handleCreate}>
            {fill('switch_link_create', { n: shown.length })}
          </button>
        </>
      )}

      {/* Outside the branch above: a scan that offers nothing because every
          meeting it found was a junction has to say so, and that is exactly the
          case where there are no joints to list. */}
      {fanned > 0 && <p className="selecting-hint">{fill('switch_link_fanned', { n: fanned })}</p>}

      <button className="panel-btn panel-btn-full" style={{ marginTop: 2, background: '#888' }} onClick={onCommitted}>
        {t('btn_cancel')}
      </button>
    </>
  )
}
