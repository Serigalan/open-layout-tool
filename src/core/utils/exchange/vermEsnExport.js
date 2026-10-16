import { zipSync, strToU8 } from 'fflate'
import { transitionCantEnds } from '../geometry'
import { tangentLength, heightDatumLabel, reverseTrack, trackLabel } from '../track'
import { lagesystemForEpsg } from './mdbImport'
import { routeProfile } from '../elevation'

/**
 * Verm.ESN files of the project's tracks — the counterpart of vermEsnImport,
 * laid out the way the files met so far are (line 5550, 2026-10-02):
 *
 * **TRA**, 78 bytes a record, little-endian: radius at begin and end, easting,
 * northing, bearing (rad, grid, from north clockwise), station (float64 each),
 * type (int16), length, cant at begin and end [mm, magnitude] (float64), a
 * float32 that is 0 throughout. Radii are signed, positive to the right, 0 for
 * a straight end. The first record is a header whose type field counts the
 * elements; behind the elements a record of length 0 closes the axis at its
 * end point, leaving in the end bearing.
 *
 * **GRA**, 36 bytes a record: a header with the number of points, then per
 * point station, height, radius of the vertical curve (negative over a crest,
 * positive in a sag), tangent length (float64 each) and a point number (int32).
 *
 * Neither file says which plane or height datum it is in, so the archive
 * carries a short text naming them for each track.
 *
 * A route goes out the same way, as one axis (routeAsTrack): its tracks one
 * after the other in its direction, stationed from 0 at its begin.
 */

const RECORD_SIZE = 78
const GRA_RECORD_SIZE = 36
const DEG2RAD = Math.PI / 180

const TYPE_STRAIGHT = 0
const TYPE_ARC = 1
const TYPE_CLOTHOID = 2
const TYPE_BLOSS = 4
const TYPE_KINK = 5

/** Second header value of the GRA files met so far; its meaning is unknown, it is written as found. */
const GRA_HEADER_999 = 999

const norm2pi = (rad) => ((rad % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)

/** The deflection [gon] at the end of a straight that leaves in another direction, 0 where it does not. */
function kinkGon(el) {
  if (el.endBearing == null || el.endBearing === el.bearing) return 0
  return ((((el.endBearing - el.bearing) + 540) % 360) - 180) / 0.9
}

/**
 * The element records of a track: { radiusB, radiusE, easting, northing,
 * bearing, station, type, length, cantB, cantE }, stationed from 0, and the
 * closing record at its end. Elements of no length are left out.
 */
export function traRecords(track) {
  const els = track.elements ?? []
  const out = []
  let station = 0
  els.forEach((el, i) => {
    const length = el.length ?? 0
    if (!(length > 0)) return
    const base = {
      easting: el.startNode[0], northing: el.startNode[1],
      bearing: norm2pi((el.bearing ?? 0) * DEG2RAD), station, length,
    }
    if (el.elementType === 2) {
      const { start, end } = transitionCantEnds(els, i)
      out.push({
        ...base, type: el.transitionType === 'bloss' ? TYPE_BLOSS : TYPE_CLOTHOID,
        radiusB: el.r1 ?? 0, radiusE: el.r2 ?? 0, cantB: Math.abs(start), cantE: Math.abs(end),
      })
    } else if (el.radius) {
      const cant = Math.abs(el.cant ?? 0)
      out.push({ ...base, type: TYPE_ARC, radiusB: el.radius, radiusE: el.radius, cantB: cant, cantE: cant })
    } else {
      // A straight with a kink at its end states the angle the alignment
      // leaves in, as 200 gon plus the deflection (vermEsnImport, type 5).
      const kink = kinkGon(el)
      const cant = Math.abs(el.cant ?? 0)
      out.push({
        ...base, type: kink ? TYPE_KINK : TYPE_STRAIGHT,
        radiusB: kink ? 200 + kink : 0, radiusE: kink ? 200 + kink : 0, cantB: cant, cantE: cant,
      })
    }
    station += length
  })
  const last = [...els].reverse().find(el => (el.length ?? 0) > 0)
  if (last) {
    out.push({
      radiusB: 0, radiusE: 0, easting: last.endNode[0], northing: last.endNode[1],
      bearing: norm2pi((last.endBearing ?? last.bearing ?? 0) * DEG2RAD), station,
      type: TYPE_STRAIGHT, length: 0, cantB: 0, cantE: 0,
    })
  }
  return out
}

/** The TRA file of a track, as bytes. Null where it has no element of any length. */
export function traBytes(track) {
  const records = traRecords(track)
  if (records.length < 2) return null
  const bytes = new Uint8Array(RECORD_SIZE * (records.length + 1))
  const view = new DataView(bytes.buffer)
  view.setInt16(48, records.length - 1, true)
  records.forEach((r, i) => {
    const o = RECORD_SIZE * (i + 1)
    view.setFloat64(o, r.radiusB, true)
    view.setFloat64(o + 8, r.radiusE, true)
    view.setFloat64(o + 16, r.easting, true)
    view.setFloat64(o + 24, r.northing, true)
    view.setFloat64(o + 32, r.bearing, true)
    view.setFloat64(o + 40, r.station, true)
    view.setInt16(o + 48, r.type, true)
    view.setFloat64(o + 50, r.length, true)
    view.setFloat64(o + 58, r.cantB, true)
    view.setFloat64(o + 66, r.cantE, true)
    view.setFloat32(o + 74, 0, true)
  })
  return bytes
}

/**
 * The GRA file of a track's heights, as bytes: stationed along the track like
 * its TRA file, the radius signed by whether the gradient falls (crest) or
 * rises (sag) across the point. Null with fewer than two height points.
 */
export function graBytes(track) {
  const points = track.heights ?? []
  if (points.length < 2) return null
  const bytes = new Uint8Array(GRA_RECORD_SIZE * (points.length + 1))
  const view = new DataView(bytes.buffer)
  view.setFloat64(0, points.length, true)
  view.setFloat64(24, GRA_HEADER_999, true)
  points.forEach((p, i) => {
    const o = GRA_RECORD_SIZE * (i + 1)
    const tangent = tangentLength(points, i)
    const a = points[i - 1], b = points[i + 1]
    const crest = tangent && (b.z - p.z) / (b.station - p.station) < (p.z - a.z) / (p.station - a.station)
    view.setFloat64(o, p.station, true)
    view.setFloat64(o + 8, p.z, true)
    view.setFloat64(o + 16, (crest ? -1 : 1) * Math.abs(p.rv ?? 0), true)
    view.setFloat64(o + 24, tangent ?? 0, true)
    view.setInt32(o + 32, 0, true)
  })
  return bytes
}

/** Two bearings closer than this [°] are the same direction. */
const SAME_BEARING = 1e-6

/**
 * A route as a track of its own, for the export: { track, problem }. The track
 * has the elements of all parts in the route's direction — a part run
 * backwards turned round, its radii and cants with it — and the heights of
 * the route's profile, the point two parts share at their joint once
 * (routeProfile). `track.route` names the tracks it runs and, where the route
 * has no gradient, why.
 *
 * No track where the route is broken (`problem` 'gaps'), has no element
 * ('empty') or runs over tracks in different planes ('planes'). It has no
 * heights where one of its tracks has none or they are in different height
 * datums — a gradient over part of the route would not be the route's.
 */
export function routeAsTrack(resolved) {
  const { route, parts = [] } = resolved ?? {}
  const name = String(route?.name ?? '').trim() || 'Route'
  if (!parts.length) return { track: null, problem: 'empty', name }
  if (resolved.gaps?.length) return { track: null, problem: 'gaps', name }
  const epsgs = new Set(parts.map(p => Number(p.track.epsg) || null))
  if (epsgs.size > 1) return { track: null, problem: 'planes', name }
  // Where a straight ends a part and the next part leaves in another
  // direction, that is a kink, written as one (traRecords, type 5).
  const elements = []
  for (const part of parts) {
    const els = (part.reversed ? reverseTrack(part.track) : part.track).elements ?? []
    const at = elements.findLastIndex(el => (el.length ?? 0) > 0)
    const last = elements[at]
    const first = els.find(el => (el.length ?? 0) > 0)
    if (last && first && !last.radius && last.elementType !== 2
      && Math.abs(((((first.bearing - (last.endBearing ?? last.bearing)) + 540) % 360) - 180)) > SAME_BEARING) {
      elements[at] = { ...last, endBearing: first.bearing }
    }
    elements.push(...els)
  }
  if (!elements.some(el => (el.length ?? 0) > 0)) return { track: null, problem: 'empty', name }
  const heightEpsgs = new Set(parts.map(p => Number(p.track.heightEpsg) || null))
  const noGradient = parts.some(p => (p.track.heights?.length ?? 0) < 2) ? 'heights'
    : heightEpsgs.size > 1 ? 'datums' : null
  const heights = noGradient ? undefined : routeProfile(resolved).points.map(p => ({
    station: p.station, z: p.z, ...(p.rv != null ? { rv: p.rv } : {}),
  }))
  return {
    problem: null, name,
    track: {
      id: route?.id, name, epsg: parts[0].track.epsg, elements,
      ...(heights ? { heights, heightEpsg: parts[0].track.heightEpsg } : {}),
      route: { tracks: parts.map(p => nameOf(p.track)), noGradient },
    },
  }
}

/** What a track is called in the export: its own name, which tells the pieces of a line apart, else its label. */
const nameOf = (track) => String(track.name ?? '').trim() || trackLabel(track)

const UMLAUT = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss' }

/** A track's name as a file name in plain ASCII, which the Windows tools reading these files expect. */
const fileBase = (track) => nameOf(track)
  .replace(/[äöüÄÖÜß]/g, c => UMLAUT[c])
  .replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[_.]+|[_.]+$/g, '') || 'Gleis'

/**
 * The Verm.ESN files of the given tracks and routes (resolved, see
 * resolveRoute), as one zip: per track and per route a TRA, a GRA where it has
 * heights, named after it and its Lagesystem (`807B.002_DR0.TRA`), and a text
 * naming what the files themselves do not.
 *
 * Returns { zip, files, skipped, routesSkipped } — `files` what was written,
 * as { name, route, tra, gra, elements, length, epsg, heightEpsg }; `skipped`
 * the names of tracks without any element; `routesSkipped` the routes not
 * written, as { name, problem } (routeAsTrack).
 */
export function exportVermEsn(tracks, { title = '', routes = [] } = {}) {
  const entries = {}
  const files = []
  const skipped = []
  const routesSkipped = []
  const used = new Set()
  const routeTracks = []
  for (const resolved of routes) {
    const { track, problem, name } = routeAsTrack(resolved)
    if (track) routeTracks.push(track)
    else routesSkipped.push({ name, problem })
  }
  for (const track of [...tracks, ...routeTracks]) {
    const tra = traBytes(track)
    if (!tra) { skipped.push(nameOf(track)); continue }
    const lsys = lagesystemForEpsg(track.epsg)
    const stem = [fileBase(track), lsys].filter(Boolean).join('_')
    let base = stem
    for (let n = 2; used.has(base.toUpperCase()); n++) base = `${stem}-${n}`
    used.add(base.toUpperCase())
    const gra = graBytes(track)
    entries[`${base}.TRA`] = tra
    if (gra) entries[`${base}.GRA`] = gra
    const records = traRecords(track)
    files.push({
      name: nameOf(track), route: track.route ?? null, tra: `${base}.TRA`, gra: gra ? `${base}.GRA` : null,
      elements: records.length - 1, length: records[records.length - 1].station,
      epsg: Number(track.epsg) || null, lsys,
      heightEpsg: gra ? Number(track.heightEpsg) || null : null, heights: gra ? track.heights.length : 0,
    })
  }
  entries['Verm.ESN-Export.txt'] = strToU8(exportNote(files, skipped, routesSkipped, title))
  return { zip: zipSync(entries), files, skipped, routesSkipped }
}

const ROUTE_PROBLEM = {
  gaps: 'unterbrochen', empty: 'ohne Elemente', planes: 'Gleise in verschiedenen Lagesystemen',
}
const NO_GRADIENT = {
  heights: 'nicht jedes Gleis hat Höhen', datums: 'Höhen in verschiedenen Höhensystemen',
}

/** The text in the archive: per file the track or route, the plane and the height datum it is in. */
function exportNote(files, skipped, routesSkipped, title) {
  const lines = [
    `Verm.ESN-Export${title ? ` – ${title}` : ''}`,
    `Erstellt ${new Date().toISOString().slice(0, 10)} mit dem Open Layout Tool.`,
    '',
    'Stationierung je Gleis und je Route ab 0 m; TRA und GRA eines Gleises oder einer Route sind gleich stationiert.',
    'Eine Route ist eine Achse über ihre Gleise in Routenrichtung; gegen ihre Richtung befahrene Gleise sind umgedreht.',
    'Koordinaten im Lagesystem des Gleises, nicht umgerechnet. Überhöhung als Betrag in mm.',
    '',
  ]
  for (const f of files) {
    const what = f.route ? `Route „${f.name}“ über ${f.route.tracks.join(' → ')}` : `Gleis ${f.name}`
    lines.push(`${f.tra}  ${what}, ${f.elements} Elemente, ${f.length.toFixed(3)} m, `
      + `EPSG ${f.epsg ?? '?'}${f.lsys ? ` (${f.lsys})` : ''}`)
    if (f.gra) lines.push(`${f.gra}  ${f.heights} Höhenpunkte, ${heightDatumLabel(f.heightEpsg ?? undefined)}`)
    else if (f.route?.noGradient) lines.push(`  ohne GRA: ${NO_GRADIENT[f.route.noGradient]}`)
  }
  if (skipped.length) lines.push('', `Ohne Elemente, nicht exportiert: ${skipped.join(', ')}`)
  if (routesSkipped.length) {
    lines.push('', `Nicht exportierte Routen: ${routesSkipped.map(r => `${r.name} (${ROUTE_PROBLEM[r.problem]})`).join(', ')}`)
  }
  return lines.join('\r\n') + '\r\n'
}
