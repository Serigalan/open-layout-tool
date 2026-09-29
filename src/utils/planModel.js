import {
  FRAME, FRAME_WIDTH, PAPER_FORMATS, TITLE_COLUMN_MM, drawingArea, makeTransform,
} from './planExport'
import { sheetFootprint } from './planSketch'
import { BLOCK_ORIGIN, LOGO_PATHS, MM_PER_UNIT } from './planLogo'
import { parseSvgPath } from './svgPath'
import { kmForTrackPoint } from './kmLineUtils'
import { formatKm } from './kmLineMath'
import {
  trackPathUtm, mainPoints, switchSymbolUtm, trackPointAt, isArc, isTransition,
} from './planGeometry'
import { pointAtStationUtm } from './heightUtils'
import { cantExceptionOf, computeCantDef, worstCantOf } from './mapConstants'

/**
 * The plan as a list of drawing primitives per sheet, in page millimetres
 * (x right, y down, origin at the top left corner of the paper). A backend only
 * has to translate four types, so the same plan can be drawn into a PDF or an
 * SVG without either knowing anything about railways:
 *
 *   { type: 'path',  d, stroke, width, dash, fill, opacity }
 *   { type: 'text',  x, y, angle, size, align, parts: [{ t, sub, color }], color, prio, path }
 *
 * A text with a `path` — a page polyline — is set along it instead of at x/y,
 * so a label on a curve bends with the curve. SVG draws those with a real
 * <textPath>; the PDF backend walks the polyline and places the glyphs itself,
 * because PDF has no such operator.
 *   { type: 'image', dataUrl, x, y, w, h, opacity }
 *   { type: 'group', clip: { x, y, w, h }, items }
 *
 * `angle` is counter-clockwise positive, as jsPDF takes it; SVG negates it.
 * Path commands are the same subset planGeometry produces, transformed here
 * from the track plane into page millimetres — which is an affine map, so
 * Bézier control points come along unchanged.
 */

/** Pen widths [mm] and type sizes [mm] of the plan. */
export const STYLE = {
  axis:        0.5,
  branchAxis:  0.35,
  frame:       0.3,
  mainTick:    0.25,
  joint:       0.25,
  switchLcs:   0.35,
  ink:         '#000000',
  switchFill:  '#000000',
  jointColor:  '#000000',
  // The separators hold the values apart without competing with them for
  // attention, so they are set lighter than the figures they divide.
  separator:   '#a0a0a0',

  sizeElement: 2.5,
  sizeMain:    2.0,
  sizeTrack:   3.0,
  sizeTitle:   3.5,
  sizeField:   2.5,
  sizeLegend:  2.0,

  mainTickHalf:    1.5,   // half length of a main-point tick [mm]
  radiusArrow:     3.0,   // whole length of the arrow pointing at a curve start
  radiusArrowHead: 1.2,   // of which the solid head
  radiusArrowWidth: 0.45, // half-width of that head
  switchNodeR:     0.9,   // circle marking where a switch begins
  switchNodeClear: 0.6,   // keeps other marks out of that circle
  mainTextGap:     3.2,   // text distance from the axis [mm]
  elementTextGap:  3.0,
  trackNameGap:    5.0,
}

/** Average glyph width in em — the same estimate the map labels use. */
const EM_WIDTH = 0.62

/** Width [mm] a text primitive needs, near enough to place and cull by. */
export function textWidth(parts, size) {
  let em = 0
  for (const p of parts) em += p.t.length * (p.sub ? 0.75 : 1)
  return em * EM_WIDTH * size
}

/**
 * A number as a plan states it: fixed decimals, but a trailing run of zeros
 * *behind the point* dropped, so 190.10 reads 190,1 and 400.00 reads 400.
 * Only behind the point — 120 mm of cant is not 12.
 */
const fmtNum = (v, decimals, comma) => {
  let s = (Math.round(v * 10 ** decimals) / 10 ** decimals).toFixed(decimals)
  if (decimals > 0) s = s.replace(/0+$/, '').replace(/\.$/, '')
  return comma ? s.replace('.', ',') : s
}

/**
 * Direction a plane bearing takes on the page, counter-clockwise positive.
 * makeTransform turns the plane clockwise by rotDeg and flips north to −y, so a
 * bearing β leaves along the page angle 90° − (β + rotDeg).
 */
const pageAngle = (bearing, rotDeg) => 90 - (bearing + rotDeg)

/**
 * How far below the baseline the middle of the capitals sits, in em. A text is
 * anchored on its baseline, so a label meant to straddle a line has to drop by
 * this much — otherwise its whole body sits on one side of it.
 */
const CAP_CENTRE = 0.35

/** The direction "down" across a text set at this page angle. */
const pageDown = (angle) => {
  const rad = angle * Math.PI / 180
  return [Math.sin(rad), Math.cos(rad)]
}

/** Normal to the left of a page direction, seen on the page. */
const pageLeft = (angle) => {
  const rad = angle * Math.PI / 180
  return [-Math.sin(rad), -Math.cos(rad)]
}

/** Text turned so it never stands on its head. */
const readable = (angle) => {
  let a = ((angle + 180) % 360 + 360) % 360 - 180
  if (a > 90) a -= 180
  if (a <= -90) a += 180
  return a
}

/**
 * Page box a text covers, as an axis-aligned rectangle. The corners of the
 * text's own rectangle are laid out along its baseline and then turned onto the
 * page, so a rotated label is boxed by what it actually covers.
 */
function textBox(item, pad = 0.4) {
  if (item.path?.length) {
    // The glyphs sit on the baseline and reach one size to either side of it.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const [x, y] of item.path) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    const r = item.size + pad
    return { minX: minX - r, minY: minY - r, maxX: maxX + r, maxY: maxY + r }
  }
  const w = textWidth(item.parts, item.size)
  const h = item.size
  const x0 = item.align === 'center' ? -w / 2 : item.align === 'right' ? -w : 0
  const rad = item.angle * Math.PI / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [cx, cy] of [[x0, -h], [x0 + w, -h], [x0 + w, h * 0.25], [x0, h * 0.25]]) {
    const px = item.x + cx * cos + cy * sin
    const py = item.y - cx * sin + cy * cos
    if (px < minX) minX = px
    if (px > maxX) maxX = px
    if (py < minY) minY = py
    if (py > maxY) maxY = py
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad }
}

const boxesOverlap = (a, b) =>
  a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY

/** Box a path covers, control points included — never smaller than the curve. */
function pathBox(d) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const c of d) {
    for (let i = 1; i < c.length; i += 2) {
      if (c[i] < minX) minX = c[i]
      if (c[i] > maxX) maxX = c[i]
      if (c[i + 1] < minY) minY = c[i + 1]
      if (c[i + 1] > maxY) maxY = c[i + 1]
    }
  }
  return { minX, minY, maxX, maxY }
}

const boxInArea = (b, area, pad = 0) =>
  b.maxX > area.x - pad && b.minX < area.x + area.w + pad
  && b.maxY > area.y - pad && b.minY < area.y + area.h + pad

/**
 * Drop the parts of a path that no sheet will show. Every sheet carries every
 * track, so without this each one holds the whole project's geometry. A segment
 * survives when its own box reaches the sheet — which keeps a long straight
 * crossing the sheet even though both of its ends lie outside.
 */
function clipPathToArea(d, area, pad = 5) {
  const out = []
  let prev = null
  let penDown = false
  for (const c of d) {
    if (c[0] === 'M') { prev = [c[1], c[2]]; penDown = false; continue }
    if (c[0] === 'Z') { if (penDown) out.push(['Z']); continue }
    if (!prev) continue

    let minX = prev[0], maxX = prev[0], minY = prev[1], maxY = prev[1]
    for (let i = 1; i < c.length; i += 2) {
      if (c[i] < minX) minX = c[i]
      if (c[i] > maxX) maxX = c[i]
      if (c[i + 1] < minY) minY = c[i + 1]
      if (c[i + 1] > maxY) maxY = c[i + 1]
    }
    if (boxInArea({ minX, minY, maxX, maxY }, area, pad)) {
      if (!penDown) { out.push(['M', prev[0], prev[1]]); penDown = true }
      out.push(c)
    } else {
      penDown = false
    }
    prev = [c[c.length - 2], c[c.length - 1]]
  }
  return out
}

/**
 * What a sheet can actually show: anything off the sheet goes, and of the rest
 * a label gives way to a more important one it would sit on. Without this the
 * annotations of a dense layout write over each other and none of them reads.
 */
function cullItems(items, area) {
  const paths = items.map(item => {
    if (item.type !== 'path') return item
    // A fill either shows on this sheet or it does not — trimming it would
    // change its shape, so it is kept or dropped whole.
    if (item.fill) return boxInArea(pathBox(item.d), area) ? item : null
    const d = clipPathToArea(item.d, area)
    return d.length ? { ...item, d } : null
  }).filter(Boolean)

  const boxes = []
  const keep = new Set()
  const texts = paths
    .map((item, i) => ({ item, i }))
    .filter(({ item }) => item.type === 'text')
    .sort((a, b) => (a.item.prio - b.item.prio) || (a.i - b.i))

  for (const { item } of texts) {
    const box = textBox(item)
    if (!boxInArea(box, area) || boxes.some(b => boxesOverlap(b, box))) continue
    boxes.push(box)
    keep.add(item)
  }

  return paths.filter(item => item.type !== 'text' || keep.has(item))
}

/** Path commands from the track plane into page millimetres. */
function mapPath(cmds, transform) {
  return cmds.map(c => {
    if (c[0] === 'Z') return ['Z']
    const out = [c[0]]
    for (let i = 1; i < c.length; i += 2) {
      const [x, y] = transform(c[i], c[i + 1])
      out.push(x, y)
    }
    return out
  })
}

const polyPath = (pts) => [...pts.map((p, i) => [i ? 'L' : 'M', p[0], p[1]]), ['Z']]

/** Circle as four cubics; 0.5523·r is the control arm that fits a quarter. */
const KAPPA = 0.5522847498
function circlePath(cx, cy, r) {
  const k = KAPPA * r
  return [
    ['M', cx + r, cy],
    ['C', cx + r, cy + k, cx + k, cy + r, cx,     cy + r],
    ['C', cx - k, cy + r, cx - r, cy + k, cx - r, cy],
    ['C', cx - r, cy - k, cx - k, cy - r, cx,     cy - r],
    ['C', cx + k, cy - r, cx + r, cy - k, cx + r, cy],
    ['Z'],
  ]
}

/**
 * Arrow ending at (hx, hy), flying in the direction (ux, uy): a shaft behind a
 * solid head, so it comes from the side it points away from. Two primitives,
 * because one path carries one fill.
 */
function arrowItems(hx, hy, ux, uy) {
  const { radiusArrow: len, radiusArrowHead: head, radiusArrowWidth: half } = STYLE
  const px = -uy
  const py = ux
  const bx = hx - ux * head
  const by = hy - uy * head
  return [
    line(hx - ux * len, hy - uy * len, bx, by, { width: STYLE.mainTick }),
    path([
      ['M', hx, hy],
      ['L', bx + px * half, by + py * half],
      ['L', bx - px * half, by - py * half],
      ['Z'],
    ], { fill: STYLE.ink, stroke: null }),
  ]
}

const path = (d, opts = {}) => ({
  type: 'path', d,
  stroke: opts.stroke === null ? null : (opts.stroke ?? STYLE.ink),
  width: opts.width ?? STYLE.frame,
  dash: opts.dash ?? null,
  fill: opts.fill ?? null,
  opacity: opts.opacity ?? 1,
})

/**
 * `prio` decides which label survives a collision — the lower, the more it is
 * worth keeping. Sheet furniture stays out of the contest with prio 0.
 */
const text = (x, y, parts, opts = {}) => ({
  type: 'text', x, y,
  parts: typeof parts === 'string' ? [{ t: parts }] : parts,
  angle: opts.angle ?? 0,
  size: opts.size ?? STYLE.sizeField,
  align: opts.align ?? 'left',
  color: opts.color ?? STYLE.ink,
  bold: opts.bold ?? false,
  prio: opts.prio ?? 0,
  path: opts.path ?? null,
})

/** What a label is worth when two of them want the same spot. */
export const PRIO = {
  joint:   1,
  track:   2,
  switch:  3,
  main:    4,
  element: 5,
}

const line = (x1, y1, x2, y2, opts) => path([['M', x1, y1], ['L', x2, y2]], opts)

/**
 * How a plan names a turnout and its two routes. The caller passes what the
 * language says — EW/SS for the unbent form, r_z/r_d for the branch, r_s/r_m
 * for the through route; IBW and ABW are drawing abbreviations either way — so
 * a plan reads like the map it was drawn from. These are the fallbacks.
 */
const SWITCH_TEXT = {
  plain: 'EW', ibw: 'IBW', abw: 'ABW', abw_straight: 'ABW', sym: 'SYM',
  rBranch: 'z', rMain: 's', cantException: 'Ausnahme',
}

/** Is this element a switch's own geometry rather than a running track? */
const isBranch = (el) => !!el.switchBranch

/**
 * What separates one design value from the next. The extra space is not
 * decoration: in Helvetica a pipe and a lower-case l are near enough identical
 * that "| l =" reads as "l l =" when they sit one space apart.
 */
const separatorPart = () => ({ t: '  |  ', color: STYLE.separator })

/**
 * Label of one element: what a plan states about it — radius, length, cant and
 * cant deficiency, the values a design is read by. The deficiency is stated
 * rather than the speed it was derived from, because it is what the geometry
 * has to answer for; it needs a design speed to exist, so an element without
 * one carries none.
 *
 * `brief` keeps only radius and length: on an element too short to carry the
 * full set, those two still have to be readable.
 */
function elementParts(el, comma, { brief = false, switchText = SWITCH_TEXT } = {}) {
  const n = (v, d = 2) => fmtNum(v, d, comma)
  // A turnout's own route runs on the switch form's dimension, which is not a
  // design value of the alignment: it states the radius of that route and
  // nothing else, the same way the map labels it.
  if (isBranch(el)) {
    const route = el.switchRoute ?? (el.radius == null ? 'main' : 'branch')
    const r = (v) => (v == null ? '∞' : `${n(Math.abs(v))} m`)
    // Laid into a clothoid, the route is a clothoid and runs from one radius to
    // the other. The dash is set rather than an arrow: the PDF draws glyph by
    // glyph in a standard font, which has the one and not the other.
    const value = isTransition(el) ? `${r(el.r1)} – ${r(el.r2)}` : r(el.radius)
    const parts = [{ t: 'r' }, { t: route === 'main' ? switchText.rMain : switchText.rBranch, sub: true },
      { t: ` = ${value}` }]
    // A turnout canted past its plain limit stands on a written justification
    // (mapConstants: MAX_SWITCH_CANT). That justification is a design decision,
    // so the plan states it rather than leaving the raised cant unexplained.
    // `brief` drops it with everything else that does not fit the element.
    const reason = cantExceptionOf(el)
    if (!brief && reason) {
      parts.push(separatorPart(),
        { t: `u = ${n(worstCantOf(el), 0)} mm (${switchText.cantException}: ${reason})` })
    }
    return parts
  }
  if (isTransition(el)) {
    return [{ t: 'l' }, { t: el.transitionType === 'bloss' ? 'ub' : 'u', sub: true },
      { t: ` = ${n(el.length)} m` }]
  }

  const parts = []
  const add = (...p) => {
    if (parts.length) parts.push(separatorPart())
    parts.push(...p)
  }
  if (isArc(el)) add({ t: `r = ${n(Math.abs(el.radius))} m` })
  add({ t: `l = ${n(el.length)} m` })
  if (!brief && el.cant) add({ t: `u = ${n(Math.abs(el.cant), 0)} mm` })
  if (!brief && isArc(el) && el.speed) {
    add({ t: 'u' }, { t: 'f', sub: true },
      { t: ` = ${n(computeCantDef(el.speed, el.radius, el.cant ?? 0), 0)} mm` })
  }
  return parts
}

/** Station as it is written on a plan: 1+234.56 → kilometre plus metres. */
function stationText(station, comma) {
  const km = Math.floor(station / 1000)
  const m = station - km * 1000
  const mm = m.toFixed(2).padStart(6, '0')
  return `${km}+${comma ? mm.replace('.', ',') : mm}`
}

/**
 * The page polyline a label is set along: the track's own axis, offset sideways
 * by `gap`, sampled over the stretch the text needs. Text laid on this bends
 * with the alignment instead of cutting the chord of a curve.
 *
 * Two details decide whether it reads: the window is shifted back inside the
 * track when it would run off an end, and a stretch that runs right to left on
 * the page is reversed so the text is never upside down.
 *
 * Glyphs rise from the baseline towards the left of the path's own direction.
 * That side is the offset side only when the path was not reversed and the
 * label sits to the left anyway; in the other two cases the lettering would
 * grow back across the axis, so the baseline moves out by one text height.
 */
function labelPath(track, station, spanM, side, gap, size, rotDeg, transform, total, steps = 16) {
  let from = station - spanM / 2
  let to = station + spanM / 2
  if (from < 0)     { to = Math.min(total, to - from); from = 0 }
  if (to > total)   { from = Math.max(0, from - (to - total)); to = total }
  if (!(to > from)) return null

  const samples = []
  for (let i = 0; i <= steps; i++) {
    const at = trackPointAt(track, from + (to - from) * i / steps)
    if (at) samples.push(at)
  }
  if (samples.length < 2) return null

  const place = (at, off) => {
    const [x, y] = transform(at.point[0], at.point[1])
    const [nx, ny] = pageLeft(pageAngle(at.bearing, rotDeg))
    return [x + off * nx, y + off * ny]
  }
  const reversed = place(samples[samples.length - 1], 0)[0] < place(samples[0], 0)[0]
  const risesTowards = reversed ? -1 : 1
  const off = side * (gap + (risesTowards === side ? 0 : size))
  const pts = samples.map(at => place(at, off))
  if (reversed) pts.reverse()
  return pts
}

/** Everything drawn from the tracks themselves, clipped to the drawing area. */
function trackItems(sheet, ctx) {
  const { tracks, switches, show, comma, scaleDen, switchText, kmLines } = ctx
  const transform = sheet.transform
  const items = []
  const mmPerM = 1000 / scaleDen

  // Where turnouts begin. Collected here, drawn last: the circle marks the toe
  // on its own, so nothing that crosses it may show through. Each node keeps
  // the side its branch turns to, which is what names the point WA and sets
  // that name on the branch's radius.
  const switchNodes = []
  const switchNodeAt = (x, y) => switchNodes.find(n =>
    Math.hypot(x - n.x, y - n.y) <= STYLE.switchNodeR + STYLE.switchNodeClear) ?? null

  // Switch bodies go under the axes: the axes are what the plan is about.
  if (show.switches) {
    const trackById = Object.fromEntries(tracks.map(tr => [tr.id, tr]))
    for (const sw of switches) {
      const sym = switchSymbolUtm(sw, trackById)
      if (!sym) continue
      // A crossing's body is two wedges, a pair of rings where a turnout's is
      // one — each becomes its own path, so each is clipped to its sheet alone.
      const fillRings = Array.isArray(sym.fill[0][0]) ? sym.fill : [sym.fill]
      for (const ring of fillRings) {
        items.push(path(mapPath(polyPath(ring), transform),
          { fill: STYLE.switchFill, stroke: null }))
      }
      if (sym.lcs) {
        items.push(path(mapPath([['M', ...sym.lcs[0]], ['L', ...sym.lcs[1]]], transform),
          { width: STYLE.switchLcs }))
      }
      const [nodeX, nodeY] = transform(sym.node[0], sym.node[1])
      switchNodes.push({ x: nodeX, y: nodeY, turn: sym.branchTurn })

      // The toe is a main point of the plan in its own right — the branch arc
      // begins there — but it belongs to no running track, so no main-point
      // list holds it. It is set like a Bogenanfang, on the radius of that arc,
      // with the turnout's number facing it from the other side.
      const toe = pageAngle(sym.bearing, sheet.rotDeg)
      const [tnx, tny] = pageLeft(toe)
      const turn = sym.branchTurn || 1
      const ox = turn * tnx
      const oy = turn * tny
      const angle = readable(Math.atan2(-oy, ox) * 180 / Math.PI)
      const [ddx, ddy] = pageDown(angle)
      const radial = (parts, out, prio) => {
        const reach = STYLE.radiusArrow + STYLE.mainTextGap
          + textWidth(parts, STYLE.sizeMain) / 2
        return text(
          nodeX + out * ox * reach + ddx * CAP_CENTRE * STYLE.sizeMain,
          nodeY + out * oy * reach + ddy * CAP_CENTRE * STYLE.sizeMain,
          parts, { angle, size: STYLE.sizeMain, align: 'center', prio })
      }
      items.push(radial([{ t: `WA ${stationText(sym.station, comma)}` }], -1, PRIO.main))
      if (sym.number != null) {
        items.push(radial([{ t: `W ${sym.number}` }], 1, PRIO.switch))
      }
      if (sym.label) {
        // Centred on the body, and on the side the branch does not take — the
        // fill is solid black, so a name on top of it would not be readable.
        const [x, y] = transform(sym.mid[0], sym.mid[1])
        const a = pageAngle(sym.midBearing, sheet.rotDeg)
        const [lx, ly] = pageLeft(a)
        const side = sym.branchTurn || 1
        const angle = readable(a)
        const [dx, dy] = pageDown(angle)
        items.push(text(
          x + side * lx * STYLE.trackNameGap + dx * CAP_CENTRE * STYLE.sizeTrack,
          y + side * ly * STYLE.trackNameGap + dy * CAP_CENTRE * STYLE.sizeTrack,
          [{ t: `${switchText[sym.bauform] ?? switchText.plain} ${sym.label}` }],
          { angle, size: STYLE.sizeTrack, align: 'center', prio: PRIO.switch }))
      }
    }
  }

  for (const track of tracks) {
    const els = (track.elements ?? []).filter(el => el.length > 0)
    if (!els.length) continue
    const branchOnly = els.every(isBranch)
    const total = els.reduce((sum, el) => sum + el.length, 0)
    // Text set along the axis: a little slack so it never touches the ends.
    const along = (station, parts, size, side, gap) => labelPath(
      track, station, textWidth(parts, size) / mmPerM * 1.1,
      side, gap, size, sheet.rotDeg, transform, total)

    items.push(path(mapPath(trackPathUtm(track), transform),
      { width: branchOnly ? STYLE.branchAxis : STYLE.axis }))

    if (show.labels) {
      let station = 0
      for (const el of els) {
        const mid = station + el.length / 2
        station += el.length
        const p = pointAtStationUtm(el, el.length / 2, track.epsg)
        const [x, y] = transform(p.easting, p.northing)
        // Outside of the curve, so the text never falls inside a tight bend.
        // A right-hand curve (radius > 0) has its centre to the right, so its
        // outside is the left-hand side the offset already points to.
        const side = isArc(el) && el.radius < 0 ? -1 : 1
        // Every element is named. One too short for the full set falls back to
        // radius and length, which is what a plan is read by; the label may then
        // reach past the element it belongs to, which the arrow-free side and
        // the collision pass keep legible.
        const full = elementParts(el, comma, { switchText })
        const parts = textWidth(full, STYLE.sizeElement) <= el.length * mmPerM
          ? full
          : elementParts(el, comma, { brief: true, switchText })
        items.push(text(x, y, parts, {
          size: STYLE.sizeElement, align: 'center', prio: PRIO.element,
          path: along(mid, parts, STYLE.sizeElement, side, STYLE.elementTextGap),
        }))
      }
    }

    // Beyond its elements a switch's own branch track carries no plan
    // annotation: it is the turnout's geometry, not a running track, so it has
    // no main points and no name of its own.
    if (branchOnly) continue

    if (show.mainPoints) {
      for (const mp of mainPoints(track)) {
        const [x, y] = transform(mp.point[0], mp.point[1])
        const [nx, ny] = pageLeft(pageAngle(mp.bearing, sheet.rotDeg))
        // Where a curve begins, the centre of that curve is to one side: for a
        // right-hand curve (radius > 0) to the right of travel, so the arrow
        // flies from there onto the point, along the radius. Elsewhere — a
        // straight starting, the track's own end — a plain tick will do.
        // A turnout's toe carries its own circle, name and number, so a track
        // that happens to be split there adds nothing.
        if (switchNodeAt(x, y)) continue

        const turn = mp.signedR ? Math.sign(mp.signedR) : 0
        if (turn) {
          items.push(...arrowItems(x, y, turn * nx, turn * ny))
        } else {
          items.push(line(x - nx * STYLE.mainTickHalf, y - ny * STYLE.mainTickHalf,
            x + nx * STYLE.mainTickHalf, y + ny * STYLE.mainTickHalf, { width: STYLE.mainTick }))
        }

        // The track's own station says where on the track a point lies, the
        // kilometrage where on the line it lies — a plan is read against the
        // second, so it goes after the first rather than in place of it.
        // Without a line for this track there is simply nothing to add.
        const km = show.kilometrage
          ? kmForTrackPoint(kmLines, track, mp.point)
          : null
        const parts = [{
          t: `${mp.code} ${stationText(mp.station, comma)}`
            + (km ? `   km ${formatKm(km.km)}` : ''),
        }]
        if (turn) {
          // On the radius, in line with the arrow and beyond its tail, so mark
          // and name read as the one annotation pointing at the point. The
          // baseline drops half a cap height so the text straddles that line
          // instead of hanging off one side of it.
          const ox = turn * nx
          const oy = turn * ny
          const reach = STYLE.radiusArrow + STYLE.mainTextGap
            + textWidth(parts, STYLE.sizeMain) / 2
          const angle = readable(Math.atan2(-oy, ox) * 180 / Math.PI)
          const [dx, dy] = pageDown(angle)
          items.push(text(
            x - ox * reach + dx * CAP_CENTRE * STYLE.sizeMain,
            y - oy * reach + dy * CAP_CENTRE * STYLE.sizeMain,
            parts, { angle, size: STYLE.sizeMain, align: 'center', prio: PRIO.main }))
        } else {
          // Nothing to point at, so the name follows the alignment itself.
          items.push(text(x, y, parts, {
            size: STYLE.sizeMain, align: 'center', prio: PRIO.main,
            path: along(mp.station, parts, STYLE.sizeMain, -1, STYLE.mainTextGap),
          }))
        }
      }
    }

    if (show.trackNames && track.name) {
      const p = pointAtStationUtm(els[0], 0, track.epsg)
      const [x, y] = transform(p.easting, p.northing)
      const parts = [{ t: track.name }]
      items.push(text(x, y, parts, {
        size: STYLE.sizeTrack, align: 'center', prio: PRIO.track,
        path: along(textWidth(parts, STYLE.sizeTrack) / mmPerM / 2, parts,
          STYLE.sizeTrack, 1, STYLE.trackNameGap),
      }))
    }
  }

  // Where the next sheet takes over.
  for (const j of sheet.joints ?? []) {
    const [x, y] = transform(j.point[0], j.point[1])
    const a = pageAngle(j.bearing, sheet.rotDeg)
    const [nx, ny] = pageLeft(a)
    const half = 14
    items.push(line(x - nx * half, y - ny * half, x + nx * half, y + ny * half,
      { width: STYLE.joint, dash: [3, 1.5], stroke: STYLE.jointColor }))
    items.push(text(x + nx * (half + 2), y + ny * (half + 2), [{ t: j.text }],
      { angle: readable(a), size: STYLE.sizeElement, align: 'center', color: STYLE.jointColor, prio: PRIO.joint }))
  }

  // Last, so the white ground of each circle covers the axis running through it.
  for (const node of switchNodes) {
    items.push(path(circlePath(node.x, node.y, STYLE.switchNodeR),
      { width: STYLE.mainTick, fill: '#ffffff' }))
  }

  return items
}

/** A fold mark this far from the right page edge, where the sheet folds to A4 (DIN 824). */
const FOLD_FROM_RIGHT = 190

/**
 * The sheet frame and the fold mark in the margin below it. The column a
 * title block keeps free has no rule of its own: the block closes it at the
 * foot and the legend heads it, as on the DB sheet. Drawn after everything
 * else, so no white ground of a title block eats into it and it runs the
 * same width all the way round.
 */
function frameItems(pageW, pageH) {
  const { x, y, w, h } = drawingArea(pageW, pageH)
  return [
    path([['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']], { width: FRAME_WIDTH }),
    line(pageW - FOLD_FROM_RIGHT, y + h, pageW - FOLD_FROM_RIGHT, pageH, { width: 0.265 }),
  ]
}

/** Height [mm] of the simple title block. */
const COMPACT_BLOCK_H = 52
/** Text size of the simple title block: 13 px of the template [mm]. */
const COMPACT_TEXT = 3.44
/**
 * Where the simple block's date and name table begins: its template is
 * 145 mm wide, and the block takes the detailed one's width by giving the
 * extra to the content column, so both blocks head the same column.
 */
const COMPACT_TABLE_X = TITLE_COLUMN_MM - 60

/*
 * Rules of the simple block, in block millimetres from its top left corner:
 * the wordmark row, plan kind and scale, the content beside the date and name
 * table, and the reference system and format at the foot.
 */
const COMPACT_RULES = (() => {
  const w = TITLE_COLUMN_MM
  const t = COMPACT_TABLE_X
  return [
    [0, 11, w, 11], [0, 20, w, 20], [0, 44, w, 44],
    [t, 11, t, 44], [t, 28, w, 28], [t, 36, w, 36],
    [t + 11, 20, t + 11, 44], [t + 32, 20, t + 32, 44],
  ]
})()

/** The Open Layout Tool wordmark at the block's top left corner (ox, oy). */
function wordmarkItems(ox, oy) {
  const [bx, by] = BLOCK_ORIGIN
  const toPage = (x, y) => [ox + (x - bx) * MM_PER_UNIT, oy + (y - by) * MM_PER_UNIT]
  return LOGO_PATHS.map(({ fill, d }) => path(mapPath(parseSvgPath(d), toPage), { stroke: null, fill }))
}

/**
 * The simple title block, laid out as the DB-style template it copies: the
 * tool's wordmark; plan kind and scale; what the plan shows beside who drew
 * and checked it; and the reference system and paper at the foot.
 * {i}/{n} = sheet.
 */
function titleBlockItems(pageW, pageH, block, sheet) {
  const w = TITLE_COLUMN_MM
  const h = COMPACT_BLOCK_H
  const t = COMPACT_TABLE_X
  const ox = pageW - FRAME.right - w
  const oy = pageH - FRAME.bottom - h
  const fill = (str) => String(str ?? '').replace('{i}', sheet.index + 1).replace('{n}', sheet.count)
  const size = COMPACT_TEXT
  const items = [
    path([['M', ox, oy], ['L', ox + w, oy], ['L', ox + w, oy + h], ['L', ox, oy + h], ['Z']],
      { stroke: null, fill: '#ffffff' }),
    ...COMPACT_RULES.map(([x1, y1, x2, y2]) => line(ox + x1, oy + y1, ox + x2, oy + y2, { width: 0.265 })),
    path([['M', ox, oy + h], ['L', ox, oy], ['L', ox + w, oy]], { width: FRAME_WIDTH }),
    ...wordmarkItems(ox, oy),
  ]
  const put = (x, y, str, o = {}) => {
    const s = fill(str)
    if (s) items.push(text(ox + x, oy + y, [{ t: s }], { size: fitSize(s, size, o.room ?? 1e9), ...o }))
  }
  const labels = block.labels ?? {}
  const labelled = (label, value) => [label, value].filter(Boolean).join(' ')

  put(3.3, 16.8, labels.kind)
  put(19.4, 16.8, block.kind, { bold: true, room: t - 19.4 - 1 })
  put(t + 3.5, 16.8, labelled(labels.scale, block.scale), { room: w - t - 4.5 })

  put(3.3, 26.2, labels.content)
  put(19.2, 26.2, block.title, { bold: true, room: t - 19.2 - 1 })
  ;(block.lines ?? []).slice(0, 2).forEach((l, k) => put(19.2, 32.2 + k * 6, l, { room: t - 19.2 - 1 }))

  put(t + 14.9, 25.3, block.dateHeader, { bold: true, room: 16 })
  put(t + 34.6, 25.3, block.nameHeader, { bold: true, room: 24.5 })
  ;(block.staff ?? []).slice(0, 2).forEach((row, k) => {
    const y = 33 + k * 8
    put(t + 1.5, y, row.label, { room: 9.5 })
    put(t + 13.9, y, row.date, { room: 17 })
    put(t + 34.8, y, row.name, { room: 24.5 })
  })

  put(3.3, 49.3, labelled(labels.epsg, block.epsg), { room: t - 4.3 })
  put(t + 3.5, 49.3, labelled(labels.format, block.format), { room: w - t - 4.5 })

  // The column above the block is free, so the legend heads it — as over the detailed block.
  if (block.legend) {
    items.push(text(ox + 3, FRAME.top + 5, [{ t: block.legend }],
      { size: fitSize(block.legend, STYLE.sizeLegend, w - 6) }))
  }
  return items
}

/**
 * Advance of a text in Helvetica [mm], from the glyph classes of its metrics:
 * close enough to fit a field, unlike textWidth, which errs wide on purpose so
 * that labels keep clear of each other.
 */
const NARROW = new Set([...'iljtfrI.,:;\'|!()/- '])
const WIDE = new Set([...'mwMW@%'])
function helveticaWidth(str, size) {
  let em = 0
  for (const ch of String(str)) {
    em += NARROW.has(ch) ? 0.29 : WIDE.has(ch) ? 0.85
      : /[A-ZÄÖÜ&]/.test(ch) ? 0.68 : /[0-9]/.test(ch) ? 0.556 : 0.53
  }
  return em * size
}

/** A size that keeps a text within `maxW`, never above `size`. */
const fitSize = (str, size, maxW) => {
  const w = helveticaWidth(str, size)
  return w > maxW ? size * maxW / w : size
}

/** An image scaled to sit inside a box, centred vertically and left-aligned or centred. */
function containedImage(logo, x, y, w, h, centre = false) {
  const k = Math.min(w / logo.w, h / logo.h)
  const iw = logo.w * k
  const ih = logo.h * k
  return {
    type: 'image', dataUrl: logo.dataUrl, opacity: 1,
    x: centre ? x + (w - iw) / 2 : x, y: y + (h - ih) / 2, w: iw, h: ih,
  }
}

/** Size [mm] of the full title block — the DB Streckenband sheet it copies. */
const FULL_BLOCK = { w: TITLE_COLUMN_MM, h: 134 }
const RULE_THICK = 0.5
const RULE_THIN = 0.25
const RULE_TABLE = 0.265
const FOCUS_COLOR = '#ec0016'

/*
 * The rules of the full block, in block millimetres from its top left corner,
 * as [x1, y1, x2, y2]: the four party columns, the location sketch with the
 * revision table beside it and two free rows below, and the strip with index,
 * staff, plan title and the three cells at the foot.
 */
const RULES_THICK = [
  [0, 0, 180, 0], [0, 0, 0, 134], [0, 35, 180, 35], [0, 99, 180, 99],
  [0, 104, 18, 104], [0, 114, 35, 114], [18, 99, 18, 114], [35, 99, 35, 134],
  [77, 99, 77, 124], [56, 119, 56, 124], [35, 119, 77, 119], [35, 124, 180, 124],
  [138, 124, 138, 134], [153, 124, 153, 134],
]
const RULES_THIN = [
  [45, 0, 45, 35], [90, 0, 90, 35], [135, 0, 135, 35],
  [130, 35, 130, 99],
  [0, 83, 180, 83], [0, 91, 180, 91], [60, 83, 60, 91], [80, 83, 80, 91], [25, 91, 25, 99],
  [18, 104, 77, 104], [18, 109, 77, 109], [35, 114, 77, 114], [56, 99, 56, 119],
]
/** The rows of the revision table beside the sketch, a shade heavier on the template. */
const RULES_TABLE = [43, 51, 59, 67, 75].map(y => [130, y, 180, y])
/** Where the location sketch is drawn, clear of its caption. */
const SKETCH_BOX = { x: 2, y: 41, w: 126, h: 40.5 }

/**
 * The network in a box, north up, with the part the sheet shows in red. Points
 * closer than a few tenths of a millimetre to the last one kept are dropped —
 * the network would otherwise put every sample of every track on every sheet.
 */
function sketchItems(sketch, focus, box) {
  const focusPts = focus?.ring ?? focus?.line ?? []
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const pts of [...sketch.lines, focusPts]) {
    for (const [e, n] of pts) {
      if (e < minX) minX = e
      if (e > maxX) maxX = e
      if (n < minY) minY = n
      if (n > maxY) maxY = n
    }
  }
  if (!(maxX > minX || maxY > minY)) return []
  const k = Math.min(box.w / (maxX - minX || 1), box.h / (maxY - minY || 1))
  const ox = box.x + (box.w - (maxX - minX) * k) / 2
  const oy = box.y + (box.h + (maxY - minY) * k) / 2
  const page = ([e, n]) => [ox + (e - minX) * k, oy - (n - minY) * k]

  const d = []
  for (const pts of sketch.lines) {
    let last = null
    pts.forEach((p, i) => {
      const q = page(p)
      if (last && i < pts.length - 1 && Math.hypot(q[0] - last[0], q[1] - last[1]) < 0.3) return
      d.push([last ? 'L' : 'M', q[0], q[1]])
      last = q
    })
  }
  const items = [path(d, { width: 0.12, stroke: '#666666' })]
  if (focusPts.length > 1) {
    items.push(path(focusPts.map((p, i) => [i ? 'L' : 'M', ...page(p)]),
      { width: focus.ring ? 0.35 : 0.7, stroke: FOCUS_COLOR }))
  }
  return items
}

/**
 * The title block of a construction drawing, laid out as the DB Streckenband
 * sheet it copies: a column each for client, project management, contractor
 * and planner (heading, logo, address and — where the party signs — lines for
 * place, date and signature); the location sketch beside an empty revision
 * table; and at the foot index, code, who drew, edited and checked the sheet,
 * the plan title in three lines and three cells for scale, sheet and the rest.
 * The caller supplies every text and image.
 */
function fullTitleBlockItems(pageW, pageH, block, sheet) {
  const { w, h } = FULL_BLOCK
  const ox = pageW - FRAME.right - w
  const oy = pageH - FRAME.bottom - h
  const fill = (str) => String(str ?? '').replace('{i}', sheet.index + 1).replace('{n}', sheet.count)
  const items = [path([['M', ox, oy], ['L', ox + w, oy], ['L', ox + w, oy + h], ['L', ox, oy + h], ['Z']],
    { stroke: null, fill: '#ffffff' })]
  const put = (x, y, str, size, o = {}) => {
    if (str) items.push(text(ox + x, oy + y, [{ t: str }], { size, ...o }))
  }
  const centred = (x, y, str, size, room, o = {}) => put(x, y, str, fitSize(str, size, room), { align: 'center', ...o })

  const sketch = block.sketchImage
    ? [containedImage(block.sketchImage, ox + SKETCH_BOX.x, oy + SKETCH_BOX.y, SKETCH_BOX.w, SKETCH_BOX.h, true)]
    : block.sketch
      ? sketchItems(block.sketch, sheet.focus, { ...SKETCH_BOX, x: ox + SKETCH_BOX.x, y: oy + SKETCH_BOX.y })
      : []
  items.push(...sketch)

  for (const [rules, width] of [[RULES_THIN, RULE_THIN], [RULES_TABLE, RULE_TABLE], [RULES_THICK, RULE_THICK]]) {
    for (const [x1, y1, x2, y2] of rules) items.push(line(ox + x1, oy + y1, ox + x2, oy + y2, { width }))
  }

  const parties = block.parties ?? []
  const colW = w / Math.max(parties.length, 1)
  parties.forEach((party, i) => {
    const cx = i * colW
    put(cx + 1.5, 5, party.label, 2.8)
    if (party.logo) {
      // Right of the heading, as far in as the longest heading reaches.
      const lx = Math.max(cx + 23, cx + 3 + helveticaWidth(party.label, 2.8))
      const lw = cx + colW - 0.8 - lx
      if (lw > 3) items.push(containedImage(party.logo, ox + lx, oy + 1.6, lw, 5.2))
    }
    ;(party.lines ?? []).slice(0, 6).forEach((l, k) => {
      put(cx + 2, 11.9 + k * 3.09, l, fitSize(l, 2.47, colW - 3.5))
    })
    if (party.signs) {
      for (const [x1, x2, caption] of [[2.1, 16, block.dateCaption], [28, 42.5, block.signCaption]]) {
        items.push(line(ox + cx + x1, oy + 30.9, ox + cx + x2, oy + 30.9, { width: 0.25, dash: [0.25, 1] }))
        centred(cx + (x1 + x2) / 2, 33.45, caption, 2.47, colW / 2 - 1)
      }
    }
  })

  put(2, 39.2, block.sketchCaption, 2.8)

  centred(9, 102.45, block.index || '-', 2.47, 16)
  centred(9, 111, block.code, 5.64, 16)
  ;(block.staff ?? []).slice(0, 3).forEach((row, k) => {
    const y = 102.4 + k * 5
    put(19.4, y, row.label, fitSize(row.label, 2.82, 15.4))
    centred(45.5, y, row.date || '-', 2.82, 20)
    centred(66.5, y, row.name || '-', 2.82, 20)
  })
  centred(45.5, 122.5, block.dateHeader, 2.82, 20)
  centred(66.5, 122.5, block.nameHeader, 2.82, 20)

  const title = [fill(block.title), fill(block.range || sheet.range), fill(block.subtitle)]
  centred(128.5, 105.8, title[0], 4.23, 99, { bold: true })
  centred(128.5, 112.35, title[1], 4.23, 99)
  centred(128.5, 119.6, title[2], 4.23, 99)

  ;[[77, 138], [138, 153], [153, 180]].forEach(([x1, x2], i) => {
    const lines = (block.footer?.[i] ?? []).map(fill).filter(Boolean).slice(0, 2)
    const y0 = lines.length > 1 ? 127.9 : 129.8
    lines.forEach((l, k) => centred((x1 + x2) / 2, y0 + k * 3.7, l, 2.5, x2 - x1 - 2))
  })

  // The column above the block is free, so the legend heads it.
  if (block.legend) {
    items.push(text(ox + 3, FRAME.top + 5, [{ t: block.legend }],
      { size: fitSize(block.legend, STYLE.sizeLegend, w - 6) }))
  }
  return items
}

function scaleBarItems(pageH, scaleDen, comma) {
  const mmPerM = 1000 / scaleDen
  const segM = scaleDen <= 500 ? 10 : 20
  const segMm = segM * mmPerM
  const x0 = FRAME.left + 6
  const y0 = pageH - FRAME.bottom - 6
  const items = []
  for (let i = 0; i < 4; i++) {
    items.push(path([
      ['M', x0 + i * segMm, y0], ['L', x0 + (i + 1) * segMm, y0],
      ['L', x0 + (i + 1) * segMm, y0 + 2], ['L', x0 + i * segMm, y0 + 2], ['Z'],
    ], { width: STYLE.frame, fill: i % 2 ? '#ffffff' : STYLE.ink }))
  }
  items.push(text(x0 - 1, y0 - 1, [{ t: '0' }], { size: STYLE.sizeField }))
  items.push(text(x0 + 4 * segMm, y0 - 1, [{ t: `${fmtNum(segM * 4, 0, comma)} m` }],
    { size: STYLE.sizeField, align: 'right' }))
  return items
}

function northArrowItems(rotDeg) {
  const cx = FRAME.left + 8
  const cy = FRAME.top + 12
  const len = 8
  // North is up at rotDeg 0 and turns clockwise with the content.
  const a = rotDeg * Math.PI / 180
  const ux = Math.sin(a)
  const uy = -Math.cos(a)
  const hx = cx + ux * len
  const hy = cy + uy * len
  const px = -uy
  const py = ux
  return [
    line(cx, cy, hx, hy, { width: 0.4 }),
    line(hx, hy, hx - ux * 2 + px * 1.5, hy - uy * 2 + py * 1.5, { width: 0.4 }),
    line(hx, hy, hx - ux * 2 - px * 1.5, hy - uy * 2 - py * 1.5, { width: 0.4 }),
    text(hx + ux * 3, hy + uy * 3 + 1, [{ t: 'N' }], { size: 2.8, align: 'center' }),
  ]
}

/**
 * Build the whole plan.
 *
 * @param {object}  o
 * @param {Array}   o.tracks     project tracks (elements + epsg)
 * @param {Array}   o.switches   project switches
 * @param {Array}   o.sheets     from planLayout: { center, rotDeg, index, count, joints? }
 * @param {string}  o.paperKey   key of PAPER_FORMATS
 * @param {number}  o.scaleDen   scale denominator
 * @param {object}  o.titleBlock { title, rows: [[left, right]], legend }; {i}/{n} = sheet.
 *                          With `full`: { title, range, subtitle, index, code, parties,
 *                          staff, footer: [[lines] × 3], sketch | sketchImage, ...captions }
 * @param {object}  o.show       which annotations to draw
 * @param {Array}   o.basemaps   per sheet: { dataUrl, xMm, yMm, wMm, hMm } or null
 * @param {number}  o.basemapOpacity
 * @param {boolean} o.comma      German decimal comma
 * @param {number}  o.reserve    column on the right kept free of the drawing [mm];
 *                               either title block takes TITLE_COLUMN_MM by default
 * @returns {{ pageW, pageH, sheets: Array<{ index, count, items }> }}
 */
export function buildPlan({
  tracks, switches = [], kmLines = [], sheets, paperKey, scaleDen, titleBlock,
  show = {}, basemaps = [], basemapOpacity = 0.4, comma = true, switchText = {},
  reserve = titleBlock ? TITLE_COLUMN_MM : 0,
}) {
  const swText = { ...SWITCH_TEXT, ...switchText }
  const [pageW, pageH] = PAPER_FORMATS[paperKey]
  const shown = {
    labels: true, switches: true, trackNames: true, mainPoints: true,
    kilometrage: false, ...show,
  }
  const clip = drawingArea(pageW, pageH, reserve)

  const built = sheets.map((sheet, i) => {
    const withTransform = {
      ...sheet,
      transform: makeTransform(sheet.center, pageW, pageH, scaleDen, sheet.rotDeg, reserve),
    }
    const items = []

    const bm = basemaps[i]
    if (bm?.dataUrl) {
      items.push({
        type: 'image', dataUrl: bm.dataUrl,
        x: bm.xMm, y: bm.yMm, w: bm.wMm, h: bm.hMm, opacity: basemapOpacity,
      })
    }

    items.push({
      type: 'group',
      clip,
      items: cullItems(trackItems(withTransform,
        { tracks, switches, kmLines, show: shown, comma, scaleDen, switchText: swText }), clip),
    })

    items.push(...scaleBarItems(pageH, scaleDen, comma))
    items.push(...northArrowItems(sheet.rotDeg))
    if (titleBlock) {
      const focus = titleBlock.sketch && sheet.center
        ? { ring: sheetFootprint(sheet, clip, scaleDen) }
        : null
      items.push(...(titleBlock.full
        ? fullTitleBlockItems(pageW, pageH, titleBlock, { ...sheet, focus })
        : titleBlockItems(pageW, pageH, titleBlock, sheet)))
    }
    items.push(...frameItems(pageW, pageH))

    return { index: sheet.index ?? i, count: sheet.count ?? sheets.length, items }
  })

  return { pageW, pageH, sheets: built }
}

/** Building blocks for other plan kinds that share the sheet furniture. */
export {
  path as pathItem, text as textItem, line as lineItem, circlePath, cullItems, frameItems, fitSize,
}

/** The title block a plan asks for — detailed or compact. */
export const titleBlockFor = (pageW, pageH, block, sheet) => (block.full
  ? fullTitleBlockItems(pageW, pageH, block, sheet)
  : titleBlockItems(pageW, pageH, block, sheet))
