import { MARGIN_MM, PAPER_FORMATS, makeTransform } from './planExport'
import { kmForTrackPoint } from './kmLineUtils'
import { formatKm } from './kmLineMath'
import {
  trackPathUtm, mainPoints, switchSymbolUtm, trackPointAt, isArc, isTransition,
} from './planGeometry'
import { pointAtStationUtm } from './heightUtils'
import { computeCantDef } from './mapConstants'

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
  plain: 'EW', ibw: 'IBW', abw: 'ABW', abw_straight: 'ABW',
  rBranch: 'z', rMain: 's',
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
    return [{ t: 'r' }, { t: route === 'main' ? switchText.rMain : switchText.rBranch, sub: true },
      { t: ` = ${value}` }]
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
      items.push(path(mapPath(polyPath(sym.fill), transform),
        { fill: STYLE.switchFill, stroke: null }))
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

function frameItems(pageW, pageH) {
  const w = pageW - 2 * MARGIN_MM
  const h = pageH - 2 * MARGIN_MM
  return [path([
    ['M', MARGIN_MM, MARGIN_MM], ['L', MARGIN_MM + w, MARGIN_MM],
    ['L', MARGIN_MM + w, MARGIN_MM + h], ['L', MARGIN_MM, MARGIN_MM + h], ['Z'],
  ], { width: STYLE.frame })]
}

function titleBlockItems(pageW, pageH, block, sheet) {
  const rows = block.rows ?? []
  const w = 110
  const h = 8 + rows.length * 7
  const x = pageW - MARGIN_MM - w
  const y = pageH - MARGIN_MM - h
  const fill = (s) => s.replace('{i}', sheet.index + 1).replace('{n}', sheet.count)

  const items = [
    path([['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']],
      { width: STYLE.frame, fill: '#ffffff' }),
    line(x, y + 8, x + w, y + 8, { width: STYLE.frame }),
    line(x + w / 2, y + 8, x + w / 2, y + h, { width: STYLE.frame }),
    text(x + 3, y + 5.8, [{ t: block.title }], { size: STYLE.sizeTitle }),
  ]
  rows.forEach(([left, right], i) => {
    const ry = y + 8 + i * 7 + 4.5
    if (i > 0) items.push(line(x, y + 8 + i * 7, x + w, y + 8 + i * 7, { width: STYLE.frame }))
    if (left)  items.push(text(x + 3, ry, [{ t: fill(left) }], { size: STYLE.sizeField }))
    if (right) items.push(text(x + w / 2 + 3, ry, [{ t: fill(right) }], { size: STYLE.sizeField }))
  })
  if (block.legend) {
    items.push(text(x - 4, y + h - 1, [{ t: block.legend }],
      { size: STYLE.sizeLegend, align: 'right', color: STYLE.switchFill }))
  }
  return items
}

function scaleBarItems(pageH, scaleDen, comma) {
  const mmPerM = 1000 / scaleDen
  const segM = scaleDen <= 500 ? 10 : 20
  const segMm = segM * mmPerM
  const x0 = MARGIN_MM + 6
  const y0 = pageH - MARGIN_MM - 6
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
  const cx = MARGIN_MM + 8
  const cy = MARGIN_MM + 12
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
 * @param {object}  o.titleBlock { title, rows: [[left, right]], legend }; {i}/{n} = sheet
 * @param {object}  o.show       which annotations to draw
 * @param {Array}   o.basemaps   per sheet: { dataUrl, xMm, yMm, wMm, hMm } or null
 * @param {number}  o.basemapOpacity
 * @param {boolean} o.comma      German decimal comma
 * @returns {{ pageW, pageH, sheets: Array<{ index, count, items }> }}
 */
export function buildPlan({
  tracks, switches = [], kmLines = [], sheets, paperKey, scaleDen, titleBlock,
  show = {}, basemaps = [], basemapOpacity = 0.4, comma = true, switchText = {},
}) {
  const swText = { ...SWITCH_TEXT, ...switchText }
  const [pageW, pageH] = PAPER_FORMATS[paperKey]
  const shown = {
    labels: true, switches: true, trackNames: true, mainPoints: true,
    kilometrage: false, ...show,
  }
  const clip = { x: MARGIN_MM, y: MARGIN_MM, w: pageW - 2 * MARGIN_MM, h: pageH - 2 * MARGIN_MM }

  const built = sheets.map((sheet, i) => {
    const withTransform = {
      ...sheet,
      transform: makeTransform(sheet.center, pageW, pageH, scaleDen, sheet.rotDeg),
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

    items.push(...frameItems(pageW, pageH))
    items.push(...scaleBarItems(pageH, scaleDen, comma))
    items.push(...northArrowItems(sheet.rotDeg))
    if (titleBlock) items.push(...titleBlockItems(pageW, pageH, titleBlock, sheet))

    return { index: sheet.index ?? i, count: sheet.count ?? sheets.length, items }
  })

  return { pageW, pageH, sheets: built }
}
