import { FRAME, FRAME_WIDTH, TITLE_COLUMN_MM } from './planExport'
import { BLOCK_ORIGIN, LOGO_PATHS, MM_PER_UNIT } from './planLogo'
import { parseSvgPath } from './svgPath'
import { format } from '../locales/i18n'
import { STYLE, line, mapPath, path, text } from './planItems'

// The title blocks, compact and full (DB template), with logo, sketch and fields.

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
export function titleBlockItems(pageW, pageH, block, sheet) {
  const w = TITLE_COLUMN_MM
  const h = COMPACT_BLOCK_H
  const t = COMPACT_TABLE_X
  const ox = pageW - FRAME.right - w
  const oy = pageH - FRAME.bottom - h
  const fill = (str) => format(str, { i: sheet.index + 1, n: sheet.count })
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
export const fitSize = (str, size, maxW) => {
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
 * revision table beside it and two free rows below, and the strip with scale,
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
/** The rows below the planner's column, which name the reference systems and the paper. */
const SYSTEMS_BOX = { x: 130, y: 35, row: 8, rows: 6 }

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
 * place, date and signature); the location sketch beside a table whose rows
 * name the reference systems and the paper; and at the foot scale, code, who
 * drew, edited and checked the sheet, the plan title in three lines and three
 * cells, the middle one for the sheet number.
 * The caller supplies every text and image.
 */
export function fullTitleBlockItems(pageW, pageH, block, sheet) {
  const { w, h } = FULL_BLOCK
  const ox = pageW - FRAME.right - w
  const oy = pageH - FRAME.bottom - h
  const fill = (str) => format(str, { i: sheet.index + 1, n: sheet.count })
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

  // A caption over its value in each row, as the fields of a form.
  ;(block.systems ?? []).slice(0, SYSTEMS_BOX.rows).forEach(([caption, value], k) => {
    const y = SYSTEMS_BOX.y + k * SYSTEMS_BOX.row
    put(SYSTEMS_BOX.x + 1.5, y + 2.9, caption, 2.0)
    put(SYSTEMS_BOX.x + 1.5, y + 6.7, value, fitSize(value, 2.82, w - SYSTEMS_BOX.x - 3))
  })

  centred(9, 102.6, block.scale || '-', 2.82, 16)
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

/** The title block a plan asks for — detailed or compact. */
export const titleBlockFor = (pageW, pageH, block, sheet) => (block.full
  ? fullTitleBlockItems(pageW, pageH, block, sheet)
  : titleBlockItems(pageW, pageH, block, sheet))
