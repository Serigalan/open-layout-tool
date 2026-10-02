import { FRAME, FRAME_WIDTH, drawingArea } from './planExport'
import { STYLE, fmtNum, line, path, text } from './planItems'

// The sheet furniture: frame and fold mark, scale bar, north arrow.

/** A fold mark this far from the right page edge, where the sheet folds to A4 (DIN 824). */
const FOLD_FROM_RIGHT = 190

/**
 * The sheet frame and the fold mark in the margin below it. The column a
 * title block keeps free has no rule of its own: the block closes it at the
 * foot and the legend heads it, as on the DB sheet. Drawn after everything
 * else, so no white ground of a title block eats into it and it runs the
 * same width all the way round.
 */
export function frameItems(pageW, pageH) {
  const { x, y, w, h } = drawingArea(pageW, pageH)
  return [
    path([['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']], { width: FRAME_WIDTH }),
    line(pageW - FOLD_FROM_RIGHT, y + h, pageW - FOLD_FROM_RIGHT, pageH, { width: 0.265 }),
  ]
}


export function scaleBarItems(pageH, scaleDen, comma) {
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

export function northArrowItems(rotDeg) {
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
