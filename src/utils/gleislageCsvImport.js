import {
  endPointStraightUtm, endPointCurvedUtm, resolveEndBearing,
  computeStraightValuesUtm, computeCurvedValuesUtm, arcCoordsFromRadiusUtm,
} from './elementUtils'
import { computeClothoidUtm } from './clothoidUtils'
import { utmToWgs84, transformPlanePoint, gkZone } from './coordinateUtils'
import { SAGITTA_ELEMENT, cantSign } from './mapConstants'

const GON2DEG = 0.9

/**
 * Coordinate system the export's geometry is usually delivered in: DB_REF / 3°
 * Gauss-Krüger zone 3. The rows carry a system code (EELL_LSYS_WL_TEXT_KURZ,
 * e.g. DR0 or DA0), but it is not read as a coordinate system — the import is
 * told which plane the file is in, and this is the default it offers.
 */
export const CSV_EPSG = 5683

/**
 * Rough extent of a plane in metres — catches a file that is in some other
 * system than the one it was declared to be in. A Gauss-Krüger zone is placed
 * around its false easting (zone·1e6 + 500 km), a UTM zone around its own.
 */
function boundsFor(epsg) {
  const zone = gkZone(epsg)
  if (zone) {
    const falseEasting = zone * 1e6 + 500000
    return { easting: [falseEasting - 4e5, falseEasting + 4e5], northing: [5.1e6, 6.2e6] }
  }
  return { easting: [1e5, 9e5], northing: [0, 9.5e6] }
}

/**
 * A row whose EELL_WINKEL_ANF is 0 states no start bearing — the export leaves
 * the field at zero where the element simply continues its predecessor, which
 * is what happens after a "Knick am Ende" has already carried the direction
 * change. Taken literally, zero gon is grid north and the element would be laid
 * across the alignment, so such a row takes the tangent the previous element
 * ends on instead.
 *
 * The one case this cannot tell apart is an element that genuinely runs due
 * grid north; it would be laid on its predecessor's tangent instead. The
 * junction check below is what surfaces that — the following element's own
 * start vertex would no longer line up with where this one ends.
 */
const statesBearing = (rec) => Number.isFinite(rec.bearing) && rec.bearing !== 0

/**
 * Junction tolerance [m]. Each row carries its own absolute position, bearing
 * and length, so elements are placed independently rather than chained — the
 * residual is the source's own quantisation (measured ~1.6 mm on line 3824).
 */
const JUNCTION_TOL = 0.01

const COLUMNS = [
  'EELL_ELTYP_WL_TEXT_L', 'EELL_PKT_ADRESSE_ANF', 'EELL_PKT_ADRESSE_END',
  'EELL_LSYS_WL_TEXT_KURZ', 'EELL_WINKEL_ANF', 'EELL_PARAM1', 'EELL_PARAM2',
  'EELL_PARAM3', 'STR_STRECKENNUMMER', 'EELL_GEO_COMPOUND',
]

const CANT_COLUMNS = [
  'EELU_ELTYP_WL_TEXT_L', 'EELU_PKT_ADRESSE_ANF', 'EELU_PKT_ADRESSE_END',
  'EELU_PARAM1', 'EELU_PARAM2', 'EELU_PARAM3', 'STR_STRECKENNUMMER',
]

/** Length agreement between an alignment element and its cant record [m]. */
const CANT_LENGTH_TOL = 0.05

export const CANT_CONSTANT = 'gleichbleibende Überhöhung'

/** Key linking an alignment element to its cant record. */
const addrKey = (anf, end) => `${anf}\u0000${end}`

// Element type → what we build. S-shaped transitions reverse curvature within
// one element and have no equivalent in the app's model.
export const TYPE_STRAIGHT   = 'Gerade'
export const TYPE_KINK       = 'Richtgerade / Knick am Ende +200[gon]'
export const TYPE_ARC        = 'Kreisbogen'
export const TYPE_CLOTHOID   = 'Klothoide'
export const TYPE_BLOSS      = 'Blosskurve'
const UNSUPPORTED = ['Übergangsbogen S-Form', 'S-Form (einfach geschwungen)', 'Bloss (einfach geschwungen)']

/** First vertex of a MULTILINESTRING, given as "northing easting" → [E, N]. */
function firstVertex(wkt) {
  const m = /\(\(\s*(-?[\d.]+)\s+(-?[\d.]+)/.exec(wkt ?? '')
  return m ? [Number(m[2]), Number(m[1])] : null
}

/**
 * Quote-aware CSV scan that keeps only the columns we need — the geometry
 * column holds whole polylines, so rows are reduced to their first vertex while
 * reading instead of being retained in full.
 */
function scanCsv(text, columns, emit) {
  const out = []
  let field = '', row = [], inQuotes = false, header = null, want = null
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text   // strip BOM

  const endRow = () => {
    row.push(field); field = ''
    if (!header) {
      header = row
      want = columns.map(c => header.indexOf(c))
      if (want.some(i => i < 0)) {
        throw new Error(`Spalten fehlen: ${columns.filter((_, k) => want[k] < 0).join(', ')}`)
      }
    } else if (row.length > 1) {
      out.push(emit(want.map(i => row[i] ?? '')))
    }
    row = []
  }

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n') endRow()
    else if (ch !== '\r') field += ch
  }
  if (field || row.length) endRow()
  return out
}

export function parseGleislageCsv(text) {
  return scanCsv(text, COLUMNS, ([typ, anf, end, lsys, winkel, p1, p2, p3, strecke, geo]) => ({
    typ, anf, end, lsys, strecke,
    bearing: Number(winkel) * GON2DEG,
    length: Number(p1),
    p2: Number(p2), p3: Number(p3),
    start: firstVertex(geo),
  }))
}

/**
 * Cant export (Überhöhung). Rows carry no geometry we need — they are matched
 * to alignment elements by the same point addresses, with PARAM1 as a length
 * cross-check. PARAM2/PARAM3 are the cant at the two ends: equal for a constant
 * section, rising/falling across a ramp. Values are magnitudes; the sign comes
 * from the curve they sit in.
 */
export function parseUeberhoehungCsv(text) {
  return scanCsv(text, CANT_COLUMNS, ([typ, anf, end, p1, p2, p3, strecke]) => ({
    typ, anf, end, strecke,
    length: Number(p1), u1: Number(p2), u2: Number(p3),
  }))
}

/** Line numbers present in the file, with their row counts (for the picker). */
export function listStrecken(rows) {
  const counts = new Map()
  for (const r of rows) {
    if (!r.strecke) continue
    counts.set(r.strecke, (counts.get(r.strecke) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([strecke, count]) => ({ strecke, count }))
    .sort((a, b) => a.strecke.localeCompare(b.strecke, undefined, { numeric: true }))
}

/**
 * Order rows into chains: each element's end address is the next one's start.
 *
 * A point address can carry more than one element on its far side — that is a
 * switch, and both legs are alignment. So the rows at an address are a queue,
 * not a single entry: the first walk takes one leg, and what is left over is
 * walked afterwards as chains of its own. Keyed by address alone, the second
 * leg used to be overwritten before the walk even started and vanished from
 * the import without a word (23 of 8 693 elements of the test database).
 */
function buildChains(rows) {
  const byStart = new Map()
  const ends = new Set()
  for (const r of rows) {
    if (!byStart.has(r.anf)) byStart.set(r.anf, [])
    byStart.get(r.anf).push(r)
    ends.add(r.end)
  }
  const take = (pad) => {
    const list = byStart.get(pad)
    if (!list?.length) return null
    const row = list.shift()
    if (!list.length) byStart.delete(pad)
    return row
  }
  const walk = (start) => {
    const chain = []
    for (let cur = start, row = take(cur); row; row = take(cur)) {
      chain.push(row)
      cur = row.end
    }
    return chain
  }
  const chains = []
  for (const r of rows) {
    if (ends.has(r.anf)) continue            // not a chain start
    const chain = walk(r.anf)
    if (chain.length) chains.push(chain)
  }
  // What is left begins where something else ends — the second leg of a
  // switch, or a closed loop. Emitted so nothing is silently lost.
  while (byStart.size) {
    const [key] = byStart.keys()
    const chain = walk(key)
    if (!chain.length) { byStart.delete(key); continue }
    chains.push(chain)
  }
  return chains
}

function buildElement(rec, crs) {
  const start = { easting: rec.start[0], northing: rec.start[1], zone: crs }
  const bearing = ((rec.bearing % 360) + 360) % 360
  const wgs = (p) => utmToWgs84(p.easting, p.northing, crs)

  if (rec.typ === TYPE_ARC) {
    const signedR = rec.p2 || rec.p3
    const end = endPointCurvedUtm(start, bearing, rec.length, signedR)
    const cv = computeCurvedValuesUtm(start, end, signedR)
    return {
      elementType: 1,
      startNode: cv.startNode, endNode: cv.endNode,
      bearing: cv.bearing, endBearing: cv.endBearing,
      length: cv.length, absLength: cv.length, speed: 0,
      radius: signedR,
      geometry: { type: 'LineString', coordinates:
        arcCoordsFromRadiusUtm(start, end, signedR, SAGITTA_ELEMENT) ?? [wgs(start), wgs(end)] },
    }
  }

  if (rec.typ === TYPE_CLOTHOID || rec.typ === TYPE_BLOSS) {
    // PARAM2/PARAM3 are the radii at the two ends; 0 means a straight on that side.
    const r1 = rec.p2 || null
    const r2 = rec.p3 || null
    const transitionType = rec.typ === TYPE_BLOSS ? 'bloss' : 'clothoid'
    const cl = computeClothoidUtm(start, bearing, rec.length, r1, r2, SAGITTA_ELEMENT, transitionType)
    return {
      elementType: 2, transitionType, r1, r2,
      startNode: [start.easting, start.northing],
      endNode: [cl.endUtm.easting, cl.endUtm.northing],
      bearing, endBearing: cl.endBearing,
      length: rec.length, absLength: rec.length, speed: 0,
      geometry: { type: 'LineString', coordinates: cl.coords },
    }
  }

  // Straight — the kink variant carries its end bearing in PARAM2 as gon
  // relative to 200 (200 = no kink), the same convention Verm.ESN type 5 uses.
  const end = endPointStraightUtm(start, bearing, rec.length)
  const sv = computeStraightValuesUtm(start, end)
  const kink = rec.typ === TYPE_KINK ? (rec.p2 - 200) * GON2DEG : 0
  return {
    elementType: 0,
    startNode: sv.startNode, endNode: sv.endNode,
    bearing: sv.bearing, length: sv.length, absLength: sv.length, speed: 0,
    ...(kink ? { endBearing: (((sv.bearing + kink) % 360) + 360) % 360 } : {}),
    geometry: { type: 'LineString', coordinates: [wgs(start), wgs(end)] },
  }
}

/**
 * Build tracks for one line number from parsed CSV rows.
 *
 * Rows are filtered to the requested line and coordinate system, ordered into
 * chains via the point addresses (EELL_PKT_ADRESSE_ANF/_END) and turned into
 * elements. Every row carries its own absolute start vertex, start bearing
 * (gon) and length, so elements are placed independently — no chaining drift.
 * Junction deviations beyond 1 cm and unsupported element types are reported.
 *
 * Returns { tracks, errors }.
 */
/**
 * Attach cants to the elements of one chain, matched by point address.
 *
 * Constant sections put their value on the element (signed by the curve it sits
 * in — the export stores magnitudes only). Ramps belong to transition curves,
 * where cant is not a scalar but a gradient; the app derives those ends from the
 * neighbours instead, so the ramp record is used purely as a cross-check.
 * Reports length disagreements and ramps that contradict their neighbours.
 */
function applyCants(chain, elements, cantByAddress, errors, label) {
  let matched = 0
  chain.forEach((rec, i) => {
    const cant = cantByAddress.get(addrKey(rec.anf, rec.end))
    if (!cant) return
    matched++
    if (Math.abs(cant.length - rec.length) > CANT_LENGTH_TOL) {
      errors.push(`${label}, Element ${i + 1} (${rec.typ}): Länge weicht von der Überhöhung ab – `
        + `${rec.length.toFixed(3)} m vs. ${cant.length.toFixed(3)} m`)
    }
    const el = elements[i]
    if (cant.typ === CANT_CONSTANT) {
      const u = cant.u1
      if (el.elementType === 1) el.cant = cantSign(el.radius) * Math.abs(u)
      else if (u) el.cant = u          // straight with cant — no curve to take a sign from
      return
    }
    // Ramp: check it lines up with the constant sections on either side.
    const before = chain[i - 1] && cantByAddress.get(addrKey(chain[i - 1].anf, chain[i - 1].end))
    const after  = chain[i + 1] && cantByAddress.get(addrKey(chain[i + 1].anf, chain[i + 1].end))
    if (before && Math.abs(before.u2 - cant.u1) > 0.5) {
      errors.push(`${label}, Element ${i + 1}: Rampenanfang ${cant.u1} mm passt nicht zum `
        + `Vorgänger (${before.u2} mm)`)
    }
    if (after && Math.abs(after.u1 - cant.u2) > 0.5) {
      errors.push(`${label}, Element ${i + 1}: Rampenende ${cant.u2} mm passt nicht zum `
        + `Nachfolger (${after.u1} mm)`)
    }
  })
  return matched
}

/**
 * Build tracks for one line number from parsed CSV rows.
 *
 * `sourceEpsg` is the plane the file's coordinates are in, `targetEpsg` the one
 * the tracks are to be created in. Only the start vertex of each row is carried
 * over between the two; the bearing, length and radii are taken as the file
 * states them.
 *
 * That is a deliberate choice, and it has a price when the two planes differ:
 * a bearing is grid-relative, and between GK zone 3 and zone 4 grid north
 * turns by 2.59 gon, so an element whose bearing is not already stated in the
 * target grid ends up rotated (~40 m per km). The junction check below is what
 * surfaces it — every element is placed from its own transformed vertex, so a
 * bearing that does not belong to the target grid shows up as junction
 * deviations rather than as a silently tilted alignment.
 */
export function buildTracksFromCsv(rows, strecke, cantRows = null, opts = {}) {
  const errors = []
  const sourceEpsg = Number(opts.sourceEpsg ?? CSV_EPSG)
  const crs = Number(opts.targetEpsg ?? sourceEpsg)

  const all = rows.filter(r => r.strecke === String(strecke))
  if (!all.length) return { tracks: [], errors: [`Keine Zeilen für Strecke ${strecke} gefunden.`] }

  // The export can list the same element once per coordinate system; the point
  // address pair identifies it, so a repeat is dropped instead of imported twice.
  const seen = new Set()
  let duplicates = 0
  const usable = all.filter(r => {
    if (!r.start || !(r.length > 0)) return false
    const key = addrKey(r.anf, r.end)
    if (seen.has(key)) { duplicates++; return false }
    seen.add(key)
    return true
  })
  if (duplicates) {
    errors.push(`${duplicates} doppelte Elemente übersprungen (dieselbe Punktadresse, `
      + 'zweites Koordinatensystem).')
  }
  if (!usable.length) return { tracks: [], errors: [...errors, 'Keine verwertbaren Zeilen.'] }

  // The file's own plane is what the coordinates are checked against — the
  // transformation to the target plane comes after.
  const [e0, n0] = usable[0].start
  const bounds = boundsFor(sourceEpsg)
  const inRange = (v, [lo, hi]) => v > lo && v < hi
  if (!inRange(e0, bounds.easting) || !inRange(n0, bounds.northing)) {
    return { tracks: [], errors: [...errors, `Koordinaten sehen nicht nach EPSG ${sourceEpsg} aus `
      + `(${e0.toFixed(1)}, ${n0.toFixed(1)}) – erwartet werden Rechts-/Hochwerte in Metern.`] }
  }
  if (crs !== sourceEpsg) {
    errors.push(`Koordinaten von EPSG ${sourceEpsg} nach ${crs} transformiert. `
      + 'Richtungswinkel, Längen und Radien wurden unverändert übernommen – '
      + 'weichen die Anschlüsse ab, gehören die Winkel nicht zum Zielsystem.')
  }

  const unsupported = usable.filter(r => UNSUPPORTED.includes(r.typ))
  if (unsupported.length) {
    errors.push(`${unsupported.length} Elemente mit S-Form übersprungen – im Datenmodell nicht abbildbar.`)
  }
  const known = usable.filter(r => !UNSUPPORTED.includes(r.typ))
  const strange = known.filter(r => ![TYPE_STRAIGHT, TYPE_KINK, TYPE_ARC, TYPE_CLOTHOID, TYPE_BLOSS].includes(r.typ))
  if (strange.length) {
    errors.push(`Unbekannte Elementtypen übersprungen: ${[...new Set(strange.map(r => r.typ))].join(', ')}`)
  }

  // Cant records for this line, keyed by their point-address pair.
  const cantByAddress = new Map()
  if (cantRows) {
    for (const c of cantRows) {
      if (c.strecke === String(strecke)) cantByAddress.set(addrKey(c.anf, c.end), c)
    }
    if (!cantByAddress.size) errors.push(`Keine Überhöhungen für Strecke ${strecke} in der Datei.`)
  }

  const chains = buildChains(known.filter(r => !strange.includes(r)))
  const tracks = []
  let cantMatched = 0
  let derivedBearings = 0
  chains.forEach((chain, ci) => {
    const elements = []
    chain.forEach((rec, i) => {
      const [e, n] = transformPlanePoint(rec.start[0], rec.start[1], sourceEpsg, crs)
      const prev = elements[elements.length - 1]
      // No start bearing in the file: carry on from where the predecessor ends
      // (see statesBearing). The first element of a chain has nothing to carry
      // on from, so it keeps what the file said and is reported.
      let bearing = rec.bearing
      if (!statesBearing(rec)) {
        if (prev) { bearing = resolveEndBearing(prev, crs); derivedBearings++ }
        else {
          errors.push(`Strecke ${strecke}, Gleis ${ci + 1}, Element 1 (${rec.typ}): `
            + 'kein Richtungswinkel (EELL_WINKEL_ANF = 0) und kein Vorgänger – 0 gon übernommen.')
        }
      }
      const el = buildElement({ ...rec, start: [e, n], bearing }, crs)
      if (i > 0) {
        const gap = Math.hypot(el.startNode[0] - prev.endNode[0], el.startNode[1] - prev.endNode[1])
        if (gap > JUNCTION_TOL) {
          errors.push(`Strecke ${strecke}, Gleis ${ci + 1}, Element ${i + 1} (${rec.typ}): `
            + `Anschluss-Abweichung ${(gap * 1000).toFixed(1)} mm`)
        }
      }
      elements.push(el)
    })
    if (elements.length) {
      if (cantByAddress.size) {
        cantMatched += applyCants(chain, elements, cantByAddress, errors,
          `Strecke ${strecke}, Gleis ${ci + 1}`)
      }
      tracks.push({
        name: `${strecke}.${String(ci + 1).padStart(3, '0')}`,
        lineNumber: String(strecke),
        epsg: crs,
        elements,
      })
    }
  })

  if (derivedBearings) {
    errors.push(`${derivedBearings} Elemente ohne Richtungswinkel (EELL_WINKEL_ANF = 0) – `
      + 'Anfangsrichtung aus dem Endwinkel des Vorgängers übernommen.')
  }

  if (cantByAddress.size) {
    const total = tracks.reduce((n, t) => n + t.elements.length, 0)
    if (cantMatched < total) {
      errors.push(`${total - cantMatched} von ${total} Elementen ohne Überhöhungssatz `
        + '– dort bleibt die Überhöhung 0.')
    }
  }

  return { tracks, errors }
}
