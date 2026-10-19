// km — the DB kilometrage lines: the stretch of a line a project keeps, where
// a point lies on it, and the line and track name that follow.
//
// This file is the module's public face: code outside src/core/utils/km/
// imports from here and nowhere else (tools/modules.mjs). What is not listed is
// the module's own business. See docs/modules/km.md.

export { formatKm, kmOnPieces, toMercator } from './kmLineMath'
export { clipRuns, ensureKmLines, projectBox } from './kmLineSource'
export { kmForTrackPoint } from './kmLineUtils'
export { KmTileSource } from './kmTileSource'
export { elementPath, elementsPath, identifyTrackLine, kmTrackName, lineNameOf } from './lineLookup'
