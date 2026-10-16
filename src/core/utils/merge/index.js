// merge — comparing and merging two states of a project (three-way merge,
// id remapping) and drawing the comparison on the map.
//
// This file is the module's public face: code outside src/core/utils/merge/
// imports from here and nowhere else (tools/modules.mjs). What is not listed is
// the module's own business. See docs/modules/merge.md.

export { diffProject, diffEntries, diffSize, primary } from './diff'
export { mergeProject, resolve, validationConflicts } from './merge'
export {
  clearFeatures, COMPARE_COLORS, comparisonFeatures, comparisonTopology, drawable, findObject,
  objectFeatures, recordFeatures, showFeaturesSoon, trackStylesOf, zoomToFeatures,
} from './compareLayer'
