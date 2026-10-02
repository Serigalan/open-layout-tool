import { PAPER_FORMATS, TITLE_COLUMN_MM, drawingArea, makeTransform } from './planExport'
import { sheetFootprint } from './planSketch'
import { SWITCH_TEXT, trackItems } from './planTrackItems'
import { cullItems } from './planItems'
import { fullTitleBlockItems, titleBlockItems } from './planTitleBlock'
import { frameItems, northArrowItems, scaleBarItems } from './planSheet'

/**
 * The plan as a list of drawing primitives per sheet, in page millimetres
 * (x right, y down, origin at the top left corner of the paper). A backend only
 * has to translate four types, so the same plan can be drawn into a PDF or an
 * SVG without either knowing anything about railways:
 *
 *   { type: 'path',  d, stroke, width, dash, fill, opacity }
 *   { type: 'text',  x, y, angle, size, align, parts: [{ t, sub, color }], color, prio, path, marks? }
 *
 * A text with a `path` — a page polyline — is set along it instead of at x/y,
 * so a label on a curve bends with the curve. SVG draws those with a real
 * <textPath>; the PDF backend walks the polyline and places the glyphs itself,
 * because PDF has no such operator. A text's `marks` are paths that belong to
 * the label — an arrow beside a number — and give way with it; culling hands
 * them on as paths of their own, so no backend has to know them.
 *   { type: 'image', dataUrl, x, y, w, h, opacity }
 *   { type: 'group', clip: { x, y, w, h }, items }
 *
 * `angle` is counter-clockwise positive, as jsPDF takes it; SVG negates it.
 * Path commands are the same subset planGeometry produces, transformed here
 * from the track plane into page millimetres — which is an affine map, so
 * Bézier control points come along unchanged.
 */


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
 *                          With `full`: { title, range, subtitle, scale, code, systems, parties,
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
  tracks, switches = [], kmLines = [], endMarks = [], sheets, paperKey, scaleDen, titleBlock,
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
        { tracks, switches, kmLines, endMarks, show: shown, comma, scaleDen, switchText: swText }), clip),
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
