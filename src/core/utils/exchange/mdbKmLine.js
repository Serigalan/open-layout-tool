import { buildElement } from './gleislageCsvImport'
import { elementTypeName, epsgForLagesystem, normStrecke } from './mdbImport'
import { mdbStation } from './mdbGradient'
import { clipRuns } from '../km'

/**
 * The kilometrage line of the DB ASCII interface (Satzart 24) as the
 * `kmLines` a project keeps.
 *
 * A kilometrage element is laid out like a track element of Satzart 21 — start
 * point, bearing in gon, length, radii, the same type codes — and carries the
 * kilometrage at both its ends (`EKAKM`, `EKEKM`, packed like the stations of
 * Satzart 11: mdbStation). Along the element the kilometrage runs with the
 * length, so every vertex of its drawn line takes the share of the way it is
 * along. Type 6 is not geometry but the kilometrage jump between two
 * elements: its length is the jump (negative where the kilometrage runs
 * back), and a run of the line ends there and the next begins.
 *
 * Which line an element belongs to is read from its start point (Satzart 11
 * names the line of every point; those of the kilometrage line carry
 * Richtungskennzeichen 3). The file states each element once per Lagesystem
 * it was computed in; the first is taken.
 *
 * What comes back has the shape of the line files shipped with the app —
 * WGS84 runs of `[lon, lat, metres]` — so everything that reads a kilometrage
 * reads this one too, to the millimetre where the shipped lines have whole
 * metres.
 */

const GON2DEG = 0.9
/** The kilometrage jump between two elements: no geometry. */
const EKTYP_JUMP = 6
/** Two kilometrages closer than this continue each other [m]. */
const SAME_KM = 0.01

const padKey = (a, b) => `${a}\u0000${b}`
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d

/** Distance [m] between two WGS84 points, flat — the vertices are metres apart. */
function step([lon1, lat1], [lon2, lat2]) {
  const k = Math.cos(((lat1 + lat2) / 2) * Math.PI / 180)
  return Math.hypot((lon2 - lon1) * 111320 * k, (lat2 - lat1) * 110574)
}

/** The vertices of one element with their kilometrage, or null where it cannot be laid out. */
function vertices(el, coords) {
  const typ = elementTypeName(el.typ)
  const epsg = epsgForLagesystem(el.sys)
  const start = coords.get(padKey(el.pad1, el.sys))
  const akm = mdbStation(el.akm)
  const ekm = mdbStation(el.ekm)
  if (!typ || !epsg || !start || akm == null || ekm == null || !(Number(el.p1) > 0)) return null
  const built = buildElement({
    typ, start, bearing: Number(el.ariwi) * GON2DEG, length: Number(el.p1), p2: Number(el.p2), p3: Number(el.p3),
  }, epsg)
  const line = built.geometry?.coordinates ?? []
  if (line.length < 2) return null
  const along = [0]
  for (let i = 1; i < line.length; i++) along.push(along[i - 1] + step(line[i - 1], line[i]))
  const total = along[along.length - 1] || 1
  return line.map(([lon, lat], i) => [round(lon, 8), round(lat, 8), round(akm + (ekm - akm) * along[i] / total, 3)])
}

/**
 * The lines of the file as runs, keyed by line number: Map(line → runs).
 * `lines` limits it to these line numbers (strings, as normStrecke spells them).
 */
export function mdbKmRuns(payload, lines = null) {
  const coords = new Map()
  for (const p of payload?.points ?? []) {
    if (Number.isFinite(p?.y) && Number.isFinite(p?.x)) coords.set(padKey(p.pad, p.sys), [p.y, p.x])
  }
  const lineOf = new Map()
  for (const s of payload?.stations ?? []) {
    if (s?.pad && !lineOf.has(s.pad)) lineOf.set(s.pad, normStrecke(s.strecke))
  }

  // Per line, the elements in file order with each pad pair once.
  const byLine = new Map()
  const seen = new Set()
  for (const el of payload?.km ?? []) {
    const line = lineOf.get(el?.pad1)
    if (!line || (lines && !lines.has(line))) continue
    const key = padKey(el.pad1, el.pad2)
    if (seen.has(key)) continue
    seen.add(key)
    if (!byLine.has(line)) byLine.set(line, [])
    byLine.get(line).push(el)
  }

  const out = new Map()
  for (const [line, elements] of byLine) {
    // Walk the chains the point addresses describe; a jump or a gap ends a run.
    const next = new Map()
    const into = new Set()
    for (const el of elements) {
      if (!next.has(el.pad1)) next.set(el.pad1, [])
      next.get(el.pad1).push(el)
      into.add(el.pad2)
    }
    const runs = []
    const used = new Set()
    const walk = (first) => {
      let run = []
      const close = () => { if (run.length >= 2) runs.push(run); run = [] }
      for (let el = first; el && !used.has(el); el = next.get(el.pad2)?.find(e => !used.has(e))) {
        used.add(el)
        if (Number(el.typ) === EKTYP_JUMP) { close(); continue }
        const v = vertices(el, coords)
        if (!v) { close(); continue }
        const last = run[run.length - 1]
        if (last && Math.abs(last[2] - v[0][2]) > SAME_KM) close()
        run = run.length ? [...run, ...v.slice(1)] : v
      }
      close()
    }
    for (const el of elements) if (!into.has(el.pad1)) walk(el)
    for (const el of elements) if (!used.has(el)) walk(el)
    if (runs.length) out.set(line, runs)
  }
  return out
}

/**
 * The `kmLines` entries for the lines `lines` names, cut to `box` (the
 * project's extent, projectBox) like the shipped ones. Each is marked
 * `source: 'mdb'`: it replaces the shipped line of that number in the
 * project, and ensureKmLines fetches nothing over it.
 */
export function mdbKmLines(payload, lines, box) {
  const wanted = new Set([...lines].map(normStrecke))
  const out = []
  for (const [line, runs] of mdbKmRuns(payload, wanted)) {
    const clipped = box ? clipRuns(runs, box) : runs
    if (!clipped.length) continue
    const lineNumber = /^\d+$/.test(line) ? Number(line) : line
    out.push({ id: `km-${lineNumber}`, lineNumber, crs: 'EPSG:4326', clip: box, runs: clipped, source: 'mdb' })
  }
  return out
}
