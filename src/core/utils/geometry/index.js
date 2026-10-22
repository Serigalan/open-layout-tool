// geometry — the projected plane and the element: coordinate systems and NTv2
// grids, straights, arcs and transitions (clothoid, Bloss), the display geometry
// derived from the design values, parallels and plane changes.
//
// This file is the module's public face: code outside src/core/utils/geometry/
// imports from here and nowhere else (tools/modules.mjs). What is not listed is
// the module's own business. See docs/modules/geometry.md.

export { epsgMismatches, nodeGaps, untrueLengths } from './chainChecks'
export {
  clothoidRadiusAt, computeClothoidUtm, curvatureOf, projectOnTransitionUtm, radiusOfCurvature,
  cantEnds, sampleTransitionUtm, transitionBearingAtUtm, transitionCantEnds, transitionPointAtUtm, withCantRamp,
} from './clothoidUtils'
export {
  crsCentre, crsDatum, crsLabel, crsName, crsSystem, crsSystemName, EPSG_OPTIONS, epsgForLngLat,
  FILE_CRS_OPTIONS, gkZone, isCrsSystem, planeCoordsToWgs84, projectCrsOptions, systemCodeAt,
  systemZones, toWgs, transformGridBearing, transformPlanePoint, utmToWgs84, wgs84ToUTM,
} from './coordinateUtils'
export { arcElement, arcFrom, straightElement, straightFrom, transitionElement } from './elementFactory'
export { reconstructElements } from './elementReconstruct'
export {
  arcCenter, arcCoordsFromRadiusUtm, arcPlanePoints, bearingAfterUtm, computeCurvedValuesUtm,
  computeStraightValuesUtm, derivedEndBearing, displayCoords, endPointCurvedUtm,
  endPointStraightUtm, nodeUtm, projectOnArcUtm, projectOnBearingUtm, resolveEndBearing,
  reverseElement, signedRadiusFrom3PointsUtm,
} from './elementUtils'
export {
  GEOJSON_MAXZOOM, SAGITTA_ELEMENT, SAGITTA_TRACK, STRAIGHT_VERTEX_SPACING, SWITCH_ROUTE_STEP,
} from './geometryPrecision'
export { loadedRegionalGrids, loadGridsFor, loadNtv2Grid, loadRegionalGrids } from './ntv2Grid'
export { offsetTrackElements } from './parallelUtils'
export { transformTrackToPlane } from './planeTransform'
