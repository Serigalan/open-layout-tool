import { COMPACT_BLOCK_MM, PAPER_FORMATS, TITLE_COLUMN_MM, drawingArea } from './planExport'
import {
  pathItem as path, textItem as text, lineItem as line, circlePath, cullItems, frameItems,
  fitSize, titleBlockFor, textWidth, STYLE,
} from './planModel'
import { schematicLayout } from './planSchematic'

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
const MAX_GAP = 10      // widest lane spacing [mm]
const MIN_GAP = 3       // below this the lanes no longer read apart [mm]
const PLATFORM_NEAR = 1.0
const PLATFORM_FAR = 2.4

const STROKE = {
  track: 0.5,
  connector: 0.5,
  platform: 0.2,
  ruler: 0.25,
  grid: 0.15,
  bracket: 0.25,
}
const GRID_COLOR = '#c8c8c8'
const PLATFORM_FILL = '#b4b4b4'

const PRIO = { station: 1, joint: 1, km: 2, switch: 3, track: 4 }

const fmt = (v, decimals, comma) => {
  const s = v.toFixed(decimals)
  return comma ? s.replace('.', ',') : s
}

/** A polyline as path commands. */
const poly = (pts) => pts.map((p, i) => [i ? 'L' : 'M', p[0], p[1]])

/** Kilometrage marks between two x, out of the table the layout read along the reference. */
function kmMarks(kmTable, xa, xb) {
  const marks = []
  for (let i = 1; i < kmTable.length; i++) {
    const a = kmTable[i - 1]
    const b = kmTable[i]
    if (b.x < xa || a.x > xb || b.x - a.x < 1e-6) continue
    const lo = Math.min(a.km, b.km)
    const hi = Math.max(a.km, b.km)
    // A jump in the kilometrage is no stretch of line to mark.
    if (hi - lo > 3 * (b.x - a.x) + 50) continue
    for (let h = Math.ceil(lo / 100) * 100; h <= hi; h += 100) {
      if (h === lo && i > 1) continue
      const t = (h - a.km) / (b.km - a.km || 1)
      const x = a.x + (b.x - a.x) * t
      if (x >= xa && x <= xb) marks.push({ x, km: h })
    }
  }
  return marks
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
 * @param {object} o.texts        { next, prev, legend } — `{n}` = sheet number
 * @param {boolean} o.comma
 * @returns {{ pageW, pageH, sheets, fits }} — `fits` false when the lanes had to be packed tighter than they read
 */
export function buildSchematicPlan({
  tracks, switches = [], platforms = [], kmLines = [], leadTrackId = null,
  paperKey, scaleDen, titleBlock, show = {}, texts = {}, comma = true, corridor,
}) {
  const [pageW, pageH] = PAPER_FORMATS[paperKey]
  const shown = { km: true, switches: true, trackNames: true, platforms: true, ...show }
  const reserve = titleBlock?.full ? TITLE_COLUMN_MM : COMPACT_BLOCK_MM
  const area = drawingArea(pageW, pageH, reserve)
  const mmPerM = 1000 / scaleDen
  const layout = schematicLayout({ tracks, switches, platforms, kmLines, leadTrackId, corridor })

  const furniture = (sheet) => {
    const items = [...frameItems(pageW, pageH, reserve)]
    if (titleBlock) {
      items.push(...titleBlockFor(pageW, pageH, { ...titleBlock, legend: null }, sheet))
      const legend = [texts.legend, titleBlock.legend].filter(Boolean).join(' · ')
      if (legend) {
        const x = pageW - area.x - reserve + 3
        items.push(text(x, area.y + 5, [{ t: legend }], { size: fitSize(legend, STYLE.sizeLegend, reserve - 6) }))
      }
    }
    return items
  }

  if (!layout) {
    const sheet = { index: 0, count: 1 }
    return { pageW, pageH, fits: true, sheets: [{ ...sheet, items: furniture(sheet) }] }
  }

  const [xa, xb] = layout.extent
  const [lmin, lmax] = layout.lanes
  const span = (area.w - 2 * SIDE_PAD) / mmPerM
  const count = Math.max(1, Math.ceil((xb - xa) / span - 1e-9))
  const origin = (i) => (count === 1 ? (xa + xb) / 2 - span / 2 : xa + i * span)

  const yTop = area.y + TOP_BAND
  const yBot = area.y + area.h - BOTTOM_BAND
  const rawGap = lmax > lmin ? (yBot - yTop) / (lmax - lmin) : MAX_GAP
  const gap = Math.min(MAX_GAP, rawGap)
  const yMid = (yTop + yBot) / 2
  const Y = (lane) => yMid - (lane - (lmax + lmin) / 2) * gap
  const dxOf = (dyMm) => Math.abs(dyMm) / mmPerM

  // The strip in metres along x and page millimetres across; each sheet only
  // shifts it.
  const strip = []
  const laneOf = new Map(layout.strands.filter(s => s.lane != null).map(s => [s, s.lane]))
  const drawable = (n) => n && !n.outside && n.lane != null

  // A crossover shorter than a 45° run across the lanes is drawn at 45°
  // anyway, spread evenly about its middle: the two switches then sit a
  // little apart from their true place, which a schematic can afford and a
  // steep stroke through the neighbouring lanes cannot.
  const spread = new Map()
  for (const st of layout.strands) {
    if (!st.connector) continue
    const [n1, n2] = st.endNodes
    if (!drawable(n1) || !drawable(n2) || spread.has(n1) || spread.has(n2)) continue
    const rise = dxOf(Y(n2.lane) - Y(n1.lane))
    const run = Math.abs(n2.x - n1.x)
    if (run >= rise) continue
    const mid = (n1.x + n2.x) / 2
    const s = Math.sign(n2.x - n1.x) || 1
    spread.set(n1, mid - s * rise / 2)
    spread.set(n2, mid + s * rise / 2)
  }
  const nodeX = (n) => spread.get(n) ?? n.x

  for (const st of layout.strands) {
    if (st.lane == null) continue
    const y = Y(st.lane)
    let lo = st.x0
    let hi = st.x1
    st.endNodes.forEach((node, i) => {
      if (!drawable(node)) return
      const low = node.x <= (st.x0 + st.x1) / 2
      const nx = nodeX(node)
      if (!st.endAttached[i] || node.lane === st.lane) {
        if (low) lo = Math.min(lo, nx)
        else hi = Math.max(hi, nx)
        return
      }
      const dir = low ? 1 : -1
      const land = nx + dir * dxOf(Y(node.lane) - y)
      strip.push({ kind: 'line', pts: [[nx, Y(node.lane)], [land, y]], width: STROKE.connector })
      if (low) lo = land
      else hi = land
    })
    if (hi > lo) strip.push({ kind: 'line', pts: [[lo, y], [hi, y]], width: STROKE.track })

    if (shown.trackNames) {
      // One label per run of tracks that share a name.
      const runs = []
      for (const n of [...st.named].sort((a, b) => a.x0 - b.x0)) {
        const last = runs[runs.length - 1]
        if (last && last.name === n.name && n.x0 <= last.x1 + 1) last.x1 = Math.max(last.x1, n.x1)
        else if (n.name) runs.push({ ...n })
      }
      for (const r of runs) {
        const x0 = Math.max(r.x0, lo)
        const x1 = Math.min(r.x1, hi)
        if (x1 <= x0) continue
        strip.push({ kind: 'label', x: (x0 + x1) / 2, y: y - 0.9, t: r.name, size: 1.8,
          prio: PRIO.track, room: (x1 - x0) * mmPerM })
      }
    }
  }

  for (const st of layout.strands) {
    if (!st.connector) continue
    const [n1, n2] = st.endNodes
    if (!drawable(n1) || !drawable(n2)) continue
    const y1 = Y(n1.lane)
    const y2 = Y(n2.lane)
    const [a, b] = [nodeX(n1), nodeX(n2)]
    const rise = dxOf(y2 - y1)
    const mid = (a + b) / 2
    const s = Math.sign(b - a) || 1
    const pts = Math.abs(b - a) >= rise - 1e-6
      ? [[a, y1], [mid - s * rise / 2, y1], [mid + s * rise / 2, y2], [b, y2]]
      : [[a, y1], [b, y2]]
    strip.push({ kind: 'line', pts, width: STROKE.connector })
  }

  if (shown.switches) {
    for (const node of layout.nodes) {
      if (node.link || !drawable(node)) continue
      const y = Y(node.lane)
      strip.push({ kind: 'dot', x: nodeX(node), y })
      const name = String(node.sw.name ?? '').trim()
      if (!name) continue
      // The label goes to the side the branch does not leave to.
      const others = [...node.attach].map(k => {
        const st = layout.strands.find(s => s.ends.includes(k))
        if (!st) return null
        if (!st.connector) return laneOf.get(st) ?? null
        const far = st.endNodes.find(n => n && n !== node)
        return far?.lane ?? null
      }).filter(l => l != null)
      const up = others.some(l => l > node.lane)
      strip.push({ kind: 'label', x: nodeX(node), y: up ? y + 3.2 : y - 1.6, t: name, size: 2.0, prio: PRIO.switch })
    }
  }

  const stations = new Map()
  if (shown.platforms) {
    for (const pf of layout.platforms) {
      const y = Y(pf.lane)
      const [a, b] = pf.up ? [y - PLATFORM_FAR, y - PLATFORM_NEAR] : [y + PLATFORM_NEAR, y + PLATFORM_FAR]
      strip.push({ kind: 'rect', x0: pf.x0, x1: pf.x1, y0: a, y1: b })
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

  const sheets = []
  for (let i = 0; i < count; i++) {
    const x0 = origin(i)
    const X = (x) => area.x + SIDE_PAD + (x - x0) * mmPerM
    const inner = []

    for (const m of marks) {
      const px = X(m.x)
      const major = m.km % 1000 === 0
      const half = m.km % 500 === 0
      if (!major && !half && 100 * mmPerM < 2) continue
      const yr = area.y + area.h - BOTTOM_BAND + 6
      inner.push(line(px, yr, px, yr - (major ? 3 : half ? 2 : 1.2), { width: STROKE.ruler }))
      if (major) {
        inner.push(line(px, yTop - 4, px, yr - 3, { width: STROKE.grid, stroke: GRID_COLOR, dash: [1, 1] }))
        inner.push(text(px, yr + 3.5, [{ t: `km ${fmt(m.km / 1000, 1, comma)}` }],
          { size: 2.5, align: 'center', prio: PRIO.km }))
      }
    }
    if (marks.length) {
      const yr = area.y + area.h - BOTTOM_BAND + 6
      inner.push(line(Math.max(area.x, X(xa)), yr, Math.min(area.x + area.w, X(xb)), yr, { width: STROKE.ruler }))
    }

    for (const it of strip) {
      if (it.kind === 'line') {
        inner.push(path(poly(it.pts.map(([x, y]) => [X(x), y])), { width: it.width }))
      } else if (it.kind === 'dot') {
        inner.push(path(circlePath(X(it.x), it.y, 0.55), { stroke: null, fill: STYLE.ink }))
      } else if (it.kind === 'rect') {
        const [a, b] = [X(it.x0), X(it.x1)]
        inner.push(path([['M', a, it.y0], ['L', b, it.y0], ['L', b, it.y1], ['L', a, it.y1], ['Z']],
          { width: STROKE.platform, fill: PLATFORM_FILL }))
      } else if (it.kind === 'label') {
        if (it.room != null && it.room < textWidth([{ t: it.t }], it.size) + 2) continue
        inner.push(text(X(it.x), it.y, [{ t: it.t }], { size: it.size, align: 'center', prio: it.prio }))
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
      inner.push(text(area.x + 2, area.y + 4, [{ t: texts.prev.replace('{n}', i) }], { size: 2.5, prio: PRIO.joint }))
    }
    if (i < count - 1 && texts.next) {
      inner.push(text(area.x + area.w - 2, area.y + 4, [{ t: texts.next.replace('{n}', i + 2) }],
        { size: 2.5, align: 'right', prio: PRIO.joint }))
    }

    const sheet = { index: i, count }
    sheets.push({
      index: i, count,
      items: [{ type: 'group', clip: area, items: cullItems(inner, area) }, ...furniture(sheet)],
    })
  }

  return { pageW, pageH, sheets, fits: rawGap >= MIN_GAP, lanes: lmax - lmin + 1 }
}
