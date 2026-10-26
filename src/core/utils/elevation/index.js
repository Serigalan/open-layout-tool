// elevation — the vertical alignment as a whole: the HP.* rules of the
// catalogue, one plane in a turnout, its tracks meeting at WA and ldS (or
// taken over one by one in the design mode), ground heights, and the profile
// along a route.
//
// This file is the module's public face: code outside src/core/utils/elevation/
// imports from here and nowhere else (tools/modules.mjs). What is not listed is
// the module's own business. See docs/modules/elevation.md.

export { fillHeights } from './elevationFill'
export { chosenTerrainSource, sampleHeightsWithSource, terrainSourceLabel, terrainSources } from './elevationSource'
export {
  checkVertical, lengthGovernedRadii, projectLineCategory, regularVerticalRadius, verticalFindings,
} from './gradientCheck'
export { routeElements, routeFindings, routeProfile, routeStationOfPart, trackAsRoute } from './routeProfile'
export {
  addDependentAt, DEPENDENCY_MODES, heightLinks, heightRoles, releaseDependency, restoreDependency, setDependencyMode,
  setToeLead, switchMisfits, withAllLdsPoints, withSwitchHeights, withToesJoined, withTurnoutTwin,
} from './switchChain'
export { lockBreach } from './heightLocks'
export { heightContext, trackHeightAt } from './switchGradient'
