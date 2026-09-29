/**
 * The sheet of paper a plan is drawn on: formats, scales and the one transform
 * from the track plane into page millimetres. Everything that draws — the plan
 * model, the PDF and SVG backends, the raster basemap — depends on this module
 * and nothing here depends on them, so the sheet stays a single definition.
 */

// Paper formats in mm — long strip plans (landscape). [width, height].
export const PAPER_FORMATS = {
  '297x840':  [840, 297],
  '297x1260': [1260, 297],
  '297x1920': [1920, 297],
}

// Scale denominators → mm on paper per metre in reality.
// 1:500  → 1000/500  = 2 mm/m ; 1:1000 → 1000/1000 = 1 mm/m
export const SCALES = { '500': 500, '1000': 1000 }

/**
 * Frame of a sheet [mm from the page edge]: the 20 mm filing margin on the
 * left, 5 mm on the other sides — the DB drawing sheet the title block is
 * taken from.
 */
export const FRAME = { left: 20, top: 5, right: 5, bottom: 5 }
/** Width of the sheet frame [mm]. */
export const FRAME_WIDTH = 0.5

/** Width [mm] of the column on the right that a detailed title block takes. */
export const TITLE_COLUMN_MM = 180
/** Width [mm] of the simple title block. */
export const COMPACT_BLOCK_MM = 145

/**
 * Drawing area of a sheet, in page millimetres. `reserve` is a column on the
 * right kept free of the drawing (title block, legend).
 */
export function drawingArea(pageW, pageH, reserve = 0) {
  return {
    x: FRAME.left, y: FRAME.top,
    w: pageW - FRAME.left - FRAME.right - reserve, h: pageH - FRAME.top - FRAME.bottom,
  }
}

/**
 * Build the transform from plane metres to page millimetres.
 * @param center   { e, n } plane centre of the drawing (maps to the centre of the drawing area)
 * @param pageW    page width [mm]
 * @param pageH    page height [mm]
 * @param scaleDen scale denominator (500 or 1000)
 * @param rotDeg   rotation of the content, clockwise, in degrees.
 *                 0 = North up, 180 = South up.
 * @param reserve  column on the right kept free [mm]; the content centres in what is left
 * @returns function (e, n) → [xMm, yMm]
 */
export function makeTransform(center, pageW, pageH, scaleDen, rotDeg, reserve = 0) {
  const mmPerM = 1000 / scaleDen
  const area = drawingArea(pageW, pageH, reserve)
  const cx = area.x + area.w / 2
  const cy = area.y + area.h / 2
  const th = (rotDeg * Math.PI) / 180
  const cos = Math.cos(th)
  const sin = Math.sin(th)

  return (e, n) => {
    // Offset from centre, in metres (east, north)
    const dE = e - center.e
    const dN = n - center.n
    // Rotate clockwise by th. (East = +x, North = +y in the plane.)
    const rx =  dE * cos + dN * sin
    const ry = -dE * sin + dN * cos
    // Page: x grows right, y grows DOWN, so north (ry+) maps to smaller y.
    return [cx + rx * mmPerM, cy - ry * mmPerM]
  }
}
