import { PAPER_FORMATS, TITLE_COLUMN_MM, drawingArea } from './planExport'
import {
  pathItem as path, textItem as text, lineItem as line, circlePath, cullItems, frameItems,
  fitSize, titleBlockFor, textWidth, STYLE,
} from './planModel'
import { schematicLayout, toPlane } from './planSchematic'
import { STATUSES, STATUS_COLOR, switchStatus } from './planStatus'
import { format } from '../locales/i18n'

/**
 * The schematic overview as a plan: the strip from planSchematic cut into
 * sheets along the kilometrage, drawn with the same primitives and the same
 * sheet furniture as the site plan, so the preview, the SVG and the PDF come
 * out of the same backends.
 */

/** Horizontal scales of the overview: denominator → mm per metre. */
export const SCHEMATIC_SCALES = { '5000': 5000, '10000': 10000, '25000': 25000, '50000': 50000 }

const SIDE_PAD = 10     // clear space inside the frame at both ends of the strip [mm]
const TOP_BAND = 24     // band for the station names [mm]
const BOTTOM_BAND = 18  // band for the kilometrage [mm]
const MAX_GAP = 10      // lane spacing, as the DB symbols are drawn [mm]
const MIN_GAP = 3       // below this the lanes no longer read apart [mm]
// A platform fills the gap beside its track from 2/10 to 8/10 of the way
// across, its edge lines 1/10 in from its long sides.
const PLATFORM_NEAR = 0.2
const PLATFORM_FAR = 0.8
const PLATFORM_EDGE = 0.1
const WEDGE_LEG = 3     // legs of a switch's triangle at full spacing [mm]
const KM_POST_R = 0.8   // kilometre post circle [mm]
const KM_POST_TEXT = 5.6 // from the post to its figure [mm]
// A switch number sits in the sharp angle of its switch beyond the triangle,
// clear of both strokes, an arrow before it pointing at the switch.
const SWITCH_TEXT = 2.117 // 6 pt [mm]
const CAP_HEIGHT = 0.72   // Helvetica's capitals, in text sizes
const SWITCH_CLEAR = 0.75 // from the track to the number [mm]
const ARROW_W = 0.55      // the arrow's length and height, in text sizes
const ARROW_H = 0.6
const ARROW_SPACE = 0.3   // between arrow and number, in text sizes

const STROKE = {
  track: 0.5,
  connector: 0.5,
  platformEdge: 0.25,
  ruler: 0.25,
  bracket: 0.25,
}
const LEGEND_ROW = 5    // legend line spacing [mm]

const PRIO = { station: 1, joint: 1, km: 2, switch: 3, track: 4 }

const fmt = (v, decimals, comma) => {
  const s = v.toFixed(decimals)
  return comma ? s.replace('.', ',') : s
}

/**
 * What the plan calls a switch: its number alone, without the leading zeros
 * of a generated name — switch.003 is 3, W 12a is 12a. A name without a
 * number stays as it is.
 */
export function switchNumber(name) {
  const str = String(name ?? '').trim()
  const m = /(\d+)\s*([a-z]?)$/i.exec(str)
  return m ? `${Number(m[1])}${m[2]}` : str
}

/**
 * A switch number beside the triangle at (x, y) that opens along `sx` and
 * across `sy`: the arrow nearest the switch pointing back at it, the number
 * beyond, both off the track on the side the branch leaves to.
 */
function switchLabel(x, y, { sx, sy, off, t, color }) {
  const s = SWITCH_TEXT
  const cap = CAP_HEIGHT * s
  const base = sy > 0 ? y + SWITCH_CLEAR + cap : y - SWITCH_CLEAR
  const mid = base - cap / 2
  const tip = x + sx * off
  const back = tip + sx * ARROW_W * s
  const arrow = path([['M', tip, mid], ['L', back, mid - ARROW_H * s / 2], ['L', back, mid + ARROW_H * s / 2], ['Z']],
    { stroke: null, fill: color })
  return text(back + sx * ARROW_SPACE * s, base, [{ t }],
    { size: s, align: sx > 0 ? 'left' : 'right', color, prio: PRIO.switch, marks: [arrow] })
}

/** A polyline as path commands. */
const poly = (pts) => pts.map((p, i) => [i ? 'L' : 'M', p[0], p[1]])

/**
 * Kilometrage marks every `step` metres between two x, out of the table the
 * layout read along the reference.
 */
function kmMarks(kmTable, xa, xb, step = 100) {
  const marks = []
  for (let i = 1; i < kmTable.length; i++) {
    const a = kmTable[i - 1]
    const b = kmTable[i]
    if (b.x < xa || a.x > xb || b.x - a.x < 1e-6) continue
    const lo = Math.min(a.km, b.km)
    const hi = Math.max(a.km, b.km)
    // A jump in the kilometrage is no stretch of line to mark.
    if (hi - lo > 3 * (b.x - a.x) + 50) continue
    for (let h = Math.ceil(lo / step) * step; h <= hi; h += step) {
      if (h === lo && i > 1) continue
      const t = (h - a.km) / (b.km - a.km || 1)
      const x = a.x + (b.x - a.x) * t
      if (x >= xa && x <= xb) marks.push({ x, km: h })
    }
  }
  return marks
}

/** Kilometre posts as often as the scale leaves room for their figures. */
const postStep = (scaleDen) => (scaleDen <= 5000 ? 500 : scaleDen <= 10000 ? 1000 : scaleDen <= 25000 ? 2000 : 5000)

/** Kilometrage at an x of the strip, read off the table the layout made. */
function kmAt(kmTable, x) {
  if (x <= kmTable[0].x) return kmTable[0].km
  for (let i = 1; i < kmTable.length; i++) {
    const a = kmTable[i - 1]
    const b = kmTable[i]
    if (x <= b.x) return a.km + (b.km - a.km) * (x - a.x) / (b.x - a.x || 1)
  }
  return kmTable[kmTable.length - 1].km
}

/**
 * What the title block says about one sheet: the stretch of the reference it
 * shows, for the location sketch, and its kilometrage, where the project has
 * a line to read it off.
 */
function sheetContext(layout, xa, xb, titleBlock, texts, comma) {
  const out = {}
  const sketch = titleBlock?.sketch
  if (sketch) {
    const line = layout.axis.filter(q => q.x >= xa && q.x <= xb).map(q => toPlane(q.p, layout.epsg, sketch.epsg))
    if (line.length > 1) out.focus = { line }
  }
  if (layout.kmKnown && texts.range) {
    const a = Math.max(xa, layout.extent[0])
    const b = Math.min(xb, layout.extent[1])
    const [ka, kb] = [kmAt(layout.kmTable, a), kmAt(layout.kmTable, b)].map(k => fmt(k / 1000, 1, comma))
    out.range = format(texts.range, { a: ka, b: kb })
  }
  return out
}

/**
 * Build the overview.
 *
 * @param {object} o
 * @param {Array}  o.tracks, o.switches, o.platforms, o.kmLines   project data
 * @param {string} o.leadTrackId  reference track (default: the longest strand)
 * @param {string} o.paperKey
 * @param {number} o.scaleDen     horizontal scale denominator
 * @param {object} o.titleBlock   as buildPlan takes it
 * @param {object} o.show         { km, switches, trackNames, platforms }
 * @param {object} o.texts        { next, prev, legend, range, status: { existing, new, removal } }
 *                                — `{n}` = sheet number, `{a}`/`{b}` = km
 * @param {boolean} o.comma
 * @returns {{ pageW, pageH, sheets, fits }} — `fits` false when the lanes had to be packed tighter than they read
 */
export function buildSchematicPlan({
  tracks, switches = [], platforms = [], kmLines = [], leadTrackId = null,
  paperKey, scaleDen, titleBlock, show = {}, texts = {}, comma = true, corridor,
}) {
  const [pageW, pageH] = PAPER_FORMATS[paperKey]
  const shown = { km: true, switches: true, trackNames: true, platforms: true, ...show }
  const reserve = titleBlock ? TITLE_COLUMN_MM : 0
  const area = drawingArea(pageW, pageH, reserve)
  const mmPerM = 1000 / scaleDen
  const layout = schematicLayout({ tracks, switches, platforms, kmLines, leadTrackId, corridor })

  const furniture = (sheet) => {
    const items = []
    if (titleBlock) {
      items.push(...titleBlockFor(pageW, pageH, { ...titleBlock, legend: null }, sheet))
      const legend = [texts.legend, titleBlock.legend].filter(Boolean).join(' · ')
      const x = area.x + area.w + 3
      if (legend) {
        items.push(text(x, area.y + 5, [{ t: legend }], { size: fitSize(legend, STYLE.sizeLegend, reserve - 6) }))
      }
      // What the colours of the tracks and switches say.
      STATUSES.forEach((status, k) => {
        const label = texts.status?.[status]
        if (!label) return
        const y = area.y + 5 + (k + 1) * LEGEND_ROW
        items.push(line(x, y - 0.8, x + 8, y - 0.8, { width: STROKE.track, stroke: STATUS_COLOR[status] }))
        items.push(text(x + 10, y, [{ t: label }], { size: STYLE.sizeLegend }))
      })
    }
    items.push(...frameItems(pageW, pageH))
    return items
  }

  if (!layout) {
    const sheet = { index: 0, count: 1 }
    return { pageW, pageH, fits: true, sheets: [{ ...sheet, items: furniture(sheet) }] }
  }

  const [xa, xb] = layout.extent
  const span = (area.w - 2 * SIDE_PAD) / mmPerM
  const count = Math.max(1, Math.ceil((xb - xa) / span - 1e-9))
  const origin = (i) => (count === 1 ? (xa + xb) / 2 - span / 2 : xa + i * span)
  const trackById = new Map(tracks.map(tr => [tr.id, tr]))
  const statusOf = (node) => switchStatus(node.sw, trackById)

  // Each sheet closes up the lanes it has nothing on, so neighbouring tracks
  // are always one gap apart; and every sheet uses the same gap, the widest
  // that lets the fullest of them fit.
  const reach = 2 * MAX_GAP / mmPerM
  const sheetLanes = Array.from({ length: count }, (_, i) => {
    const a = origin(i) - reach
    const b = origin(i) + span + reach
    const used = new Set()
    for (const st of layout.strands) {
      if (st.lane != null && !st.connector) {
        for (const sc of st.sections) if (sc.lane != null && sc.x1 >= a && sc.x0 <= b) used.add(sc.lane)
      }
      if (st.connector && st.x1 >= a && st.x0 <= b) {
        for (const n of st.endNodes) if (n?.lane != null) used.add(n.lane)
      }
    }
    return [...used].sort((p, q) => p - q)
  })
  const yTop = area.y + TOP_BAND
  const yBot = area.y + area.h - BOTTOM_BAND
  const most = Math.max(1, ...sheetLanes.map(l => l.length))
  const rawGap = most > 1 ? (yBot - yTop) / (most - 1) : MAX_GAP
  const gap = Math.min(MAX_GAP, rawGap)
  const yMid = (yTop + yBot) / 2
  const dxOf = (dyMm) => Math.abs(dyMm) / mmPerM
  const leg = Math.min(WEDGE_LEG, WEDGE_LEG * gap / MAX_GAP)

  /** Page y of a lane on a sheet that shows `lanes`, the highest lane on top. */
  const laneY = (lanes) => (lane) => {
    let rank = lanes.indexOf(lane)
    // A lane only touched from beyond the sheet sits between its neighbours.
    if (rank < 0) rank = lanes.filter(l => l < lane).length - 0.5
    return yMid - (rank - (lanes.length - 1) / 2) * gap
  }

  const drawable = (n) => n && !n.outside && n.lane != null

  /**
   * The strip for one lane spacing, in metres along x and page millimetres
   * across. A connection between two lanes is always drawn at 45°: where the
   * two switches of a crossover lie closer than that allows, they are drawn
   * spread evenly about their middle, and where they lie further apart the
   * diagonal takes the middle of the stretch — a schematic can afford a
   * switch a little off its place, not a steep stroke through the lanes.
   */
  function stripFor(Y) {
    const strip = []
    const at = new Map()
    // Each wedged switch with the way its triangle opens — along x, and across.
    const wedged = new Map()
    const wedge = (node, x, y, sx, sy) => {
      if (!shown.switches || node.link) return
      if (!wedged.has(node)) wedged.set(node, { sx, sy })
      const l = leg / mmPerM
      strip.push({ kind: 'fill', pts: [[x, y], [x + sx * l, y], [x + sx * l, y + sy * leg]], color: STATUS_COLOR[statusOf(node)] })
    }

    for (const st of layout.strands) {
      if (!st.connector) continue
      const [n1, n2] = st.endNodes
      if (!drawable(n1) || !drawable(n2) || at.has(n1) || at.has(n2)) continue
      const rise = dxOf(Y(n2.lane) - Y(n1.lane))
      const mid = (n1.x + n2.x) / 2
      const s = Math.sign(n2.x - n1.x) || 1
      at.set(n1, mid - s * rise / 2)
      at.set(n2, mid + s * rise / 2)
    }
    const nodeX = (n) => at.get(n) ?? n.x

    for (const st of layout.strands) {
      if (st.lane == null || st.connector) continue
      // Only what lies in the corridor is drawn; a strand's end beyond it has
      // no switch on the sheet to run on to.
      const secs = st.sections.filter(sc => sc.inside && sc.lane != null)
      if (!secs.length) continue
      const last = secs.length - 1
      const whole = st.sections
      const endIn = [secs[0] === whole[0], secs[last] === whole[whole.length - 1]]
      // Which way the strand runs along x, so its sections can be walked in order.
      const d = secs[0].dir
      const startOf = (sc) => (d > 0 ? sc.x0 : sc.x1)
      const endOf = (sc) => (d > 0 ? sc.x1 : sc.x0)
      // Where each section begins and ends along x, in the strand's own order.
      const from = secs.map(startOf)
      const to = secs.map(endOf)

      // The strand's two ends: on to the switch it ends at, or — where it is a
      // branch — a diagonal from that switch onto its own lane.
      st.endNodes.forEach((node, i) => {
        if (!endIn[i] || !drawable(node)) return
        const k = i === 0 ? 0 : last
        const sc = secs[k]
        const nx = nodeX(node)
        if (!st.endAttached[i] || node.lane === sc.lane) {
          if (i === 0) from[0] = d > 0 ? Math.min(from[0], nx) : Math.max(from[0], nx)
          else to[last] = d > 0 ? Math.max(to[last], nx) : Math.min(to[last], nx)
          return
        }
        const y = Y(sc.lane)
        const yn = Y(node.lane)
        const inward = i === 0 ? d : -d
        const land = nx + inward * dxOf(yn - y)
        strip.push({ kind: 'line', pts: [[nx, yn], [land, y]], width: STROKE.connector, color: STATUS_COLOR[sc.status] })
        wedge(node, nx, yn, inward, Math.sign(y - yn))
        if (i === 0) from[0] = land
        else to[last] = land
      })

      // Between two sections, the switch that joins them; where the lanes
      // differ the track steps across at 45°, in the section beyond the toe.
      secs.slice(0, -1).forEach((a, i) => {
        const b = secs[i + 1]
        const k = whole.indexOf(a)
        // Two sections meet at a switch only where no section left out lies between them.
        const node = whole[k + 1] === b ? st.junctions[k] : null
        const jx = node && drawable(node) ? nodeX(node) : (to[i] + from[i + 1]) / 2
        to[i] = jx
        from[i + 1] = jx
        if (a.lane === b.lane) return
        const stepIn = node?.home === b ? a : b
        const away = stepIn === b ? d : -d
        const [lFrom, lTo] = stepIn === b ? [a.lane, b.lane] : [b.lane, a.lane]
        const land = jx + away * dxOf(Y(lTo) - Y(lFrom))
        strip.push({ kind: 'line', pts: [[jx, Y(lFrom)], [land, Y(lTo)]], width: STROKE.track, color: STATUS_COLOR[stepIn.status] })
        if (stepIn === b) from[i + 1] = land
        else to[i] = land
      })

      secs.forEach((sc, i) => {
        const lo = Math.min(from[i], to[i])
        const hi = Math.max(from[i], to[i])
        // A section shorter than its step has no straight of its own.
        if ((to[i] - from[i]) * d <= 0) return
        strip.push({ kind: 'line', pts: [[lo, Y(sc.lane)], [hi, Y(sc.lane)]], width: STROKE.track, color: STATUS_COLOR[sc.status] })
        sc.drawn = [lo, hi]
      })

      if (shown.trackNames) {
        // One label per run of sections that share a name and a lane.
        const runs = []
        for (const sc of secs) {
          if (!sc.drawn) continue
          const lastRun = runs[runs.length - 1]
          if (lastRun && lastRun.name === sc.name && lastRun.lane === sc.lane) {
            lastRun.x0 = Math.min(lastRun.x0, sc.drawn[0])
            lastRun.x1 = Math.max(lastRun.x1, sc.drawn[1])
          } else if (sc.name) {
            runs.push({ name: sc.name, lane: sc.lane, x0: sc.drawn[0], x1: sc.drawn[1] })
          }
        }
        for (const r of runs) {
          strip.push({ kind: 'label', x: (r.x0 + r.x1) / 2, y: Y(r.lane) - 0.5, t: r.name, size: 1.8,
            prio: PRIO.track, room: (r.x1 - r.x0) * mmPerM })
        }
      }
    }

    for (const st of layout.strands) {
      if (!st.connector) continue
      const [n1, n2] = st.endNodes
      if (!drawable(n1) || !drawable(n2)) continue
      const [a, b] = [nodeX(n1), nodeX(n2)]
      const [y1, y2] = [Y(n1.lane), Y(n2.lane)]
      const status = st.sections.find(sc => sc.status !== 'existing')?.status ?? 'existing'
      strip.push({ kind: 'line', pts: [[a, y1], [b, y2]], width: STROKE.connector, color: STATUS_COLOR[status] })
      const sx = Math.sign(b - a) || 1
      const sy = Math.sign(y2 - y1)
      wedge(n1, a, y1, sx, sy)
      wedge(n2, b, y2, -sx, -sy)
    }

    if (shown.switches) {
      for (const node of layout.nodes) {
        if (node.link || !drawable(node)) continue
        const y = Y(node.lane)
        // A switch whose branch leaves the strip has no diagonal to set its
        // triangle in, so it keeps a point.
        const color = STATUS_COLOR[statusOf(node)]
        const open = wedged.get(node)
        if (!open) strip.push({ kind: 'dot', x: nodeX(node), y, color })
        const number = switchNumber(node.sw.name)
        if (!number) continue
        if (open) {
          // In the sharp angle beside the triangle, as far out as the diagonal
          // leaves room for the figure's height.
          const off = Math.max(leg, SWITCH_CLEAR + CAP_HEIGHT * SWITCH_TEXT + 0.3)
          strip.push({ kind: 'switch', x: nodeX(node), y, ...open, off, t: number, color })
          continue
        }
        // The label goes to the side the branch does not leave to.
        const others = [...node.attach].map(k => {
          const sc = layout.sectionOfTrack.get(k.split(':')[0])
          if (!sc) return null
          if (!sc.strand.connector) return sc.lane ?? null
          const far = sc.strand.endNodes.find(n => n && n !== node)
          return far?.lane ?? null
        }).filter(l => l != null)
        const up = others.some(l => l > node.lane)
        strip.push({ kind: 'label', x: nodeX(node), y: up ? y + 3.2 : y - 1.6, t: number, size: SWITCH_TEXT,
          color, prio: PRIO.switch })
      }
    }

    if (shown.platforms) {
      // A platform sits in the gap beside its track, its edges drawn along
      // both long sides, as the DB symbol has it.
      for (const pf of layout.platforms) {
        const y = Y(pf.lane)
        const s = pf.up ? -1 : 1
        const [near, far] = [y + s * PLATFORM_NEAR * gap, y + s * PLATFORM_FAR * gap]
        strip.push({ kind: 'platform', x0: pf.x0, x1: pf.x1, y0: Math.min(near, far), y1: Math.max(near, far) })
      }
    }
    return strip
  }

  const stations = new Map()
  if (shown.platforms) {
    for (const pf of layout.platforms) {
      const name = String(pf.platform.stationName ?? '').trim()
      const code = String(pf.platform.code ?? '').trim().toUpperCase()
      const key = name.toLowerCase() || code
      if (!key) continue
      const st = stations.get(key) ?? { name, code, x0: pf.x0, x1: pf.x1 }
      st.x0 = Math.min(st.x0, pf.x0)
      st.x1 = Math.max(st.x1, pf.x1)
      if (!st.name && name) st.name = name
      if (!st.code && code) st.code = code
      stations.set(key, st)
    }
  }

  const marks = shown.km ? kmMarks(layout.kmTable, xa - span, xb + span) : []
  const posts = shown.km ? kmMarks(layout.kmTable, xa - span, xb + span, postStep(scaleDen)) : []

  const sheets = []
  for (let i = 0; i < count; i++) {
    const x0 = origin(i)
    const X = (x) => area.x + SIDE_PAD + (x - x0) * mmPerM
    const lanes = sheetLanes[i]
    const Y = laneY(lanes)
    const inner = []

    const yr = area.y + area.h - BOTTOM_BAND + 6
    for (const m of marks) {
      const px = X(m.x)
      const major = m.km % 1000 === 0
      const half = m.km % 500 === 0
      if (!major && !half && 100 * mmPerM < 2) continue
      inner.push(line(px, yr, px, yr - (major ? 3 : half ? 2 : 1.2), { width: STROKE.ruler }))
      if (major) {
        inner.push(text(px, yr + 3.5, [{ t: `km ${fmt(m.km / 1000, 1, comma)}` }],
          { size: 2.5, align: 'center', prio: PRIO.km }))
      }
    }
    if (marks.length) {
      inner.push(line(Math.max(area.x, X(xa)), yr, Math.min(area.x + area.w, X(xb)), yr, { width: STROKE.ruler }))
    }

    // The kilometre posts ride in the gap next to the reference, below it
    // where the sheet has a track there.
    if (posts.length && lanes.length) {
      const below = lanes.some(l => l < 0)
      const yp = Y(0) + (below || !lanes.some(l => l > 0) ? 1 : -1) * gap / 2
      for (const p of posts) {
        const px = X(p.x)
        inner.push(path(circlePath(px, yp, KM_POST_R), { width: STROKE.track, fill: '#ffffff' }))
        inner.push(text(px + KM_POST_TEXT, yp + 0.9, [{ t: fmt(p.km / 1000, 1, comma) }],
          { size: 2.47, bold: true, prio: PRIO.km }))
      }
    }

    for (const it of stripFor(Y)) {
      if (it.kind === 'line') {
        inner.push(path(poly(it.pts.map(([x, y]) => [X(x), y])), { width: it.width, stroke: it.color }))
      } else if (it.kind === 'fill') {
        inner.push(path([...poly(it.pts.map(([x, y]) => [X(x), y])), ['Z']], { stroke: null, fill: it.color }))
      } else if (it.kind === 'dot') {
        inner.push(path(circlePath(X(it.x), it.y, 0.55), { stroke: null, fill: it.color }))
      } else if (it.kind === 'platform') {
        const [a, b] = [X(it.x0), X(it.x1)]
        const edge = PLATFORM_EDGE * gap
        inner.push(path([['M', a, it.y0], ['L', b, it.y0], ['L', b, it.y1], ['L', a, it.y1], ['Z']],
          { width: STROKE.track, fill: '#ffffff' }))
        inner.push(line(a, it.y0 + edge, b, it.y0 + edge, { width: STROKE.platformEdge }))
        inner.push(line(a, it.y1 - edge, b, it.y1 - edge, { width: STROKE.platformEdge }))
      } else if (it.kind === 'label') {
        if (it.room != null && it.room < textWidth([{ t: it.t }], it.size) + 2) continue
        inner.push(text(X(it.x), it.y, [{ t: it.t }],
          { size: it.size, align: 'center', color: it.color, prio: it.prio }))
      } else if (it.kind === 'switch') {
        inner.push(switchLabel(X(it.x), it.y, it))
      }
    }

    for (const st of stations.values()) {
      const a = X(st.x0)
      const b = X(st.x1)
      const yb = area.y + 13
      inner.push(line(a, yb, b, yb, { width: STROKE.bracket }))
      inner.push(line(a, yb, a, yb + 1.5, { width: STROKE.bracket }))
      inner.push(line(b, yb, b, yb + 1.5, { width: STROKE.bracket }))
      const title = st.name || st.code
      inner.push(text((a + b) / 2, area.y + 7, [{ t: title }],
        { size: 3.0, align: 'center', bold: true, prio: PRIO.station }))
      if (st.name && st.code) {
        inner.push(text((a + b) / 2, area.y + 11, [{ t: st.code }], { size: 2.2, align: 'center', prio: PRIO.station }))
      }
    }

    if (i > 0 && texts.prev) {
      inner.push(text(area.x + 2, area.y + 4, [{ t: format(texts.prev, { n: i }) }], { size: 2.5, prio: PRIO.joint }))
    }
    if (i < count - 1 && texts.next) {
      inner.push(text(area.x + area.w - 2, area.y + 4, [{ t: format(texts.next, { n: i + 2 }) }],
        { size: 2.5, align: 'right', prio: PRIO.joint }))
    }

    const sheet = { index: i, count, ...sheetContext(layout, x0, x0 + span, titleBlock, texts, comma) }
    sheets.push({
      index: i, count,
      items: [{ type: 'group', clip: area, items: cullItems(inner, area) }, ...furniture(sheet)],
    })
  }

  return { pageW, pageH, sheets, fits: rawGap >= MIN_GAP, lanes: most, gap }
}
