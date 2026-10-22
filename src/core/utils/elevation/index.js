// elevation — the vertical alignment as a whole: the HP.* rules of the
// catalogue, one plane in a turnout, the coupling points at the ldS, crossovers
// in cant, ground heights, and the profile along a route.
//
// This file is the module's public face: code outside src/core/utils/elevation/
// imports from here and nowhere else (tools/modules.mjs). What is not listed is
// the module's own business. See docs/modules/elevation.md.

export {
  crossoverCant, crossoverFrame, crossoverRanges, findCrossovers, lineCoordinates, lineTrackAt,
  planCrossoverGradient, rangeEndFromClick,
} from './crossoverGradient'
export { fillHeights } from './elevationFill'
export { chosenTerrainSource, sampleHeightsWithSource, terrainSourceLabel, terrainSources } from './elevationSource'
export {
  checkVertical, lengthGovernedRadii, projectLineCategory, regularVerticalRadius, verticalFindings,
} from './gradientCheck'
export { routeElements, routeFindings, routeProfile, routeStationOfPart, trackAsRoute } from './routeProfile'
export { coupleSwitchGradients, coupleSwitchHeights, heightRoles, pendingTurnouts } from './switchChain'
export { lockBreach } from './heightLocks'
export { coupledPoints, couplingOf, heightContext, planeDeviations, switchLds, trackHeightAt } from './switchGradient'
