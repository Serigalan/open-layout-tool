import { unzipSync } from 'fflate'
import {
  endPointStraightUtm, endPointCurvedUtm,
  computeStraightValuesUtm, computeCurvedValuesUtm, arcCoordsFromRadiusUtm,
} from './elementUtils'
import { computeClothoidUtm } from './clothoidUtils'
import { utmToWgs84 } from './coordinateUtils'
import { SAGITTA_ELEMENT, cantSign } from './mapConstants'
import { epsgForLagesystem, parseBauform, RAIL_NAME } from './mdbImport'
import { offsetOnElement } from './mdbSwitchDerive'
import { heightAt, trackLength } from './heightUtils'

/**
 * ProVI's interface files, delivered as a zip archive of text files without an
 * extension. The file name says what a file is: `A623B` is the axis `623B`,
 * `T623B` its gradient. The archive carries more (`WLI…` switch lists, `GV…`,
 * `P…`, cross sections `TR…`, terrain models) that this import does not read —
 * `TR624B` begins with a T too, and is told apart by not naming an axis.
 *
 * **The axis** is a chain of main points (`HP`: station, easting, northing)
 * with the element between two of them in between:
 *
 * - `KO`, `FE`, `PU` — a straight (`RAD = 0`) or an arc, of length `L`,
 *   leaving at `WIN` (gon, grid bearing). The three are the ways ProVI
 *   constructs an element (Koppel-, Fest-, Pufferelement), not three shapes.
 * - `UB`, `UV` — a transition from `RAD1` to `RAD2` over `L1`; `TYP 2` is a
 *   clothoid, `TYP 8` a Bloss curve. With `L2` it is a reverse curve: `RAD1`
 *   down to straight over `L1`, then up to `RAD2` over `L2`. A transition of
 *   no length is only the joint between two elements.
 * - `WE` — a switch. The axis runs along one of its two routes: the stem
 *   points `WS` are stationed along the host axis `ANUM`, the branch points
 *   `WZ` along this one. Between two points a route bends from the one's
 *   `RAD` to the next one's `VRAD` — an arc where they agree, a clothoid where
 *   the switch is laid into a transition.
 *
 * Positive radii bend right, the model's own convention, and a cant `UQ` [mm]
 * carries the sign of its curve. Measured over the test archive (176 axes,
 * 5 000 elements, 229 switches), every element rebuilt this way ends within
 * 0.6 mm of the main point after it.
 *
 * **The gradient** is the tangent polygon the model holds (`track.heights`):
 * `X station height Rv …`, stationed along its axis.
 */

const GON2DEG = 0.9
const RAD2DEG = 180 / Math.PI

/** Two stations closer than this are the same point [m]. */
const SAME = 2e-3

/** An element or a switch part shorter than this carries no geometry [m]. */
const MIN_LENGTH = 1e-3

/** Where an element may end off the main point after it and not be reported [m]. */
const JUNCTION_TOL = 0.01

/** How far a gradient may fall short of a track's end and still count as reaching it [m]. */
const REACH_TOL = 0.5

/** The switch forms the placement builds — the crossing kinds are not set yet. */
const TURNOUT = 'turnout'

// ── Archive and records ─────────────────────────────────────────────────────

const decoder = new TextDecoder('utf-8')

/**
 * The text files of an archive by their name, folders left out — a file is
 * known by its name alone. `buffer` is the zip as an ArrayBuffer or Uint8Array.
 */
export function readProviArchive(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const files = new Map()
  for (const [path, data] of Object.entries(unzipSync(bytes))) {
    const name = path.split('/').pop()
    if (!name) continue
    files.set(name, decoder.decode(data))
  }
  return files
}

/**
 * The records of a file: `TYPE # KEY = value # KEY = value`, with the header
 * lines (`EB: …`, `VERSION: …`, `PVI_METADATA_…: …`) apart. A key that occurs
 * twice in one record keeps its first value.
 */
export function parseProviRecords(text) {
  const header = {}
  const records = []
  for (const raw of String(text ?? '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (!line) continue
    const head = /^([A-Z_0-9]+):\s?(.*)$/.exec(line)
    if (head && !line.includes(' # ')) { header[head[1]] = head[2].trim(); continue }
    const [type, ...parts] = line.split(' # ')
    const fields = {}
    for (const part of parts) {
      const eq = part.indexOf('=')
      if (eq < 0) continue
      const key = part.slice(0, eq).trim()
      if (!(key in fields)) fields[key] = part.slice(eq + 1).trim()
    }
    records.push({ type: type.trim(), fields })
  }
  return { header, records }
}

const num = (fields, key) => {
  const v = Number(fields?.[key])
  return Number.isFinite(v) ? v : 0
}

// ── Coordinate system ───────────────────────────────────────────────────────

/** Gauss-Krüger zone → the strip letter of a Lagesystem code (mdbImport). */
const STRIP = { 2: 'C', 3: 'D', 4: 'E', 5: 'F' }

/**
 * The frames an axis without a Lagesystem of its own can be read in, as the
 * frame letter of a Lagesystem code. The zone is the axis's own either way —
 * a Gauss-Krüger easting begins with it.
 */
export const PROVI_FRAMES = [
  { frame: 'R', label: 'DB_REF' },
  { frame: 'A', label: 'DHDN' },
  { frame: 'B', label: 'PD/83' },
  { frame: 'C', label: '42/83' },
]

/**
 * The plane an axis is in. `PVI_METADATA_LSYS2` names it the way the DB ASCII
 * interface does (`DR0`, `ER0`, `DA1` — see mdbImport), or plainly as
 * `DB_REF`. An axis that names none, or one this tool has no plane for
 * (`REF_2016`), is read in `fallbackFrame` and says so. The coordinates are
 * taken as they are in every case: nothing is transformed.
 */
export function proviAxisEpsg(lsys, easting, fallbackFrame = 'R') {
  const zone = Math.floor(Number(easting) / 1e6)
  const code = String(lsys ?? '').trim().toUpperCase()
  const inFrame = (frame) => (STRIP[zone] ? epsgForLagesystem(`${STRIP[zone]}${frame}0`) : null)
  if (/^[A-Z]{2}\d$/.test(code)) {
    const epsg = epsgForLagesystem(code)
    if (epsg) {
      const stated = Object.entries(STRIP).find(([, s]) => s === code[0])?.[0]
      return {
        epsg,
        note: stated && Number(stated) !== zone
          ? `Lagesystem ${code} nennt Zone ${stated}, die Rechtswerte liegen in Zone ${zone}.`
          : null,
      }
    }
  }
  if (code === 'DB_REF') return { epsg: inFrame('R'), note: null }
  const epsg = inFrame(fallbackFrame)
  const frame = PROVI_FRAMES.find(f => f.frame === fallbackFrame)?.label ?? fallbackFrame
  return {
    epsg,
    note: code
      ? `Lagesystem ${code} ist nicht zugeordnet – als ${frame} Zone ${zone} gelesen.`
      : `kein Lagesystem angegeben – als ${frame} Zone ${zone} gelesen.`,
  }
}

// ── Elements ────────────────────────────────────────────────────────────────

const norm360 = (deg) => ((deg % 360) + 360) % 360

/** Compass bearing [°] of a mathematical direction [rad, from east, counter-clockwise]. */
const bearingOfDir = (dir) => norm360(90 - dir * RAD2DEG)

function straight(start, bearing, length, crs) {
  const end = endPointStraightUtm(start, bearing, length)
  const sv = computeStraightValuesUtm(start, end)
  return {
    elementType: 0,
    startNode: sv.startNode, endNode: sv.endNode,
    bearing: sv.bearing, length: sv.length, absLength: sv.length, speed: 0,
    geometry: { type: 'LineString', coordinates: [
      utmToWgs84(start.easting, start.northing, crs), utmToWgs84(end.easting, end.northing, crs)] },
  }
}

function arc(start, bearing, length, radius, crs) {
  const end = endPointCurvedUtm(start, bearing, length, radius)
  const cv = computeCurvedValuesUtm(start, end, radius)
  return {
    elementType: 1,
    startNode: cv.startNode, endNode: cv.endNode,
    bearing: cv.bearing, endBearing: cv.endBearing,
    length: cv.length, absLength: cv.length, speed: 0,
    radius,
    geometry: { type: 'LineString', coordinates: arcCoordsFromRadiusUtm(start, end, radius, SAGITTA_ELEMENT)
      ?? [utmToWgs84(start.easting, start.northing, crs), utmToWgs84(end.easting, end.northing, crs)] },
  }
}

function transition(start, bearing, length, r1, r2, transitionType) {
  const cl = computeClothoidUtm(start, bearing, length, r1 || null, r2 || null, SAGITTA_ELEMENT, transitionType)
  return {
    elementType: 2, transitionType, r1: r1 || null, r2: r2 || null,
    startNode: [start.easting, start.northing],
    endNode: [cl.endUtm.easting, cl.endUtm.northing],
    bearing, endBearing: cl.endBearing,
    length, absLength: length, speed: 0,
    geometry: { type: 'LineString', coordinates: cl.coords },
  }
}

/** A stretch of constant curvature: an arc, or a straight where the radius is 0. */
const constant = (start, bearing, length, radius, crs) => (radius
  ? arc(start, bearing, length, radius, crs)
  : straight(start, bearing, length, crs))

/** Where an element ends, as the start of the next piece built from it. */
const endOf = (el, crs) => ({
  start: { easting: el.endNode[0], northing: el.endNode[1], zone: crs },
  bearing: el.endBearing ?? el.bearing,
})

/**
 * The route of a switch between two main points of the axis. Of the stem
 * (`WS`) and the branch (`WZ`), the axis runs along the one whose points are
 * stationed where the main points are; it is walked from point to point, in
 * the direction the axis runs — which is against the points' own order where
 * the switch faces the other way.
 */
function switchParts(body, s0, s1, crs) {
  for (const kind of ['WZ', 'WS']) {
    const pts = body.filter(r => r.type === kind).map(r => r.fields)
    const i0 = pts.findIndex(p => Math.abs(num(p, 'STAT') - s0) <= SAME)
    const i1 = pts.findIndex(p => Math.abs(num(p, 'STAT') - s1) <= SAME)
    if (i0 < 0 || i1 < 0 || i0 === i1) continue
    const step = i1 > i0 ? 1 : -1
    const out = []
    for (let i = i0; i !== i1; i += step) {
      const p = pts[i]
      const q = pts[i + step]
      const length = Math.abs(num(q, 'STAT') - num(p, 'STAT'))
      if (length < MIN_LENGTH) continue
      const start = { easting: num(p, 'RW'), northing: num(p, 'HW'), zone: crs }
      // Walked backwards, a point's incoming side is the part's start and every
      // curve bends the other way.
      const bearing = step > 0
        ? bearingOfDir(num(p, 'DIR'))
        : norm360(bearingOfDir(num(p, 'VDIR' in p ? 'VDIR' : 'DIR')) + 180)
      const ra = step > 0 ? num(p, 'RAD') : -num(p, 'VRAD')
      const rb = step > 0 ? num(q, 'VRAD') : -num(q, 'RAD')
      out.push(Math.abs(ra - rb) < 1e-6
        ? constant(start, bearing, length, ra, crs)
        : transition(start, bearing, length, ra, rb, 'clothoid'))
    }
    return out
  }
  return null
}

/** The cant a stretch states, in mm — 0 where it states none. */
function cantOf(body) {
  const uq = body.find(r => r.type === 'UQ' && 'UQ' in r.fields)
  return uq ? num(uq.fields, 'UQ') : 0
}

/** Put a stretch's cant on the elements that carry one: arcs by their curve, straights as stated. */
function applyCant(elements, cant) {
  if (!cant) return
  for (const el of elements) {
    if (el.elementType === 1) el.cant = cantSign(el.radius) * Math.abs(cant)
    else if (el.elementType === 0) el.cant = cant
  }
}

/**
 * The elements of one axis, and the switches it states.
 *
 * Every element is placed from its own main point, so an element that does
 * not end where the next begins shows as a junction deviation rather than
 * moving everything after it.
 *
 * Returns { elements, units, begin, end, errors } — `begin`/`end` the axis's
 * own stations, `units` the switches of the `WE` records (see
 * placeMdbSwitches).
 */
export function buildProviAxis(name, records, crs) {
  const errors = []
  const elements = []
  const units = []
  const hps = []
  records.forEach((r, i) => { if (r.type === 'HP') hps.push(i) })
  if (hps.length < 2) return { elements, units, begin: 0, end: 0, errors: [`Achse ${name}: keine Hauptpunkte.`] }

  const skipped = new Map()
  for (let k = 0; k + 1 < hps.length; k++) {
    const h0 = records[hps[k]].fields
    const h1 = records[hps[k + 1]].fields
    const s0 = num(h0, 'STAT')
    const s1 = num(h1, 'STAT')
    const body = records.slice(hps[k] + 1, hps[k + 1])
    const main = body.find(r => ['KO', 'FE', 'PU', 'UB', 'UV', 'WE'].includes(r.type))
    if (!main) continue
    const f = main.fields
    const start = { easting: num(h0, 'RW'), northing: num(h0, 'HW'), zone: crs }
    let built = []

    if (['KO', 'FE', 'PU'].includes(main.type)) {
      const length = num(f, 'L')
      if (length >= MIN_LENGTH) built = [constant(start, num(f, 'WIN') * GON2DEG, length, num(f, 'RAD'), crs)]
    } else if (main.type === 'UB' || main.type === 'UV') {
      const l1 = num(f, 'L1')
      const l2 = num(f, 'L2')
      if (l1 + l2 < MIN_LENGTH) continue
      const typ = num(f, 'TYP')
      const kind = typ === 8 ? 'bloss' : typ === 2 ? 'clothoid' : null
      if (!kind) { skipped.set(`Übergangsbogen TYP ${typ}`, (skipped.get(`Übergangsbogen TYP ${typ}`) ?? 0) + 1); continue }
      const bearing = num(f, 'WIN') * GON2DEG
      if (l2 >= MIN_LENGTH) {
        // A reverse curve: down to straight, then up into the other curve.
        const a = transition(start, bearing, l1, num(f, 'RAD1'), 0, kind)
        const at = endOf(a, crs)
        built = [a, transition(at.start, at.bearing, l2, 0, num(f, 'RAD2'), kind)]
      } else {
        built = [transition(start, bearing, l1, num(f, 'RAD1'), num(f, 'RAD2'), kind)]
      }
    } else if (main.type === 'WE') {
      built = switchParts(body, s0, s1, crs)
      if (!built) {
        errors.push(`Achse ${name}, Station ${s0.toFixed(3)}: Weiche ${f.WNUM ?? '?'} ohne Weichenpunkte `
          + 'an den Hauptpunkten – Geometrie fehlt.')
        continue
      }
      const unit = switchUnit(name, body, f, crs)
      if (unit) units.push(unit)
    }
    if (!built.length) continue

    applyCant(built, cantOf(body))
    const last = built[built.length - 1]
    const gap = Math.hypot(last.endNode[0] - num(h1, 'RW'), last.endNode[1] - num(h1, 'HW'))
    if (gap > JUNCTION_TOL) {
      errors.push(`Achse ${name}, Station ${s0.toFixed(3)} (${main.type}): endet `
        + `${(gap * 1000).toFixed(1)} mm neben dem nächsten Hauptpunkt.`)
    }
    elements.push(...built)
  }
  for (const [what, n] of skipped) {
    errors.push(`Achse ${name}: ${n}× ${what} unbekannt – übersprungen.`)
  }

  return {
    elements, units, errors,
    begin: num(records[hps[0]].fields, 'STAT'),
    end: num(records[hps[hps.length - 1]].fields, 'STAT'),
  }
}

/**
 * The switch a `WE` record states, as the unit placeMdbSwitches takes: its
 * form from the name in `WB` (`60-760-1:14`, `IBW 54-300-1:9 zTiU` — the
 * Bauform the MDB writes, and read the same way), and the Weichenanfang, where
 * the stem and branch part, as the point it is located by.
 */
function switchUnit(axis, body, f, crs) {
  const wb = body.find(r => r.type === 'WB')?.fields
  const toe = body.find(r => r.type === 'WZ' && r.fields.TYP === 'WAZ')?.fields
    ?? body.find(r => r.type === 'WS' && r.fields.TYP === 'WA')?.fields
  const form = parseBauform(wb?.NAME ?? '')
  return {
    host: String(f.ANUM ?? ''),
    branch: axis,
    bst: String(f.ANUM ?? ''),
    name: String(f.WNUM ?? ''),
    label: form.raw,
    kind: form.kind ?? TURNOUT,
    bogen: form.bogen,
    radius: form.radius,
    slope: form.n,
    rail: RAIL_NAME[form.rail] ?? null,
    point: toe ? [num(toe, 'RW'), num(toe, 'HW')] : null,
    epsg: crs,
  }
}

// ── Gradient ────────────────────────────────────────────────────────────────

/**
 * The tangent polygon of a gradient file, stationed along its axis:
 * [{ station, z, rv? }], ascending. `X station height Rv …` — the columns
 * after the radius are unused here.
 */
export function parseProviGradient(text) {
  const out = []
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/)
    if (cols[0] !== 'X' || cols.length < 3) continue
    const station = Number(cols[1])
    const z = Number(cols[2])
    const rv = Math.abs(Number(cols[3]))
    if (!Number.isFinite(station) || !Number.isFinite(z)) continue
    out.push({ station, z, ...(rv > 0 ? { rv } : {}) })
  }
  return out.sort((a, b) => a.station - b.station)
}

/**
 * The stretch [from, to] of an axis's gradient as a track's heights, stationed
 * from `from`. Where the gradient begins behind `from` or ends before `to`, the
 * heights do too — that stretch is left to be read from the terrain on
 * request (elevationFill). A cut between two points takes the height of the
 * tangent polygon there, as a split does (splitHeights). Null where the
 * gradient does not reach into the stretch at all.
 */
export function gradientStretch(points, from, to) {
  if (!points?.length) return null
  const first = points[0]
  const last = points[points.length - 1]
  if (last.station < from + REACH_TOL || first.station > to - REACH_TOL) return null
  const at = (s) => {
    const hit = points.find(p => Math.abs(p.station - s) <= SAME)
    return hit ? { ...hit, station: s } : { z: heightAt(points, s), station: s }
  }
  // A gradient that begins behind `from` begins with its own first point — at
  // `from` itself where it falls short of it by less than REACH_TOL — and one
  // that reaches past `from` is cut there. The same at the far end.
  const begin = first.station >= from - SAME
    ? { ...first, station: first.station <= from + REACH_TOL ? from : first.station }
    : at(from)
  const end = last.station <= to + SAME
    ? { ...last, station: last.station >= to - REACH_TOL ? to : last.station }
    : at(to)
  const lo = Math.max(from, first.station)
  const hi = Math.min(to, last.station)
  const inside = points.filter(p => p.station > lo + SAME && p.station < hi - SAME)
  return [begin, ...inside, end].map(p => ({ ...p, station: p.station - from }))
}

// ── Whole archive ───────────────────────────────────────────────────────────

/** Axis name of a file name: `A623B` → `623B`, null for anything else. */
const axisName = (file) => (/^A\d/.test(file) ? file.slice(1) : null)

/**
 * The axes of an archive, for the picker: name, the title the file gives it
 * (`EB`), its Lagesystem, how long it is, and whether a gradient belongs to it.
 */
export function listProviAxes(files) {
  const out = []
  for (const [file, text] of files) {
    const name = axisName(file)
    if (!name) continue
    const { header, records } = parseProviRecords(text)
    const hp = records.filter(r => r.type === 'HP')
    if (hp.length < 2) continue
    out.push({
      name,
      title: header.EB ?? '',
      lsys: header.PVI_METADATA_LSYS2 ?? '',
      length: num(hp[hp.length - 1].fields, 'STAT') - num(hp[0].fields, 'STAT'),
      switches: records.filter(r => r.type === 'WE').length,
      gradient: parseProviGradient(files.get(`T${name}`)).length > 0,
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
}

/**
 * The chosen axes as tracks, one per axis, in the plane each states; with the
 * switches they state and the gradients that go with them.
 *
 * A switch is stated by the axis that branches off — named twice where two
 * axes branch off at it, and taken once. The gradient is not put on the track
 * yet: placing the switches cuts the tracks, and heights cut along with them
 * would be made up wherever a cut falls past the gradient's end. It is cut to
 * the pieces afterwards (`proviHeights`).
 *
 * Returns { tracks, units, axes, errors } — `axes` by name: the track as built
 * and its gradient, stationed from the track's begin.
 */
export function buildProviTracks(files, names, { fallbackFrame = 'R' } = {}) {
  const errors = []
  const tracks = []
  const units = []
  const axes = new Map()
  const seen = new Set()
  const zoneNotes = new Map()

  for (const name of names) {
    const text = files.get(`A${name}`)
    if (!text) { errors.push(`Achse ${name} fehlt im Archiv.`); continue }
    const { header, records } = parseProviRecords(text)
    const first = records.find(r => r.type === 'HP')
    if (!first) { errors.push(`Achse ${name}: keine Hauptpunkte.`); continue }
    const { epsg, note } = proviAxisEpsg(header.PVI_METADATA_LSYS2, num(first.fields, 'RW'), fallbackFrame)
    if (!epsg) { errors.push(`Achse ${name}: Koordinatensystem nicht bestimmbar – übersprungen.`); continue }
    if (note) zoneNotes.set(note, [...(zoneNotes.get(note) ?? []), name])

    const built = buildProviAxis(name, records, epsg)
    errors.push(...built.errors)
    if (!built.elements.length) { errors.push(`Achse ${name}: keine Elemente – übersprungen.`); continue }
    const track = { name, epsg, elements: built.elements, proviAxis: name }
    tracks.push(track)

    const gradient = parseProviGradient(files.get(`T${name}`))
      .map(p => ({ ...p, station: p.station - built.begin }))
    axes.set(name, { track, gradient, length: built.end - built.begin })

    for (const unit of built.units) {
      const key = `${unit.host}\u0000${unit.name}`
      if (seen.has(key)) continue
      seen.add(key)
      units.push(unit)
    }
  }
  for (const [note, list] of zoneNotes) {
    errors.push(`${list.length} Achsen: ${note} (${list.slice(0, 8).join(', ')}${list.length > 8 ? ', …' : ''})`)
  }
  return { tracks, units, axes, errors }
}

/**
 * Which of the stated switches the placement can take, and what is said about
 * the others: a crossing kind is not set by this import yet, a switch needs its
 * host axis among the imported ones, and its Weichenanfang.
 */
export function proviPlaceableUnits(units, axes) {
  const errors = []
  const ok = []
  for (const unit of units) {
    const label = `Weiche ${unit.name} an ${unit.host} (${unit.label || '?'})`
    if (unit.kind !== TURNOUT) errors.push(`${label}: Kreuzungsweichen setzt der ProVI-Import noch nicht.`)
    else if (!unit.point) errors.push(`${label}: kein Weichenanfang in der Achse ${unit.branch}.`)
    else if (!axes.has(unit.host)) errors.push(`${label}: Stammgleis ${unit.host} nicht mit importiert.`)
    else if (axes.get(unit.host).track.epsg !== unit.epsg) {
      errors.push(`${label}: Stammgleis ${unit.host} (EPSG ${axes.get(unit.host).track.epsg}) und `
        + `Zweiggleis ${unit.branch} (EPSG ${unit.epsg}) liegen laut Datei in verschiedenen `
        + 'Lagesystemen, obwohl sie sich an der Weiche treffen – nicht gesetzt.')
    } else ok.push(unit)
  }
  return { units: ok, errors }
}

/** How close a track's end must come to a Weichenanfang to be one of its legs [m]. */
const LEG_TOL = 1.0

/**
 * The tracks a switch may be set on (placeMdbSwitches' `tracksFor`): the
 * pieces of its host and branch axis. The archive carries variants of a track
 * lying on top of each other, and the switch belongs to the one the file
 * names, not to whichever runs nearest. Only where the host has no piece
 * running through the Weichenanfang — it begins there, or an earlier switch
 * at the same point has already cut it — do the other tracks ending there
 * count as well: one of them leads up to the switch.
 */
export function proviSwitchCandidates(unit, tracks) {
  const [x, y] = unit.point
  const near = (node) => node && Math.hypot(node[0] - x, node[1] - y) <= LEG_TOL
  const endsHere = (t) => near(t.elements[0]?.startNode) || near(t.elements[t.elements.length - 1]?.endNode)
  const own = tracks.filter(t => t.proviAxis === unit.host || t.proviAxis === unit.branch)
  if (!own.some(t => t.proviAxis === unit.host && endsHere(t))) return own
  return tracks.filter(t => own.includes(t) || endsHere(t))
}

/**
 * Exact offset of a plane point from a track, { dist, station } — the
 * projection placeMdbSwitches is given for ProVI's long elements. No element
 * can come nearer than its chord less how far it can leave that chord, so the
 * elements are measured exactly in the order of that bound, and only until the
 * bound passes the best hit.
 */
export function proviProject(track, pt) {
  const bounds = []
  let acc = 0
  for (const el of track.elements ?? []) {
    const length = el.length ?? 0
    const [sx, sy] = el.startNode
    const [ex, ey] = el.endNode
    const dx = ex - sx
    const dy = ey - sy
    const len2 = dx * dx + dy * dy
    const u = len2 > 0 ? Math.max(0, Math.min(1, ((pt[0] - sx) * dx + (pt[1] - sy) * dy) / len2)) : 0
    const chord = Math.hypot(pt[0] - (sx + u * dx), pt[1] - (sy + u * dy))
    const radii = [el.radius, el.r1, el.r2].map(r => Math.abs(Number(r))).filter(r => r > 0)
    const bulge = radii.length ? (length * length) / (8 * Math.min(...radii)) : 0
    bounds.push({ el, begin: acc, bound: chord - bulge })
    acc += length
  }
  bounds.sort((a, b) => a.bound - b.bound)
  let best = null
  for (const { el, begin, bound } of bounds) {
    if (best && bound > best.dist) break
    const { s, dist } = offsetOnElement(el, pt, track.epsg)
    if (!best || dist < best.dist) best = { dist, station: begin + s }
  }
  return best
}

/**
 * Where each piece of an axis begins on it, found by projecting its begin onto
 * the axis as built. Pieces that follow one another take their begin from the
 * one before — its begin plus its length, to the last bit — so the two sides
 * of a cut are read at the same station and meet at the same height.
 */
function pieceStations(tracks, axes) {
  const begins = new Map()
  const byAxis = new Map()
  for (const track of tracks) {
    const axis = axes.get(track.proviAxis)
    if (!axis) continue
    const at = proviProject(axis.track, track.elements[0].startNode)
    if (!at) continue
    begins.set(track, at.station)
    if (!byAxis.has(track.proviAxis)) byAxis.set(track.proviAxis, [])
    byAxis.get(track.proviAxis).push(track)
  }
  for (const pieces of byAxis.values()) {
    pieces.sort((a, b) => begins.get(a) - begins.get(b))
    for (let i = 1; i < pieces.length; i++) {
      const chained = begins.get(pieces[i - 1]) + trackLength(pieces[i - 1])
      if (Math.abs(chained - begins.get(pieces[i])) <= SAME) begins.set(pieces[i], chained)
    }
  }
  return begins
}

/**
 * Give the tracks their heights from their axis's gradient, once the switches
 * have cut them: each piece is found on the axis it came from by where it
 * begins, and takes the stretch of the gradient it covers.
 *
 * Returns { tracks, errors } — the tracks without the import's own marker.
 */
export function proviHeights(tracks, axes) {
  const errors = []
  const short = new Set()
  const begins = pieceStations(tracks, axes)
  const out = tracks.map((track) => {
    const { proviAxis, ...rest } = track
    const axis = axes.get(proviAxis)
    const from = begins.get(track)
    if (!axis?.gradient.length || from == null) return rest
    const length = trackLength(track)
    const heights = gradientStretch(axis.gradient, from, from + length)
    const covered = heights?.length >= 2
      && heights[0].station <= SAME && heights[heights.length - 1].station >= length - REACH_TOL
    if (!covered) short.add(proviAxis)
    return heights?.length >= 2 ? { ...rest, heights } : rest
  })
  if (short.size) {
    errors.push(`Gradiente deckt die Achse nicht ganz ab (${[...short].join(', ')}) – `
      + 'dort bleiben Gleisstücke ganz oder teilweise ohne Höhen. Sie lassen sich im '
      + 'Höhenprofil aus dem Gelände ergänzen.')
  }
  return { tracks: out, errors }
}
