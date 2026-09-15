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
}

// Scale denominators → mm on paper per metre in reality.
// 1:500  → 1000/500  = 2 mm/m ; 1:1000 → 1000/1000 = 1 mm/m
export const SCALES = { '500': 500, '1000': 1000 }

export const MARGIN_MM = 12   // outer margin around the drawing area

/** Drawing area of a sheet, in page millimetres. */
export function drawingArea(pageW, pageH) {
  return { x: MARGIN_MM, y: MARGIN_MM, w: pageW - 2 * MARGIN_MM, h: pageH - 2 * MARGIN_MM }
}

/**
 * Build the transform from plane metres to page millimetres.
 * @param center   { e, n } plane centre of the drawing (maps to page centre)
 * @param pageW    page width [mm]
 * @param pageH    page height [mm]
 * @param scaleDen scale denominator (500 or 1000)
 * @param rotDeg   rotation of the content, clockwise, in degrees.
 *                 0 = North up, 180 = South up.
 * @returns function (e, n) → [xMm, yMm]
 */
export function makeTransform(center, pageW, pageH, scaleDen, rotDeg) {
  const mmPerM = 1000 / scaleDen
  const cx = pageW / 2
  const cy = pageH / 2
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
