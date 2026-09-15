import { jsPDF } from 'jspdf'
import { PAPER_FORMATS } from './planExport'

/**
 * jsPDF backend for the plan model: it translates the four primitives and
 * knows nothing else about the plan.
 *
 * Two jsPDF conventions shape this file. `lines()` takes deltas — a 2-tuple is
 * a line, a 6-tuple a cubic whose three control points are all stated relative
 * to the point the segment starts at — so absolute page paths are converted
 * once, here. And font sizes are points while the document is in millimetres,
 * hence PT_PER_MM.
 */

const PT_PER_MM = 72 / 25.4
/** Subscript: three quarters of the size, dropped by a third of the baseline. */
const SUB_SIZE = 0.75
const SUB_DROP = 0.3

const hexToRgb = (hex) => {
  const h = hex.replace('#', '')
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16))
}

/** Page direction of a text angle and the direction "down" across it. */
function textAxes(angle) {
  const rad = angle * Math.PI / 180
  return {
    dir:  [Math.cos(rad), -Math.sin(rad)],
    down: [Math.sin(rad),  Math.cos(rad)],
  }
}

/** One subpath as jsPDF deltas, from an absolute command list. */
function toDeltas(cmds) {
  const out = []
  let cx = cmds[0][1]
  let cy = cmds[0][2]
  let closed = false
  for (const c of cmds.slice(1)) {
    if (c[0] === 'Z') { closed = true; continue }
    if (c[0] === 'L') {
      out.push([c[1] - cx, c[2] - cy])
      cx = c[1]; cy = c[2]
    } else {
      out.push([c[1] - cx, c[2] - cy, c[3] - cx, c[4] - cy, c[5] - cx, c[6] - cy])
      cx = c[5]; cy = c[6]
    }
  }
  return { start: [cmds[0][1], cmds[0][2]], deltas: out, closed }
}

/** Split a path at its moves — jsPDF paints one subpath per call. */
function subpaths(d) {
  const out = []
  let cur = null
  for (const c of d) {
    if (c[0] === 'M') {
      if (cur?.length > 1) out.push(cur)
      cur = [c]
    } else if (cur) {
      cur.push(c)
    }
  }
  if (cur?.length > 1) out.push(cur)
  return out
}

function drawPath(doc, item) {
  const style = item.fill && item.stroke ? 'DF' : item.fill ? 'F' : item.stroke ? 'S' : null
  if (!style) return

  if (item.stroke) {
    doc.setDrawColor(...hexToRgb(item.stroke))
    doc.setLineWidth(item.width)
  }
  if (item.fill) doc.setFillColor(...hexToRgb(item.fill))
  if (item.dash) doc.setLineDashPattern(item.dash, 0)

  for (const sub of subpaths(item.d)) {
    const { start, deltas, closed } = toDeltas(sub)
    if (deltas.length) doc.lines(deltas, start[0], start[1], [1, 1], style, closed)
  }

  if (item.dash) doc.setLineDashPattern([], 0)
}

/** Arc lengths along a polyline, so a position can be found by distance. */
function pathMetrics(pts) {
  const cum = [0]
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
  }
  return { cum, total: cum[cum.length - 1] }
}

/** Point and page angle at a distance along a polyline. */
function atLength(pts, cum, d) {
  let i = 1
  while (i < cum.length - 1 && cum[i] < d) i++
  const span = cum[i] - cum[i - 1] || 1
  const t = Math.min(Math.max((d - cum[i - 1]) / span, 0), 1)
  const [ax, ay] = pts[i - 1]
  const [bx, by] = pts[i]
  return {
    x: ax + (bx - ax) * t,
    y: ay + (by - ay) * t,
    // Page y grows downwards, so a clockwise screen turn is a negative angle.
    angle: Math.atan2(-(by - ay), bx - ax) * 180 / Math.PI,
  }
}

/**
 * Text along a path. PDF has no textPath operator, so each glyph is placed on
 * its own: centred on the point its own advance width puts it at, and turned
 * to the tangent there. Kerning is lost, which a drawing does not miss.
 */
function drawTextOnPath(doc, item) {
  const pts = item.path
  const { cum, total } = pathMetrics(pts)
  if (!(total > 0)) return

  const glyphs = []
  for (const part of item.parts) {
    const size = item.size * (part.sub ? SUB_SIZE : 1)
    doc.setFontSize(size * PT_PER_MM)
    for (const ch of [...part.t]) {
      glyphs.push({
        ch, size, w: doc.getTextWidth(ch),
        drop: part.sub ? item.size * SUB_DROP : 0,
        color: part.color ?? item.color,
      })
    }
  }
  const textW = glyphs.reduce((sum, g) => sum + g.w, 0)
  let at = item.align === 'center' ? (total - textW) / 2
    : item.align === 'right' ? total - textW : 0

  for (const g of glyphs) {
    const on = atLength(pts, cum, at + g.w / 2)
    const { down } = textAxes(on.angle)
    doc.setFontSize(g.size * PT_PER_MM)
    doc.setTextColor(...hexToRgb(g.color))
    doc.text(g.ch, on.x + down[0] * g.drop, on.y + down[1] * g.drop,
      { angle: on.angle, align: 'center' })
    at += g.w
  }
}

function drawText(doc, item) {
  if (item.path?.length > 1) {
    drawTextOnPath(doc, item)
    return
  }
  const { dir, down } = textAxes(item.angle)

  // Measure first: the parts are laid out along the text's own axis, so a
  // centred or right-aligned run has to start a known distance back.
  const widths = item.parts.map(p => {
    const size = item.size * (p.sub ? SUB_SIZE : 1)
    doc.setFontSize(size * PT_PER_MM)
    return doc.getTextWidth(p.t)
  })
  const total = widths.reduce((a, b) => a + b, 0)
  const shift = item.align === 'center' ? -total / 2 : item.align === 'right' ? -total : 0

  let offset = shift
  item.parts.forEach((p, i) => {
    const size = item.size * (p.sub ? SUB_SIZE : 1)
    const drop = p.sub ? item.size * SUB_DROP : 0
    doc.setFontSize(size * PT_PER_MM)
    doc.setTextColor(...hexToRgb(p.color ?? item.color))
    doc.text(p.t,
      item.x + dir[0] * offset + down[0] * drop,
      item.y + dir[1] * offset + down[1] * drop,
      { angle: item.angle })
    offset += widths[i]
  })
}

function drawImage(doc, item) {
  if (item.opacity < 1) doc.setGState(new doc.GState({ opacity: item.opacity }))
  doc.addImage(item.dataUrl, 'PNG', item.x, item.y, item.w, item.h)
  if (item.opacity < 1) doc.setGState(new doc.GState({ opacity: 1 }))
}

function drawItems(doc, items) {
  for (const item of items) {
    if (item.type === 'path')  drawPath(doc, item)
    else if (item.type === 'text')  drawText(doc, item)
    else if (item.type === 'image') drawImage(doc, item)
    else if (item.type === 'group') {
      doc.saveGraphicsState()
      doc.rect(item.clip.x, item.clip.y, item.clip.w, item.clip.h, null)
      doc.clip()
      doc.discardPath()
      drawItems(doc, item.items)
      doc.restoreGraphicsState()
    }
  }
}

/**
 * Render a plan (from buildPlan) into a jsPDF document — one page per sheet.
 * Helvetica is a PDF core font, so nothing has to be embedded.
 */
export function renderPdf(plan) {
  const { pageW, pageH } = plan
  const orientation = pageW >= pageH ? 'landscape' : 'portrait'
  const doc = new jsPDF({ unit: 'mm', format: [pageW, pageH], orientation })
  doc.setFont('helvetica', 'normal')
  doc.setLineJoin('round')
  doc.setLineCap('butt')

  plan.sheets.forEach((sheet, i) => {
    if (i > 0) doc.addPage([pageW, pageH], orientation)
    drawItems(doc, sheet.items)
  })
  return doc
}

/** Paper the plan is drawn on, for callers that only have the key. */
export const paperSize = (paperKey) => PAPER_FORMATS[paperKey]
