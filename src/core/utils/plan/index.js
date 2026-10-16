// plan — the plan export: sheets along the track, the drawing primitives, the
// title block, the schematic overview, and the PDF and SVG backends.
//
// This file is the module's public face: code outside src/core/utils/plan/
// imports from here and nowhere else (tools/modules.mjs). What is not listed is
// the module's own business. See docs/modules/plan.md.

export { assembleSchematic, assembleSite, BACKGROUNDS, planFileBase } from './planAssemble'
export { PAPER_FORMATS, SCALES } from './planExport'
export { normalizeHeader, PARTIES, STAFF } from './planHeader'
export { renderPdf } from './planPdf'
export { DEFAULT_CORRIDOR } from './planSchematic'
export { SCHEMATIC_SCALES } from './planSchematicPlan'
export { renderSvg } from './planSvg'
