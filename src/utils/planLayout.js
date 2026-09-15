import { MARGIN_MM, PAPER_FORMATS, makeTransform, drawingArea } from './planExport'
import { trackPathUtm, trackPointAt } from './planGeometry'
import { trackLength } from './heightUtils'

/**
 * Where the sheets of a plan sit and which way round they are.
 *
 * A plan is read along the track, so the sheet follows the track rather than
 * the compass: a lead track gives every sheet its centre and its rotation, and
 * a long alignment is cut into sheets along that track's stationing with an
 * overlap, so the join can be recognised on both sides.
 */

/** How far the drawing may reach before a sheet counts as too full [mm]. */
const FIT_INSET = 2
/** Points checked along the lead track when testing whether a sheet fits. */
const FIT_SAMPLES = 60
/** How often a sheet may be shortened before its span is accepted as it is. */
const MAX_SHRINK = 3

/** Compass bearing from one plane point to another. */
function bearingBetween(a, b) {
  return (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI + 360) % 360
}

/**
 * Rotation that lays a bearing along the page's x axis, left to right.
 * makeTransform turns the content clockwise, so the bearing has to travel the
 * remaining way to east (90°).
 */
export const rotationFor = (bearing) => ((90 - bearing) % 360 + 360) % 360

/** A track's own geometry is a switch symbol, not an alignment to plan along. */
const isBranchTrack = (track) => {
  const els = track.elements ?? []
  return els.length > 0 && els.every(el => el.switchBranch)
}

/** Bounding box of everything that gets drawn, in the plane. */
export function tracksBbox(tracks) {
  let minE = Infinity, minN = Infinity, maxE = -Infinity, maxN = -Infinity
  for (const track of tracks) {
    for (const c of trackPathUtm(track)) {
      for (let i = 1; i < c.length; i += 2) {
        if (c[i] < minE) minE = c[i]
        if (c[i] > maxE) maxE = c[i]
        if (c[i + 1] < minN) minN = c[i + 1]
        if (c[i + 1] > maxN) maxN = c[i + 1]
      }
    }
  }
  return Number.isFinite(minE) ? { minE, minN, maxE, maxN } : null
}

/** The track a plan is laid out along: the longest one that is not a switch. */
export function pickLeadTrack(tracks, leadTrackId = null) {
  const usable = tracks.filter(tr => (tr.elements ?? []).length > 0 && !isBranchTrack(tr))
  const pool = usable.length ? usable : tracks.filter(tr => (tr.elements ?? []).length > 0)
  if (leadTrackId) {
    const named = pool.find(tr => tr.id === leadTrackId)
    if (named) return named
  }
  return pool.reduce((best, tr) => (
    !best || trackLength(tr) > trackLength(best) ? tr : best
  ), null)
}

/** The rotation a mode asks for; 'auto' leaves it to the caller's geometry. */
function fixedRotation(mode, manualRot) {
  if (mode === 'north') return 0
  if (mode === 'south') return 180
  if (mode === 'manual') return ((manualRot % 360) + 360) % 360
  return null
}

/**
 * Move a sheet centre so that what is drawn sits in the middle of the paper.
 * A curved alignment leaves its own chord, so centring on the chord wastes the
 * sheet on one side and overflows on the other. The shift is measured on the
 * page and taken back into the plane through the inverse of the rotation.
 */
function centredOn(points, rotDeg, pageW, pageH, scaleDen, seed) {
  const transform = makeTransform(seed, pageW, pageH, scaleDen, rotDeg)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [e, n] of points) {
    const [x, y] = transform(e, n)
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  if (!Number.isFinite(minX)) return seed

  const mmPerM = 1000 / scaleDen
  const dRx = ((minX + maxX) / 2 - pageW / 2) / mmPerM
  const dRy = (pageH / 2 - (minY + maxY) / 2) / mmPerM
  const th = rotDeg * Math.PI / 180
  const cos = Math.cos(th)
  const sin = Math.sin(th)
  return { e: seed.e + dRx * cos - dRy * sin, n: seed.n + dRx * sin + dRy * cos }
}

/** Points along a station range of a track, for centring and fit tests. */
function rangePoints(track, from, to, n = FIT_SAMPLES) {
  const pts = []
  for (let i = 0; i <= n; i++) {
    const at = trackPointAt(track, from + (to - from) * i / n)
    if (at) pts.push(at.point)
  }
  return pts
}

/** Every drawn point of every track, in the plane. */
function allDrawnPoints(tracks) {
  const pts = []
  for (const track of tracks) {
    for (const c of trackPathUtm(track)) {
      for (let i = 1; i < c.length; i += 2) pts.push([c[i], c[i + 1]])
    }
  }
  return pts
}

/** Does every sampled point of `track` between two stations sit on the sheet? */
function stationRangeFits(track, from, to, transform, area) {
  return rangePoints(track, from, to).every(([e, n]) => {
    const [x, y] = transform(e, n)
    return x >= area.x + FIT_INSET && x <= area.x + area.w - FIT_INSET
      && y >= area.y + FIT_INSET && y <= area.y + area.h - FIT_INSET
  })
}

/** One sheet over a station range of the lead track. */
function sheetOver(track, from, to, pageW, pageH, scaleDen, mode, manualRot) {
  const a = trackPointAt(track, from)
  const b = trackPointAt(track, to)
  if (!a || !b) return null
  const rotDeg = fixedRotation(mode, manualRot) ?? rotationFor(bearingBetween(a.point, b.point))
  const chordMid = { e: (a.point[0] + b.point[0]) / 2, n: (a.point[1] + b.point[1]) / 2 }
  const center = centredOn(rangePoints(track, from, to), rotDeg, pageW, pageH, scaleDen, chordMid)
  return {
    center,
    rotDeg,
    station: [from, to],
    transform: makeTransform(center, pageW, pageH, scaleDen, rotDeg),
  }
}

/**
 * Lay out the sheets of a plan.
 *
 * @param {object} o
 * @param {Array}  o.tracks
 * @param {string} o.paperKey
 * @param {number} o.scaleDen
 * @param {'auto'|'north'|'south'|'manual'} o.mode   how the sheet is turned
 * @param {number} o.rotDeg        rotation for mode 'manual'
 * @param {string} o.leadTrackId   track the sheets follow (default: the longest)
 * @param {boolean} o.split        cut a long alignment into several sheets
 * @param {number} o.overlapM      overlap between neighbouring sheets [m]
 * @param {{next:string, prev:string}} o.jointText  labels, `{n}` = sheet number
 * @returns {{ sheets, leadTrack, fits, extent }}
 *          `fits` says whether everything drawn is inside the sheets.
 */
export function planSheets({
  tracks, paperKey, scaleDen, mode = 'auto', rotDeg = 0, leadTrackId = null,
  split = true, overlapM = 50, jointText = { next: 'Sheet {n} →', prev: '← Sheet {n}' },
}) {
  const [pageW, pageH] = PAPER_FORMATS[paperKey]
  const area = drawingArea(pageW, pageH)
  const mmPerM = 1000 / scaleDen
  const drawn = tracks.filter(tr => (tr.elements ?? []).length > 0)
  const lead = pickLeadTrack(drawn, leadTrackId)
  const bb = tracksBbox(drawn)
  const extent = bb
    ? { w: (bb.maxE - bb.minE) * mmPerM, h: (bb.maxN - bb.minN) * mmPerM }
    : { w: 0, h: 0 }

  // Nothing to lay out: keep a single empty sheet so the frame still prints.
  if (!lead || !bb) {
    const center = { e: bb ? (bb.minE + bb.maxE) / 2 : 0, n: bb ? (bb.minN + bb.maxN) / 2 : 0 }
    const rot = fixedRotation(mode, rotDeg) ?? 0
    return {
      leadTrack: null,
      fits: true,
      extent,
      sheets: [{
        center, rotDeg: rot, index: 0, count: 1, station: [0, 0], joints: [],
        transform: makeTransform(center, pageW, pageH, scaleDen, rot),
      }],
    }
  }

  const total = trackLength(lead)

  // One sheet for the whole thing, whenever that works out.
  const wholeRot = fixedRotation(mode, rotDeg)
    ?? rotationFor(bearingBetween(trackPointAt(lead, 0).point, trackPointAt(lead, total).point))
  const wholeCenter = centredOn(allDrawnPoints(drawn), wholeRot, pageW, pageH, scaleDen,
    { e: (bb.minE + bb.maxE) / 2, n: (bb.minN + bb.maxN) / 2 })
  const wholeTransform = makeTransform(wholeCenter, pageW, pageH, scaleDen, wholeRot)
  const wholeFits = everythingFits(drawn, wholeTransform, area)

  if (wholeFits || !split) {
    return {
      leadTrack: lead,
      fits: wholeFits,
      extent,
      sheets: [{
        center: wholeCenter, rotDeg: wholeRot, index: 0, count: 1,
        station: [0, total], joints: [], transform: wholeTransform,
      }],
    }
  }

  // Otherwise walk the lead track: each sheet holds as much of it as fits.
  const fullSpan = area.w / mmPerM
  const overlap = Math.min(Math.max(overlapM, 0), fullSpan / 2)
  const sheets = []
  let from = 0
  let guard = 0
  while (from < total - 1e-6 && guard++ < 500) {
    let span = fullSpan
    let sheet = null
    for (let shrink = 0; shrink <= MAX_SHRINK; shrink++) {
      const to = Math.min(from + span, total)
      sheet = sheetOver(lead, from, to, pageW, pageH, scaleDen, mode, rotDeg)
      if (!sheet) break
      if (stationRangeFits(lead, from, to, sheet.transform, area)) break
      if (shrink < MAX_SHRINK) span /= 2
    }
    if (!sheet) break
    sheets.push(sheet)
    const to = sheet.station[1]
    if (to >= total - 1e-6) break
    from = Math.max(to - overlap, from + span / 4)
  }

  const count = sheets.length
  return {
    leadTrack: lead,
    fits: true,
    extent,
    sheets: sheets.map((s, i) => ({
      ...s,
      index: i,
      count,
      joints: [
        ...(i > 0 ? [jointAt(lead, s.station[0] + overlap / 2, jointText.prev, i)] : []),
        ...(i < count - 1 ? [jointAt(lead, s.station[1] - overlap / 2, jointText.next, i + 2)] : []),
      ].filter(Boolean),
    })),
  }
}

function jointAt(track, station, template, sheetNumber) {
  const at = trackPointAt(track, station)
  if (!at) return null
  return { point: at.point, bearing: at.bearing, text: template.replace('{n}', sheetNumber) }
}

/** Is every drawn point of every track inside the drawing area? */
function everythingFits(tracks, transform, area) {
  for (const track of tracks) {
    for (const c of trackPathUtm(track)) {
      for (let i = 1; i < c.length; i += 2) {
        const [x, y] = transform(c[i], c[i + 1])
        if (x < area.x + FIT_INSET || x > area.x + area.w - FIT_INSET
          || y < area.y + FIT_INSET || y > area.y + area.h - FIT_INSET) return false
      }
    }
  }
  return true
}

export { MARGIN_MM, trackPointAt }
