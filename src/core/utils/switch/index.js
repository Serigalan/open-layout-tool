// switch — turnouts and crossings: the forms of DB Ril 800.0120, their routes,
// the drawn symbol, where a turnout may lie, switch connections, connecting to
// an open track end, and what stays when a switch is deleted.
//
// This file is the module's public face: code outside src/core/utils/switch/
// imports from here and nowhere else (tools/modules.mjs). What is not listed is
// the module's own business. See docs/modules/switch.md.

export {
  ALL_SWITCH_TYPES, asRadius, bauform, CROSSING_TYPES, DEFAULT_SWITCH_TYPE_IDX, SWITCH_PICK_TYPES,
  switchBranchLength, switchBranchSections, switchFormChain, switchStraightLength,
  switchMark, switchTypeByLabel,
} from './catalogue'
export {
  connectionAnchor, connectionRoots, fitConnectingElement, joinRouteIntoTrack, refitCount,
  refitTrackEnd,
} from './connectToTrack'
export {
  computeCrossingGeometryUtm, crossingAngle, crossingElements, crossingEndDistance,
  crossingLegFitsTrack, crossingLegRadius, crossingLegSignedRadius, piecesOnRadius,
} from './crossing'
export { formDetail, switchDetail } from './detail'
export { DEFAULT_MIDS, MID_OPEN, midUnknowns } from './midChain'
export {
  negR, switchBranchChain, switchChainBauform, switchChainBearingAt, switchChainPointUtm,
  switchChainTo, switchElementRoute, switchRouteBearingAt, switchRoutePointUtm, switchRouteVaries,
  utmEndRoute,
} from './route'
export { nearestValid, settleStation, uniqueStations, validIntervals } from './stationSlider'
export {
  buildConnectionElements, computeSwitchConnections, CONNECTION_SPEEDS, orientStemToward,
  solveSwitchConnection, SWITCH_TYPES,
} from './switchConnectionUtils'
export { planSwitchDeletion, switchParts } from './switchDelete'
export {
  mainRouteLength, routeFrom, sleeperOffsets, sleeperThrough, switchLds, turnoutSleepers,
} from './sleepers'
export { clickStation, placeSwitchOnTrack } from './switchPlacement'
export {
  computeSwitchGeometryUtm, crossingBodyUtm, crossingRoutesFromTracks, lcsLine, lcsLineUtm,
  rebuildSwitchSymbol, switchFillRing, switchLabelGeometry, switchRoutePointsUtm,
  switchRoutesFromTracks,
} from './symbol'
export { WEICHEN_REGELWERK, weichenGruppen } from './weichenRegelwerk'
