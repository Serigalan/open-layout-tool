import {
  endPointStraightUtm, endPointCurvedUtm,
  computeStraightValuesUtm, computeCurvedValuesUtm, arcCoordsFromRadiusUtm,
  reverseElement,
} from './elementUtils'
import {
  SWITCH_CONNECTION_STAGES, switchBranchSections, switchStraightLength,
  CROSSING_TYPES, crossingAngle, crossingEndDistance, crossingLegRadius, computeCrossingGeometryUtm,
  lcsLine, switchFillRing,
  switchLabelGeometry, bauform,
} from './switchUtils'
import { newSwitchFields, switchElementMark, LINK_KIND } from './switchModel'
import { kindForOsrdType } from './alignmentCodec'
import { computeClothoidUtm } from './clothoidUtils'
import { utmToWgs84 } from './coordinateUtils'
import { SAGITTA_ELEMENT } from './mapConstants'
import { TYPE_CODES, SIDE_CODES } from './identifierUtils'

const GON2DEG = 9 / 10

// Closing checks against the values the alignment states for itself.
const LENGTH_TOL   = 0.001   // 1 mm over the whole alignment
const POSITION_TOL = 0.001   // 1 mm between the walked end and the stated one
const BEARING_TOL  = 1e-4    // degrees

// ── Switches ────────────────────────────────────────────────────────────────
// In RailJSON a switch is a node: its ports say which track ends meet there,
// not what the turnout looks like. The app instead draws a switch body — the
// filled area between the branch arc and the tangent straight, plus the LCS
// mark — so that body is rebuilt here from the branch, which is what port B1
// names. Its arc carries everything needed: the node, the tangent direction,
// the radius and the arc length; the straight side ends at the same station,
// at 2·R·tan(L/2R). A point switch without an arc at B1 (a foreign file, where
// all three ports sit on the same spot) is left to the passthrough.

const ARC_TOL = 0.01   // 1 cm of arc length when identifying the switch type

/**
 * Switch form matching a branch of radius `absR` whose arc is `arcLen` long and
 * which ends in a straight piece of `endLen` (0 where it has none).
 *
 * A form that ends in a straight piece is only matched when that piece is there
 * too, and one that does not only when it is not: the end piece is as much a
 * part of the form as the arc, and a 190 – 1:9 recognised as a bare arc would
 * be drawn 6 m too short.
 */
function matchSwitchType(absR, arcLen, endLen = 0) {
  let best = null
  let bestErr = Infinity
  for (const type of SWITCH_CONNECTION_STAGES.flat()) {
    if (Math.abs(type.R - absR) > 1e-6) continue
    const sections = switchBranchSections(type)
    const arcs = sections.filter(section => section.R != null)
    if (arcs.length !== 1) continue
    const ends = sections.filter(section => section.R == null)
      .reduce((sum, section) => sum + section.length, 0)
    const err = Math.abs(arcs[0].length - arcLen) + Math.abs(ends - endLen)
    if (err < bestErr) { best = type; bestErr = err }
  }
  return bestErr <= ARC_TOL ? best : null
}

/** Index of the element sitting at `endpoint` of a track. */
const portElementIndex = (els, endpoint) => (endpoint === 'END' ? els.length - 1 : 0)

/**
 * Rebuild one crossing-kind record from an OSRD switch. The four ports name
 * the four legs, in the OSRD node types' own terms: A1/A2 on one side and
 * B1/B2 on the other — the app's A and C are the main route's ends (OSRD's
 * line 1, A1–B1), its B and D the cross route's (line 2, A2–B2). The legs are
 * the tracks' own elements, so the crossing point and both bearings are read
 * off them, and the form is matched by the angle between the legs, their
 * length and — for a Bogenkreuzungsweiche — the radius they run on.
 * Returns null when the legs or the form do not resolve.
 */
function rebuildCrossing(sw, trackById) {
  const ports = sw?.ports ?? {}
  const kind  = kindForOsrdType(sw.switch_type)
  const P     = { A: 'A1', B: 'A2', C: 'B1', D: 'B2' }
  const legAt = (port) => {
    const at    = ports[P[port]]
    const track = trackById[at?.track]
    const els   = track?.elements ?? []
    if (!els.length) return null
    const idx = portElementIndex(els, at.endpoint)
    const el  = els[idx]
    if (!el || el.length <= 0 || !el.startNode || !el.endNode) return null
    // Oriented away from the crossing point, whichever end it sits at.
    const oriented = at.endpoint === 'END' ? reverseElement(el) : el
    return { track, el: oriented }
  }
  const a = legAt('A'), b = legAt('B'), c = legAt('C'), d = legAt('D')
  if (!a || !b || !c || !d) return null

  // The crossing point: where the A and B legs begin (their start nodes).
  const centre = a.el.startNode
  if (Math.hypot(b.el.startNode[0] - centre[0], b.el.startNode[1] - centre[1]) > 0.001) return null
  const epsg = a.track.epsg
  const centreUtm = { easting: centre[0], northing: centre[1], zone: epsg }

  // The crossing angle between the legs, signed the way the geometry wants it:
  // positive where the cross route (B→D) turns right off the main one (A→C).
  const bearingDelta = (from, to) => ((to - from + 540) % 360) - 180
  const crossAngle = bearingDelta(c.el.bearing, d.el.bearing)
  // Between the two legs that leave the point forwards — A and C run away from
  // it in opposite directions, and measured between those every crossing read
  // as 180° and matched no form.
  const absAngle = Math.abs(crossAngle)
  // The form: the crossing angle as a slope, the leg's length, and the radius
  // a curved leg runs on.
  const legLen = a.el.length
  const legR = Math.abs(a.el.radius ?? 0) || null
  const type = matchCrossingType(absAngle, legLen, legR, kind)
  if (!type) return null

  const g = computeCrossingGeometryUtm(centreUtm, c.el.bearing, type, crossAngle)
  const name = sw.extensions?.sncf?.label ?? sw.id
  const identity = { ...newSwitchFields(kind), name, label: type.label }
  const mark = (port) => {
    const at    = ports[P[port]]
    const track = trackById[at.track]
    const idx = portElementIndex(track.elements, at.endpoint)
    Object.assign(track.elements[idx], switchElementMark(identity,
      port === 'A' || port === 'C' ? 'main' : 'cross'))
  }
  ;['A', 'B', 'C', 'D'].forEach(mark)

  return {
    ...identity,
    portA_trackId: ports.A1.track,  portA_endpoint: ports.A1.endpoint,
    portB_trackId: ports.A2.track,  portB_endpoint: ports.A2.endpoint,
    portC_trackId: ports.B1.track,  portC_endpoint: ports.B1.endpoint,
    portD_trackId: ports.B2.track,  portD_endpoint: ports.B2.endpoint,
    fillCoords: g.fillCoords,
  }
}

/**
 * The crossing form whose angle and legs the imported ones state. The angle is
 * matched through the slope it implies (1:9, 1:7.5) and the leg length through
 * the end distance it builds. A leg that runs on a radius belongs to a
 * Bogenkreuzungsweiche and to nothing else, so it has to name that form's
 * radius — which is also what keeps an EBKW from passing for the EKW 500
 * whose legs are 3 cm longer.
 */
function matchCrossingType(absAngleDeg, legLen, legR, kind) {
  let best = null
  let bestErr = Infinity
  for (const type of CROSSING_TYPES) {
    if (type.kind !== kind) continue
    const formLegR = crossingLegRadius(type)
    if ((formLegR == null) !== (legR == null)) continue
    const angle = crossingAngle(type) * 180 / Math.PI
    const err = Math.abs(angle - absAngleDeg)
      + Math.abs(crossingEndDistance(type) - legLen)
      + (formLegR == null ? 0 : Math.abs(formLegR - legR))
    if (err < bestErr) { best = type; bestErr = err }
  }
  return bestErr <= 0.05 ? best : null
}

/**
 * Rebuild a link — two track ends and the node between them. There is no form
 * to match and no element to mark: the record is its two ports, and the symbol
 * is derived from the tracks on load like every other switch's
 * (switchUtils.rebuildSwitchSymbol). Returns null unless both ports name a
 * track the file actually brought.
 */
function rebuildLink(sw, trackById) {
  const { A, B } = sw?.ports ?? {}
  if (!trackById[A?.track] || !trackById[B?.track]) return null
  if (!A.endpoint || !B.endpoint) return null
  return {
    ...newSwitchFields(LINK_KIND),
    name: sw.extensions?.sncf?.label ?? sw.id,
    portA_trackId: A.track, portA_endpoint: A.endpoint,
    portB_trackId: B.track, portB_endpoint: B.endpoint,
  }
}

/**
 * Rebuild one app switch record from an OSRD switch, and mark the elements that
 * make up its body so they render as switch geometry rather than as ordinary
 * track. The parsed elements are this module's own fresh objects, so they are
 * marked in place. Returns null when the switch has no body to draw.
 */
function rebuildSwitch(sw, trackById) {
  const ports = sw?.ports ?? {}
  if (typeof sw?.id !== 'string') return null
  // A link is read before the B1 test below: it has no B1, because it has no
  // branch — its two ports are A and B.
  if (kindForOsrdType(sw.switch_type) === LINK_KIND) return rebuildLink(sw, trackById)
  if (!ports.B1?.track) return null
  // The crossing kinds have four ports and a geometry of their own — they are
  // rebuilt as the crossing they are (rebuildCrossing below) rather than as a
  // turnout wearing their name.
  if (sw.switch_type && kindForOsrdType(sw.switch_type) !== 'turnout') {
    return rebuildCrossing(sw, trackById)
  }

  const branchTrack = trackById[ports.B1.track]
  const branchEls   = branchTrack?.elements ?? []
  if (!branchEls.length) return null

  const branchIdx = portElementIndex(branchEls, ports.B1.endpoint)
  const stored    = branchEls[branchIdx]
  // Oriented away from the node, whichever end of the track the switch is at.
  const arcEl = ports.B1.endpoint === 'END' ? reverseElement(stored) : stored
  const arc   = arcEl.geometry?.coordinates ?? []
  if (!arcEl.radius || arc.length < 2 || !(arcEl.length > 0)) return null

  const absR   = Math.abs(arcEl.radius)
  const arcLen = arcEl.length
  const epsg   = branchTrack.epsg

  // The branch may be more than the arc: a form that ends in a straight piece
  // was written as two elements, the straight one following the arc away from
  // the node. It counts as part of the branch only where it makes a form whole.
  const step      = ports.B1.endpoint === 'END' ? -1 : 1
  const endStored = branchEls[branchIdx + step]
  const endCand   = endStored && endStored.radius == null && endStored.length > 0
    ? (step < 0 ? reverseElement(endStored) : endStored)
    : null
  const typeWithEnd = endCand ? matchSwitchType(absR, arcLen, endCand.length) : null
  const type        = typeWithEnd ?? matchSwitchType(absR, arcLen, 0)
  const endEl       = typeWithEnd ? endCand : null
  const branchCoords = endEl
    ? [...arc, ...(endEl.geometry?.coordinates ?? []).slice(1)]
    : arc
  const branchEndNode = endEl ? endEl.endNode : arcEl.endNode
  const branchChain = [
    { length: arcLen, radius: arcEl.radius ?? null },
    ...(endEl ? [{ length: endEl.length, radius: null }] : []),
  ]

  // The through route runs the form's whole building length, end piece included.
  const straightLen = type ? switchStraightLength(type) : 2 * absR * Math.tan(arcLen / (2 * absR))
  const nodeUtm     = { easting: arcEl.startNode[0], northing: arcEl.startNode[1], zone: epsg }
  const straightUtm = endPointStraightUtm(nodeUtm, arcEl.bearing, straightLen)
  const straightEnd = utmToWgs84(straightUtm.easting, straightUtm.northing, epsg)
  const node        = arc[0]

  const name     = sw.extensions?.sncf?.label ?? sw.id
  const label    = type?.label
  // The imported record and the elements it marks share one identity from the
  // start, so an import needs no name-matching pass to be linked up.
  const identity = { ...newSwitchFields(), name, ...(label ? { label } : {}) }
  const mark     = (el, route) => Object.assign(el, switchElementMark(identity, route))
  mark(stored, 'branch')
  if (endEl) mark(endStored, 'branch')

  // The straight side is its own track when the switch was built onto a track
  // end: one straight element of exactly that length. Then it belongs to the
  // switch too — that is the element the map labels with the switch type.
  const straightTrack = trackById[ports.B2?.track]
  const straightEls   = straightTrack?.elements ?? []
  if (straightEls.length === 1 && straightEls[0].radius == null
      && Math.abs((straightEls[0].length ?? 0) - straightLen) < 0.001) {
    mark(straightEls[0], 'main')
  }

  // The mark is measured off the two switch ends, so it follows the form's own
  // dimensions — with an end piece both ends move, and the mark moves with them.
  const lcsCoords = type
    ? lcsLine([nodeUtm.easting, nodeUtm.northing], branchEndNode,
      [straightUtm.easting, straightUtm.northing], type.dLcs, epsg)
    : null

  return {
    ...identity,
    ...(arcEl.speed ? { speed: arcEl.speed } : {}),
    portA_trackId:  ports.A?.track     ?? null, portA_endpoint:  ports.A?.endpoint  ?? null,
    portB1_trackId: ports.B1.track,             portB1_endpoint: ports.B1.endpoint,
    portB2_trackId: ports.B2?.track    ?? null, portB2_endpoint: ports.B2?.endpoint ?? null,
    fillCoords: switchFillRing([node, straightEnd], branchCoords),
    ...switchLabelGeometry(nodeUtm, arcEl.bearing,
      { length: straightLen, radius: null }, branchChain, epsg),
    bauform: bauform(null, arcEl.radius ?? null),
    ...(lcsCoords ? { lcsCoords } : {}),
  }
}

/**
 * Rebuild tracks from a file written by either exporter — the alignment
 * exchange format (exchangeExport) or OSRD's RailJSON (osrdExport).
 *
 * The geometry is taken exclusively from the alignment block: it carries the
 * design scalars (native CRS anchor, gon bearings, signed radii and cants)
 * that a polyline cannot express — `geo` is only a flattened picture of it.
 * The exchange format states it as `horizontal_alignment`, RailJSON under
 * `extensions.db.alignment`; both are read. A track section without either is
 * reported instead of guessed at.
 *
 * Elements are chained forward from the anchor, each starting where the
 * previous one ended, so the result is exact rather than re-fitted. The stated
 * length, end position and end bearing are verified against the walk and
 * reported in `errors` when they disagree.
 *
 * The vertical alignment — the track's height points with their vertical curve
 * radii — is the track's own list, stationed along it and independent of the
 * elements, so it is taken as stated. A file without one leaves the track to
 * the terrain fill.
 *
 * Everything the app does not model itself is carried through untouched so an
 * export can hand it back: infra-level objects (signals, routes, detectors, …)
 * come back as `infra`, per-track leftovers (loading gauge, foreign extensions)
 * as `track.osrd`. Only what the export regenerates is dropped there — id,
 * geo, length, the alignments, curves/slopes, and the sncf/olt extensions —
 * so nothing is stored twice.
 *
 * Returns { tracks, errors, infra, switches } with tracks in the app's element
 * shape (display geometry included, absLength left to recalcAbsLengths) and
 * switches as app records, rebuilt so they are drawn as switch bodies again
 * (see rebuildSwitch).
 */
export function parseOsrdRailJson(data) {
  const sections = Array.isArray(data?.track_sections) ? data.track_sections : []
  const tracks = []
  const errors = []
  // Infra-level passthrough: everything except the track sections, which are
  // rebuilt from the tracks themselves.
  const { track_sections: _sections, ...infra } = data ?? {}
  if (!sections.length) {
    errors.push('Keine track_sections in der Datei gefunden.')
    return { tracks, errors, infra }
  }

  sections.forEach((section, si) => {
    const label = section.id ?? `#${si + 1}`
    const legacy = section.extensions?.db?.alignment
    const alignment = section.horizontal_alignment ?? legacy
    if (!alignment) {
      errors.push(`${label}: keine horizontal_alignment – ohne sie ist die Geometrie nicht exakt rekonstruierbar.`)
      return
    }
    const ref = alignment.horizontal_reference ?? {}
    const epsg = Number(ref.epsg)
    if (!epsg) {
      errors.push(`${label}: horizontal_reference.epsg fehlt.`)
      return
    }
    const items = Array.isArray(alignment.horizontal_elements) ? alignment.horizontal_elements : []
    if (!items.length) {
      errors.push(`${label}: horizontal_elements ist leer.`)
      return
    }

    // The earlier format named the anchor easting_m / northing_m.
    let cursor  = { easting: Number(ref.start_easting ?? ref.easting_m), northing: Number(ref.start_northing ?? ref.northing_m), zone: epsg }
    let bearing = (Number(ref.bearing_start_gon) || 0) * GON2DEG
    if (!Number.isFinite(cursor.easting) || !Number.isFinite(cursor.northing)) {
      errors.push(`${label}: horizontal_reference ohne Startkoordinate.`)
      return
    }
    const elements = []

    for (const item of items) {
      const length = Number(item.length_m)
      if (!(length > 0)) continue          // degenerate entries carry no geometry
      const speed = Number(item.design_speed_kmh) || 0
      const wgs = (p) => utmToWgs84(p.easting, p.northing, epsg)

      if (item.type === 'curve') {
        const radius = Number(item.radius_m)
        const end = endPointCurvedUtm(cursor, bearing, length, radius)
        const cv  = computeCurvedValuesUtm(cursor, end, radius)
        elements.push({
          elementType: 1,
          startNode: cv.startNode, endNode: cv.endNode,
          bearing: cv.bearing, endBearing: cv.endBearing,
          length: cv.length, absLength: cv.length, speed,
          radius, cant: Number(item.cant_start_mm) || 0,
          geometry: { type: 'LineString', coordinates:
            arcCoordsFromRadiusUtm(cursor, end, radius, SAGITTA_ELEMENT) ?? [wgs(cursor), wgs(end)] },
        })
        cursor = end
        bearing = cv.endBearing

      } else if (item.type === 'clothoid' || item.type === 'bloss') {
        // null radius = the transition runs into a straight on that side
        const r1 = item.radius_start_m == null ? null : Number(item.radius_start_m)
        const r2 = item.radius_end_m   == null ? null : Number(item.radius_end_m)
        const cl = computeClothoidUtm(cursor, bearing, length, r1, r2, SAGITTA_ELEMENT, item.type)
        elements.push({
          elementType: 2, transitionType: item.type, r1, r2,
          startNode: [cursor.easting, cursor.northing],
          endNode: [cl.endUtm.easting, cl.endUtm.northing],
          bearing, endBearing: cl.endBearing,
          length, absLength: length, speed,
          geometry: { type: 'LineString', coordinates: cl.coords },
        })
        cursor = cl.endUtm
        bearing = cl.endBearing

      } else {
        const end = endPointStraightUtm(cursor, bearing, length)
        const sv  = computeStraightValuesUtm(cursor, end)
        // A kink at the straight's end: the alignment leaves in a different
        // direction than the straight runs, by the stated deflection angle.
        const kink = Number(item.kink_gon) * GON2DEG || 0
        const kinked = kink ? (((sv.bearing + kink) % 360) + 360) % 360 : null
        elements.push({
          elementType: 0,
          startNode: sv.startNode, endNode: sv.endNode,
          bearing: sv.bearing, length: sv.length, absLength: sv.length, speed,
          ...(kinked != null ? { endBearing: kinked } : {}),
          ...(Number(item.cant_start_mm) ? { cant: Number(item.cant_start_mm) } : {}),
          geometry: { type: 'LineString', coordinates: [wgs(cursor), wgs(end)] },
        })
        cursor = end
        bearing = kinked ?? sv.bearing
      }
    }

    if (!elements.length) {
      errors.push(`${label}: keine verwertbaren Elemente.`)
      return
    }

    // Closing checks against the alignment's own statements
    const walked = elements.reduce((s, el) => s + el.length, 0)
    const stated = Number(legacy?.length_m ?? section.length)
    if (Number.isFinite(stated) && Math.abs(walked - stated) > LENGTH_TOL) {
      errors.push(`${label}: Länge weicht ab – gerechnet ${walked.toFixed(4)} m, angegeben ${stated.toFixed(4)} m.`)
    }
    if (ref.end_easting != null && ref.end_northing != null) {
      const off = Math.hypot(cursor.easting - Number(ref.end_easting), cursor.northing - Number(ref.end_northing))
      if (off > POSITION_TOL) {
        errors.push(`${label}: Endpunkt weicht ab – gerechnet liegt er ${off.toFixed(4)} m neben dem angegebenen.`)
      }
    }
    if (ref.bearing_end_gon != null) {
      const statedEnd = Number(ref.bearing_end_gon) * GON2DEG
      const diff = Math.abs((((bearing - statedEnd) + 540) % 360) - 180)
      if (diff > BEARING_TOL) {
        errors.push(`${label}: Endrichtung weicht ab – gerechnet ${(bearing / GON2DEG).toFixed(4)} gon, `
          + `angegeben ${Number(ref.bearing_end_gon).toFixed(4)} gon.`)
      }
    }

    // The vertical alignment is the track's own list, stationed along it — it
    // is taken as it is, with no element to fit it to.
    const vertical = section.vertical_alignment ?? {}
    const heights = (Array.isArray(vertical.vertical_points) ? vertical.vertical_points : [])
      .map(p => ({
        station: Number(p.station_point_m),
        z: Number(p.elevation),
        ...(p.vertical_curve_radius_m == null ? {} : { rv: Number(p.vertical_curve_radius_m) }),
      }))
      .filter(p => Number.isFinite(p.station) && Number.isFinite(p.z))
      .sort((a, b) => a.station - b.station)
    const heightEpsg = Number(vertical.vertical_reference?.epsg) || undefined

    // Per-track passthrough: keep what the export does not regenerate. The
    // sncf fields the app writes itself and an empty loading gauge are
    // regenerated too, so they are not kept twice.
    const {
      id: _id, geo: _geo, length: _len, curves: _curves, slopes: _slopes,
      horizontal_alignment: _h, vertical_alignment: _v, loading_gauge_limits,
      extensions: sectionExt, ...sectionRest
    } = section
    const { db: _db, olt = {}, sncf = {}, source, ...extRest } = sectionExt ?? {}
    const { line_code: _lc, line_name: _ln, track_name: _tn, track_number: _tnr, ...sncfRest } = sncf
    if (Object.keys(sncfRest).length) extRest.sncf = sncfRest
    if (source != null) extRest.source = source
    if (loading_gauge_limits?.length) sectionRest.loading_gauge_limits = loading_gauge_limits
    const passthrough = { ...sectionRest, ...(Object.keys(extRest).length ? { extensions: extRest } : {}) }

    const defined = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined))
    tracks.push({
      id: section.id,
      ...(Object.keys(passthrough).length ? { osrd: passthrough } : {}),
      ...defined({
        name: sncf.track_name && sncf.track_name !== 'default_track' ? sncf.track_name : undefined,
        lineNumber: sncf.line_code && sncf.line_code !== 9900 ? String(sncf.line_code) : undefined,
        lineName: sncf.line_name && sncf.line_name !== 'default_name' ? sncf.line_name : undefined,
        trackNumber: sncf.track_number != null ? String(sncf.track_number) : undefined,
        owner:       olt.owner ?? undefined,
        trackType:   TYPE_CODES[olt.track_type] != null ? Number(TYPE_CODES[olt.track_type]) : undefined,
        side:        SIDE_CODES[olt.side] != null ? Number(SIDE_CODES[olt.side]) : undefined,
        stationName: olt.station_name ?? undefined,
        uicStation:  olt.uic_station ?? undefined,
        rails:       olt.rails?.length ? olt.rails : undefined,
        sleepers:    olt.sleepers?.length ? olt.sleepers : undefined,
        heightEpsg,
      }),
      epsg,
      elements,
      ...(heights.length >= 2 ? { heights } : {}),
    })
  })

  const trackById = Object.fromEntries(tracks.map(tr => [tr.id, tr]))
  const switches = (Array.isArray(infra.switches) ? infra.switches : [])
    .map(sw => rebuildSwitch(sw, trackById))
    .filter(Boolean)

  return { tracks, errors, infra, switches }
}
