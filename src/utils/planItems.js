

// The plan's drawing primitives and text metrics: pens, type sizes, text boxes, culling, paths and texts in page millimetres.

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
  bufferStopHalf:  1.5,   // half-width of a buffer stop's body [m, true to scale]
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
export const fmtNum = (v, decimals, comma) => {
  let s = (Math.round(v * 10 ** decimals) / 10 ** decimals).toFixed(decimals)
  if (decimals > 0) s = s.replace(/0+$/, '').replace(/\.$/, '')
  return comma ? s.replace('.', ',') : s
}

/**
 * Direction a plane bearing takes on the page, counter-clockwise positive.
 * makeTransform turns the plane clockwise by rotDeg and flips north to −y, so a
 * bearing β leaves along the page angle 90° − (β + rotDeg).
 */
export const pageAngle = (bearing, rotDeg) => 90 - (bearing + rotDeg)

/**
 * How far below the baseline the middle of the capitals sits, in em. A text is
 * anchored on its baseline, so a label meant to straddle a line has to drop by
 * this much — otherwise its whole body sits on one side of it.
 */
export const CAP_CENTRE = 0.35

/** The direction "down" across a text set at this page angle. */
export const pageDown = (angle) => {
  const rad = angle * Math.PI / 180
  return [Math.sin(rad), Math.cos(rad)]
}

/** Normal to the left of a page direction, seen on the page. */
export const pageLeft = (angle) => {
  const rad = angle * Math.PI / 180
  return [-Math.sin(rad), -Math.cos(rad)]
}

/** Text turned so it never stands on its head. */
export const readable = (angle) => {
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
export function cullItems(items, area) {
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
    let box = textBox(item)
    // A mark drawn with a label — an arrow beside a number — counts as part of it.
    for (const mark of item.marks ?? []) {
      const b = pathBox(mark.d)
      box = {
        minX: Math.min(box.minX, b.minX), minY: Math.min(box.minY, b.minY),
        maxX: Math.max(box.maxX, b.maxX), maxY: Math.max(box.maxY, b.maxY),
      }
    }
    if (!boxInArea(box, area) || boxes.some(b => boxesOverlap(b, box))) continue
    boxes.push(box)
    keep.add(item)
  }

  // A label's marks stand or fall with it.
  return paths.flatMap(item => (item.type !== 'text' ? [item]
    : keep.has(item) ? [item, ...(item.marks ?? [])] : []))
}

/** Path commands from the track plane into page millimetres. */
export function mapPath(cmds, transform) {
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

export const polyPath = (pts) => [...pts.map((p, i) => [i ? 'L' : 'M', p[0], p[1]]), ['Z']]

/** Circle as four cubics; 0.5523·r is the control arm that fits a quarter. */
const KAPPA = 0.5522847498
export function circlePath(cx, cy, r) {
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
export function arrowItems(hx, hy, ux, uy) {
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

export const path = (d, opts = {}) => ({
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
export const text = (x, y, parts, opts = {}) => ({
  type: 'text', x, y,
  parts: typeof parts === 'string' ? [{ t: parts }] : parts,
  angle: opts.angle ?? 0,
  size: opts.size ?? STYLE.sizeField,
  align: opts.align ?? 'left',
  color: opts.color ?? STYLE.ink,
  bold: opts.bold ?? false,
  prio: opts.prio ?? 0,
  path: opts.path ?? null,
  ...(opts.marks ? { marks: opts.marks } : {}),
})

/** What a label is worth when two of them want the same spot. */
export const PRIO = {
  joint:   1,
  track:   2,
  switch:  3,
  main:    4,
  element: 5,
}

export const line = (x1, y1, x2, y2, opts) => path([['M', x1, y1], ['L', x2, y2]], opts)

/**
 * How a plan names a turnout and its two routes. The caller passes what the
 * language says — EW/SS for the unbent form, r_z/r_d for the branch, r_s/r_m
 * for the through route; IBW and ABW are drawing abbreviations either way — so
 * a plan reads like the map it was drawn from. These are the fallbacks.
 */
