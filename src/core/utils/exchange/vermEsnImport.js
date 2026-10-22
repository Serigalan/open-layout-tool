import { unzipSync } from 'fflate'
import { generateId, nextTrackName, rebuildCoords } from '../track'
import { gradientStretch } from './proviImport'
import { arcFrom, straightFrom, transitionElement } from '../geometry'
import { axisLine, END_TOL, endMismatch, gradientOnTrack } from './vermEsnKmGradient'
import { withFileCants } from './fileCants'

const RECORD_SIZE = 78
const GRA_RECORD_SIZE = 36   // the header is one record long, too
const RAD2DEG = 180 / Math.PI

// Junction tolerance [m]: an element must start where the previous one ends.
// Source files quantize lengths to mm, so long elements can end up to a few
// tenths of a millimetre off the next record's start.
const JUNCTION_TOL = 0.0003   // 0.3 mm

function readRecord(view, offset) {
  const rec = {}
  rec.radiusB   = view.getFloat64(offset, true); offset += 8
  rec.radiusE   = view.getFloat64(offset, true); offset += 8
  rec.easting   = view.getFloat64(offset, true); offset += 8
  rec.northing  = view.getFloat64(offset, true); offset += 8
  rec.bearing   = view.getFloat64(offset, true); offset += 8
  rec.absLength = view.getFloat64(offset, true); offset += 8
  rec.type      = view.getInt16(offset,   true); offset += 2
  rec.length    = view.getFloat64(offset, true); offset += 8
  rec.cantB     = view.getFloat64(offset, true); offset += 8
  rec.cantE     = view.getFloat64(offset, true); offset += 8
  rec.index     = view.getFloat32(offset, true)
  return rec
}

function r3(v) { return Math.round(v * 1000) / 1000 }

/** Parse binary buffer into an array of raw records */
export function parseRecords(arrayBuffer) {
  const view    = new DataView(arrayBuffer)
  const count   = Math.floor(view.byteLength / RECORD_SIZE)
  const records = []
  for (let i = 0; i < count; i++) {
    records.push(readRecord(view, i * RECORD_SIZE))
  }
  return records
}

/**
 * Build element objects from parsed records. The records are interpreted
 * natively in the selected CRS (`epsg`, e.g. 25832 or 5683, applied at track
 * level by the caller): coordinates, grid bearings and lengths are taken
 * as-is — no reprojection. Only the display geometry is derived via WGS84.
 *
 * Record types: 0 = straight, 1 = circular arc, 2 = clothoid, 4 = Bloss curve,
 * 5 = straight with a kink at its END (radiusB holds the junction angle in
 * gon; the element's endBearing = bearing + (radiusB − 200) gon, which then
 * matches the next element's start bearing).
 * Types 3 and 6 are silently ignored, as are zero-length records. The last
 * element record is always ignored — it only marks the alignment's end point.
 *
 * Every record states the cant at its start and end, relative to its curve
 * (fileCants): an arc or straight takes it as its `cant`, a transition as
 * `cantStart`/`cantEnd` where its neighbours do not imply the same. The file
 * lays a cant ramp of one radius into a type 2 record with the same radius at
 * both ends: that is an arc (or, both 0, a straight) whose cant changes along
 * it, and comes in as one with its two ends (decision 355).
 *
 * Each element must start where the previous one ends (tolerance 0.3 mm);
 * violations are reported in `errors`. Returns { elements, errors, startStation,
 * stations } — `startStation` is the axis station [m] the first element begins
 * at, which is what a gradient of the same axis is stationed against;
 * `stations` the station each element's record names (a kilometrage line may
 * jump between two).
 */
export function buildElements(records, epsg) {
  const crs = Number(epsg)
  const elements = []
  const errors = []
  const stations = []
  const cants = []   // the file's cant at both ends of each element, curve-relative
  let prevIdx = -1
  let startStation = null

  // The last element record is the alignment's closing point — never imported.
  let lastValidIdx = -1
  for (let i = records.length - 1; i >= 0; i--) {
    if ([0, 1, 2, 4, 5].includes(records[i].type)) { lastValidIdx = i; break }
  }

  for (let idx = 0; idx < records.length; idx++) {
    const rec = records[idx]
    if (![0, 1, 2, 4, 5].includes(rec.type) || idx === lastValidIdx) continue
    if (!(rec.length > 0)) continue   // degenerate records carry no geometry

    // Junction check against the previously built element
    if (elements.length > 0) {
      const prevEnd = elements[elements.length - 1].endNode
      const gap = Math.hypot(rec.easting - prevEnd[0], rec.northing - prevEnd[1])
      if (gap > JUNCTION_TOL) {
        errors.push(`#${prevIdx + 1} → #${idx + 1}: Anschluss-Abweichung ${(gap * 1000).toFixed(2)} mm`)
      }
    }
    prevIdx = idx
    if (startStation == null) startStation = rec.absLength
    stations.push(rec.absLength)

    const start      = { easting: rec.easting, northing: rec.northing, zone: crs }
    const bearingDeg = ((rec.bearing * RAD2DEG) % 360 + 360) % 360   // bearing stored in radians (grid)
    cants.push({ start: rec.cantB, end: rec.cantE })
    // A transition of one radius at both ends changes nothing but the cant.
    const oneRadius = (rec.type === 2 || rec.type === 4) && Math.abs(rec.radiusB - rec.radiusE) < 0.0005
    const type = oneRadius ? (rec.radiusB ? 1 : 0) : rec.type

    if (type === 0 || type === 5) {
      // ── Straight (type 5: with a kink at its end) ──────────────────────────
      const sv = straightFrom(start, bearingDeg, rec.length)
      const kinkEndBearing = type === 5
        ? ((sv.bearing + (rec.radiusB - 200) * 0.9) % 360 + 360) % 360   // gon → degrees
        : undefined
      elements.push({
        ...sv,
        speed:       0,
        ...(kinkEndBearing !== undefined ? { endBearing: kinkEndBearing } : {}),
      })

    } else if (type === 1) {
      // ── Circular arc ───────────────────────────────────────────────────────
      const signedR = rec.radiusB !== 0 ? rec.radiusB : rec.radiusE
      const arc = arcFrom(start, bearingDeg, rec.length, signedR)
      elements.push({
        ...arc,
        speed:       0,
        radius:      r3(signedR),
      })

    } else if (type === 2 || type === 4) {
      // ── Transition curve: type 2 = clothoid, type 4 = Bloss ────────────────
      // radiusB = 0 → entry from straight; radiusE = 0 → exit to straight.
      const transitionType = rec.type === 4 ? 'bloss' : 'clothoid'
      const r1 = rec.radiusB !== 0 ? rec.radiusB : null
      const r2 = rec.radiusE !== 0 ? rec.radiusE : null
      elements.push(transitionElement(start, bearingDeg, rec.length, r1, r2, {
        transitionType, length: r3(rec.length), speed: 0,
      }).element)
    }
  }

  return { elements: withFileCants(elements, cants), errors, startStation, stations }
}

// ── Gradient (.GRA) ─────────────────────────────────────────────────────────

/**
 * The tangent polygon of a Verm.ESN gradient file: [{ station, z, rv? }],
 * ascending, stationed along the axis like the TRA file's elements.
 *
 * Layout: a header one record long whose first float64 is `num`, then `num`
 * points of station, height, radius of the vertical curve, tangent length (all
 * float64) and point number (int32). The radius is signed by crest or sag; the
 * model holds its magnitude.
 *
 * Behind the points the files met so far carry a closing record that is no
 * point of the gradient (its station jumps back into the middle) and padding.
 * Reading also stops at the first record whose station does not move on, in
 * case `num` ever counts that closing record too.
 */
export function parseGradient(arrayBuffer) {
  const view = new DataView(arrayBuffer)
  if (view.byteLength < GRA_RECORD_SIZE) return []
  const num = view.getFloat64(0, true)
  const fits = Math.floor((view.byteLength - GRA_RECORD_SIZE) / GRA_RECORD_SIZE)
  const count = Number.isInteger(num) && num >= 0 ? Math.min(num, fits) : fits
  const out = []
  for (let i = 0; i < count; i++) {
    const offset = GRA_RECORD_SIZE + i * GRA_RECORD_SIZE
    const station = view.getFloat64(offset, true)
    const z = view.getFloat64(offset + 8, true)
    const rv = Math.abs(view.getFloat64(offset + 16, true))
    if (!Number.isFinite(station) || !Number.isFinite(z)) break
    if (out.length && !(station > out[out.length - 1].station)) break
    out.push({ station, z, ...(rv > 0 ? { rv } : {}) })
  }
  return out
}

/**
 * The height system code the gradient names (`V00`, `N00`, … — the DB's own
 * codes, as in the ASCII interface's `EHSYS`): from the header, which some
 * writers fill after `num`, else from the file name (`…_V00_VR.GRA`). Null
 * where neither says. Only shown to help choosing the datum — the codes carry
 * no EPSG of their own.
 */
export function gradientHeightCode(arrayBuffer, fileName = '') {
  const bytes = new Uint8Array(arrayBuffer, 0, Math.min(arrayBuffer.byteLength, GRA_RECORD_SIZE))
  const head = String.fromCharCode(...bytes.subarray(8, 11))
  if (/^[A-Z]\d\d$/.test(head) && bytes[11] === 0) return head
  return /_([A-Z]\d\d)_[^_]*$/i.exec(fileName.replace(/\.gra$/i, ''))?.[1]?.toUpperCase() ?? null
}

/**
 * The gradient as the heights of the track built from the TRA file, stationed
 * from the track's begin (`startStation`, see buildElements). Where the
 * gradient covers only part of the track the heights do too (gradientStretch),
 * and a note says so. Returns { heights, notes } — heights null where the
 * gradient does not reach into the track at all.
 */
export function gradientHeights(points, startStation, length, { tolerance = null } = {}) {
  if (!points?.length || !Number.isFinite(startStation)) return { heights: null, notes: [] }
  const first = points[0].station
  const last = points[points.length - 1].station
  const range = `${first.toFixed(3)}–${last.toFixed(3)} m`
  const heights = tolerance == null
    ? gradientStretch(points, startStation, startStation + length)
    : gradientStretch(points, startStation, startStation + length, tolerance)
  if (!(heights?.length >= 2)) {
    return {
      heights: null,
      notes: [`Gradiente (${range}) liegt nicht im Stationsbereich der Achse `
        + `(${startStation.toFixed(3)}–${(startStation + length).toFixed(3)} m) – ohne Höhen importiert.`],
    }
  }
  const covered = heights[0].station <= (tolerance ?? 0.002) && heights[heights.length - 1].station >= length - (tolerance ?? 0.5)
  return {
    heights,
    notes: covered ? [] : [`Gradiente (${range}) deckt die Achse nicht ganz ab – dort bleibt das Gleis `
      + 'ohne Höhen. Sie lassen sich im Höhenprofil aus dem Gelände ergänzen.'],
  }
}

// ── Gradient along the kilometrage line ─────────────────────────────────────

/** A kilometrage line's file name ends in `S` behind a digit: `6340S`, `63400164S`, `6311-001S`. */
const isKmLineName = (name) => /\dS$/.test(name)

/** The line number a kilometrage line's file names: its first four digits, else the name without the `S`. */
export function kmLineNumber(name) {
  const digits = /^(\d{4})/.exec(name)?.[1]
  return digits ? Number(digits) : name.replace(/S$/, '')
}

/**
 * A TRA file as an axis in plane `epsg`: buildElements' { elements, errors,
 * startStation, stations } plus its `length` and, for laying off stations
 * and dropping perpendiculars, its `line` (axisLine).
 */
export function readAxis(buffer, epsg) {
  const built = buildElements(parseRecords(buffer), Number(epsg))
  const length = built.elements.reduce((sum, el) => sum + (el.length ?? 0), 0)
  return { ...built, startStation: built.startStation ?? 0, length, line: axisLine(built.elements, Number(epsg), built) }
}

/**
 * What a gradient (`points`, parseGradient) can be stationed along for the
 * track `axis` (readAxis): the track itself (`ref` null) and every
 * kilometrage line of `kmAxes` ([{ name, line }]) whose perpendiculars meet
 * the track, its points carried over (gradientOnTrack). Each as { ref,
 * points, lost, mismatch } — `mismatch` how far the gradient's ends lie from
 * the track's, summed. Best first: a gradient normally runs from one end of
 * its track to the other, so the one that ends closest to them is taken.
 */
export function gradientReferences(axis, points, kmAxes = []) {
  const from = axis.startStation, to = axis.startStation + axis.length
  const out = [{ ref: null, points, lost: [], mismatch: endMismatch(points, from, to) }]
  for (const km of kmAxes) {
    const carried = gradientOnTrack(points, km.line, axis.line)
    if (carried.points) out.push({ ref: km.name, ...carried, mismatch: endMismatch(carried.points, from, to) })
  }
  return out.sort((a, b) => a.mismatch - b.mismatch)
}

/**
 * The heights a track (`axis`) takes from a gradient stationed as `reference`
 * says (gradientReferences): along the track as gradientHeights reads it,
 * along a kilometrage line carried over, its ends taken as the track's where
 * they differ by at most END_TOL. Returns { heights, notes }.
 */
export function referencedHeights(reference, axis) {
  if (!reference.ref) return gradientHeights(reference.points, axis.startStation, axis.length)
  const fitted = gradientHeights(reference.points, axis.startStation, axis.length, { tolerance: END_TOL })
  const lost = reference.lost.length
    ? [`${reference.lost.length} Punkt(e) der Gradiente treffen das Gleis nicht senkrecht zur Kilometerlinie `
      + `${reference.ref} (km ${reference.lost.map(s => s.toFixed(3)).join(', ')} m) – weggelassen.`]
    : []
  return { heights: fitted.heights, notes: [...lost, ...fitted.notes] }
}

/**
 * Kilometrage lines (readAxis, with their `name`) as the `kmLines` a project
 * keeps (mdbKmLine): one per line number, WGS84 runs of `[lon, lat, metres]`
 * from the elements' drawn lines, a new run wherever the kilometrage jumps.
 * Marked `source: 'vermesn'`, so the shipped line of that number is not
 * fetched over it.
 */
export function kmLineEntries(kmAxes) {
  const byNumber = new Map()
  for (const km of kmAxes) {
    const lineNumber = kmLineNumber(km.name)
    if (!byNumber.has(lineNumber)) byNumber.set(lineNumber, [])
    const runs = byNumber.get(lineNumber)
    let run = null
    let at = null
    km.elements.forEach((el, i) => {
      const coords = el.geometry?.coordinates ?? []
      const len = el.length ?? 0
      if (coords.length < 2 || !(len > 0)) return
      const s0 = km.stations?.[i] ?? at ?? km.startStation
      if (!run || Math.abs(s0 - at) > 0.01) { run = []; runs.push(run) }
      const along = [0]
      for (let k = 1; k < coords.length; k++) {
        along.push(along[k - 1] + Math.hypot(coords[k][0] - coords[k - 1][0], coords[k][1] - coords[k - 1][1]))
      }
      const total = along[along.length - 1] || 1
      coords.forEach(([lon, lat], k) => {
        if (k === 0 && run.length) return
        run.push([lon, lat, Math.round((s0 + len * along[k] / total) * 1000) / 1000])
      })
      at = s0 + len
    })
  }
  return [...byNumber].map(([lineNumber, runs]) => ({
    id: `km-${lineNumber}`, lineNumber, crs: 'EPSG:4326', runs: runs.filter(r => r.length >= 2), source: 'vermesn',
  }))
}

// ── Batch (.zip) ────────────────────────────────────────────────────────────

/** The bytes of an archive entry as an ArrayBuffer of their own, as parseRecords and parseGradient read them. */
const ownBuffer = (data) => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)

/**
 * The Verm.ESN files of a zip, paired by name: a GRA belongs to the TRA whose
 * file name it shares up to the extension (case ignored, folders left out — a
 * file is known by its name alone, as in readProviArchive). A TRA whose name
 * ends in `S` behind a digit is a kilometrage line (isKmLineName), not a
 * track. `buffer` is the zip as an ArrayBuffer or Uint8Array.
 *
 * Returns { pairs, kmLines, orphans, duplicates } — `pairs` one per track TRA,
 * sorted by name, as { name, tra, gra, traFile, graFile } (name without
 * extension, tra/gra as ArrayBuffers, gra null where there is none);
 * `kmLines` the kilometrage lines as { name, traFile, tra }; `orphans` the GRA
 * files without a TRA; `duplicates` the files whose name came twice (the
 * first one is read).
 */
export function readVermEsnArchive(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const tras = new Map()
  const gras = new Map()
  const duplicates = []
  for (const [path, data] of Object.entries(unzipSync(bytes))) {
    const file = path.split('/').pop()
    // macOS keeps resource forks beside the files (`__MACOSX/…`, `._name`).
    if (!file || file.startsWith('._') || path.startsWith('__MACOSX/')) continue
    const match = /^(.+)\.(tra|gra)$/i.exec(file)
    if (!match) continue
    const into = match[2].toLowerCase() === 'tra' ? tras : gras
    const key = match[1].toLowerCase()
    if (into.has(key)) { duplicates.push(file); continue }
    into.set(key, { name: match[1], file, data: ownBuffer(data) })
  }
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })
  const pairs = [...tras.entries()]
    .filter(([, tra]) => !isKmLineName(tra.name))
    .map(([key, tra]) => ({
      name: tra.name, traFile: tra.file, tra: tra.data,
      graFile: gras.get(key)?.file ?? null, gra: gras.get(key)?.data ?? null,
    }))
    .sort(byName)
  const kmLines = [...tras.values()].filter(tra => isKmLineName(tra.name))
    .map(tra => ({ name: tra.name, traFile: tra.file, tra: tra.data }))
    .sort(byName)
  const orphans = [...gras.entries()].filter(([key]) => !tras.has(key)).map(([, g]) => g.file)
  return { pairs, kmLines, orphans, duplicates }
}

/**
 * The kilometrage lines of a batch read in plane `epsg`: { axes, errors } —
 * `axes` those that can be used (readAxis, with `name` and `traFile`),
 * `errors` the others as { file, errors }.
 */
export function readKmLines(kmLines, epsg) {
  const axes = []
  const errors = []
  for (const km of kmLines) {
    const axis = readAxis(km.tra, epsg)
    if (axis.errors.length || !axis.elements.length) errors.push({ file: km.traFile, errors: axis.errors })
    else axes.push({ ...axis, name: km.name, traFile: km.traFile })
  }
  return { axes, errors }
}

/**
 * Per pair with a gradient, what it can be stationed along (gradientReferences):
 * Map(name → refs, best first, each the kilometrage line's name or null for
 * the track itself) — for choosing before the import.
 */
export function batchReferences(pairs, kmAxes, epsg) {
  const out = new Map()
  for (const pair of pairs) {
    if (!pair.gra) continue
    const axis = readAxis(pair.tra, epsg)
    const points = parseGradient(pair.gra)
    if (axis.errors.length || !axis.elements.length || points.length < 2) continue
    out.set(pair.name, gradientReferences(axis, points, kmAxes).map(r => r.ref))
  }
  return out
}

/**
 * The tracks of a batch (readVermEsnArchive): every pair in plane `epsg`, its
 * gradient's heights in `heightEpsg`, named after the files — where the name is
 * taken already (`takenNames`, or by an earlier pair) the next free one after it.
 * A gradient is stationed along the track or along one of the kilometrage
 * lines `kmAxes` (readKmLines): as `references` names it per pair (Map name →
 * kilometrage line name, null for the track), else the best fit
 * (gradientReferences). A track whose gradient runs along a kilometrage line
 * takes its line number, and the line goes into the project with it.
 * A TRA that is unreadable or whose elements do not join is left out, as the
 * single import refuses it; a GRA that does not fit leaves its track without
 * heights.
 *
 * Returns { tracks, kmLines, files } — `kmLines` the project entries
 * (kmLineEntries) of the lines used; `files` one per pair as { name, traFile,
 * graFile, imported, trackId, count, heights, reference, startStation, length,
 * gradient, errors, notes } — `startStation` the station the axis begins at
 * and `gradient` its points in the track's own stationing or null, as a
 * reference axis of the same file takes them (survey buildReferenceAxis).
 */
export function buildVermEsnBatch(pairs, { epsg, heightEpsg = null, takenNames = [], kmAxes = [], references = new Map() }) {
  const names = new Set(takenNames)
  const tracks = []
  const files = []
  const used = new Set()
  for (const pair of pairs) {
    const axis = readAxis(pair.tra, epsg)
    const { elements, errors } = axis
    const file = {
      name: pair.name, traFile: pair.traFile, graFile: pair.graFile, imported: false, trackId: null, count: 0, heights: 0,
      reference: null, startStation: axis.startStation, length: axis.length, gradient: null, errors, notes: [],
    }
    files.push(file)
    if (errors.length || !elements.length) continue
    let heights = null
    let reference = null
    if (pair.gra) {
      const points = parseGradient(pair.gra)
      if (points.length < 2) file.notes.push('GRA ohne Gradiente (weniger als zwei Punkte) – ohne Höhen importiert.')
      else {
        const options = gradientReferences(axis, points, kmAxes)
        const chosen = references.has(pair.name) ? options.find(o => o.ref === references.get(pair.name)) : null
        reference = chosen ?? options[0]
        const fitted = referencedHeights(reference, axis)
        heights = fitted.heights
        file.notes.push(...fitted.notes)
      }
    }
    const name = names.has(pair.name) ? nextTrackName(pair.name, names) : pair.name
    names.add(name)
    const km = reference?.ref ? kmAxes.find(k => k.name === reference.ref) : null
    if (km) used.add(km)
    const id = generateId()
    tracks.push({
      id, name, epsg: Number(epsg), coordinates: rebuildCoords(elements), elements,
      ...(km ? { lineNumber: kmLineNumber(km.name) } : {}),
      ...(heights ? { heights, heightEpsg: Number(heightEpsg) } : {}),
    })
    Object.assign(file, {
      name, imported: true, trackId: id, count: elements.length, heights: heights?.length ?? 0,
      reference: km?.name ?? null, gradient: reference?.points ?? null,
    })
  }
  return { tracks, kmLines: kmLineEntries([...used]), files }
}
