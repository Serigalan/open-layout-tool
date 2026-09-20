import { useState } from 'react'
import { commitSwitchConnection, loadSwitches, loadTracks } from '../../../storage'
import { existingLinks, findTrackJoints, linksForJoints } from '../../../utils/trackLinkUtils'
import { utmToWgs84, crsName } from '../../../utils/coordinateUtils'

/** Where a picked joint is put on the map. */
const JOINT_ZOOM = 17

/**
 * The links of a project, and the joints that could still become one (see
 * trackLinkUtils).
 *
 * Both lists say the same thing about each entry: which two track ends it joins
 * and **how far apart they are**. That distance is the whole reason to look: a
 * link is the one object whose two ends are allowed to disagree about where
 * they are — they were surveyed in different systems — and how far they
 * disagree is what says whether the two chains really belong together. Clicking
 * a row puts it on the map.
 *
 * The joints are found rather than clicked: a change of coordinate system cuts
 * every chain that crosses it, and one import of the test database brings 78 of
 * them. The MDB import therefore writes them itself (DataExchangePanel); what
 * is left open here is what it could not decide.
 */
export default function TrackLinkForm({ t, map, project, onTrackSaved, onCommitted }) {
  const [crsOnly, setCrsOnly] = useState(false)
  const [created, setCreated] = useState(0)
  // Read once when the form opens, and again after a commit: the links just
  // written claim their ends, so they move from the open list to the other one.
  const read = () => {
    const tracks = loadTracks(project.id)
    const switches = loadSwitches(project.id)
    return { ...findTrackJoints(tracks, switches), links: existingLinks(switches, tracks) }
  }
  const [{ joints, fanned, links }, setState] = useState(read)

  const open = crsOnly ? joints.filter(j => j.crsChange) : joints

  const fill = (key, values) =>
    Object.entries(values).reduce((msg, [k, v]) => msg.replace(`{{${k}}}`, v), t(key))

  const endLabel = (end) => (end
    ? `${end.trackName || end.trackId.slice(0, 8)} ${end.endpoint}`
    : t('switch_link_end_gone'))

  const showOnMap = (end) => {
    const m = map?.current
    if (!m || !end) return
    const [lng, lat] = utmToWgs84(end.easting, end.northing, end.epsg)
    m.easeTo({ center: [lng, lat], zoom: Math.max(m.getZoom(), JOINT_ZOOM) })
  }

  /** One entry of either list: the two ends, the distance, the plane change. */
  const Row = ({ entry, name }) => (
    <li>
      <button type="button" className="link-joint-btn"
        onClick={() => showOnMap(entry.a ?? entry.b)}>
        {name ? `${name}: ` : ''}{endLabel(entry.a)} ↔ {endLabel(entry.b)}
      </button>
      {' · '}
      {entry.gap == null
        ? t('switch_link_gap_unknown')
        : fill('switch_link_gap', { mm: Math.round(entry.gap * 1000) })}
      {entry.crsChange && (
        <span className="link-joint-crs"
          title={`${crsName(entry.a.epsg) ?? entry.a.epsg} → ${crsName(entry.b.epsg) ?? entry.b.epsg}`}>
          {' · '}{t('switch_link_crs')}
        </span>
      )}
    </li>
  )

  const handleCreate = () => {
    if (!open.length) return
    const tracks = loadTracks(project.id)
    const records = linksForJoints(open,
      Object.fromEntries(tracks.map(tr => [tr.id, tr])),
      loadSwitches(project.id).map(sw => sw.name).filter(Boolean))
    // One commit, one undo step — a whole system boundary is dozens of nodes,
    // and saving them one at a time would leave as many steps behind.
    commitSwitchConnection(project.id, {
      removeTrackIds: [], addTracks: [], addSwitches: records, remap: [],
    })
    setCreated(records.length)
    setState(read())
    onTrackSaved?.()
  }

  return (
    <>
      <p className="selecting-hint">{t('switch_link_hint')}</p>

      {created > 0 && <p>{fill('switch_link_done', { n: created })}</p>}

      {links.length > 0 && (
        <>
          <p>{fill('switch_link_existing', {
            n: links.length, crs: links.filter(l => l.crsChange).length,
          })}</p>
          {/* Every one of them, widest gap first — the list is here to be
              checked, and a cap would hide exactly what is worth seeing. */}
          <ul className="form-list">
            {links.map(link => (
              <Row key={link.sw.switchId} entry={link} name={link.sw.name} />
            ))}
          </ul>
        </>
      )}

      {joints.length === 0 ? (
        <p>{t('switch_link_none')}</p>
      ) : (
        <>
          <p>{fill('switch_link_found', {
            n: joints.length, crs: joints.filter(j => j.crsChange).length,
          })}</p>
          <label className="transition-curve-row">
            <input type="checkbox" checked={crsOnly} onChange={e => setCrsOnly(e.target.checked)} />
            {t('switch_link_crs_only')}
          </label>
          <ul className="form-list">
            {open.map((joint, i) => (
              <Row key={`${joint.a.trackId}|${joint.a.endpoint}|${i}`} entry={joint} />
            ))}
          </ul>
          <button className="panel-btn panel-btn-full" disabled={open.length === 0} onClick={handleCreate}>
            {fill('switch_link_create', { n: open.length })}
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
