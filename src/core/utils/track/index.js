// track — the records a project is made of: tracks, their stationing and
// heights, switch records and their ports, links, track ends and buffer stops,
// platforms, routes, splitting and joining tracks.
//
// This file is the module's public face: code outside src/core/utils/track/
// imports from here and nowhere else (tools/modules.mjs). What is not listed is
// the module's own business. See docs/modules/track.md.

export {
  bandFindings, bandRange, bandRuns, bandValueAt, cantBand, curvatureBand,
  elementSpans, speedBand, withBandValue, withCantEnds,
} from './alignmentBands'
export { bufferStopFeatures, FACE_HALF_WIDTH } from './bufferStopGeometry'
export { DEFAULT_HEIGHT_EPSG, HEIGHT_DATUMS, heightDatumLabel } from './heightDatums'
export {
  adjacentTracks, elementAtStation, endOfIndex, GIVEN_MODES, gradientAt, heightAt, heightStations,
  insertHeightPoint, jointGroup, jointHeightUpdates, neighbourStub, pointAtStationUtm, pointGrades,
  reverseHeights, roundHeight, sliceHeights, solveHeightPoint, splitHeights, tangentLength,
  trackLength, trackProfile, trackSamplePoints, truncateHeights, verticalCurveOverlaps,
  verticalCurves,
} from './heightUtils'
export {
  buildTypeFields, generateId, LINE_CATEGORIES, nextSwitchNumber, SIDE_CODES, SIDE_NAMES,
  switchDesignation, switchNumberOf, switchNumbersInUse, TRACK_USES, TYPE_CODES, TYPE_NAMES,
} from './identifierUtils'
export { STATUS_COLOR, STATUSES, switchStatus, trackStatus } from './planStatus'
export { EMPTY_PLATFORM_FORM, pickedStation, platformDraft, platformForm, platformFormValid } from './platformForm'
export {
  DEFAULT_PLATFORM_HEIGHT, edgeOffsets, elementStations, PLATFORM_CODE_MAX, PLATFORM_FRONT_OFFSET,
  PLATFORM_HEIGHTS, platformEdgeElevation, platformLength, platformRing, pointAtStation,
  pointOnElement, rebuildPlatformSymbol, stationFromClick, stationOnTrack,
} from './platformUtils'
export {
  closeGaps, extendRoute, nextRouteName, partStation, repairRoute, repairRoutes, resolveRoute,
  routeAt, routePointAt, routeStationOf,
} from './routes'
export { mergeChain } from './mergeElements'
export { switchMatches, trackMatches } from './search'
export {
  DEFAULT_SWITCH_KIND, elementBelongsToSwitch, elementOnSwitchRoute, isLinkSwitch,
  isModelledSwitch, LINK_KIND, newSwitchFields, portEnd, portsOf, portTrack, switchElementMark,
  switchKindLabelKey, switchRouteLabelKey, switchRoutePorts, turnoutDivergingPort, turnoutLinePort,
  turnoutLineRoute, unmarkSwitchElement, withPort,
} from './switchModel'
export { classifyTrackEnds, freeEnds, isOpenState, switchNodes, tracksOnFrom } from './topology'
export {
  BOUNDARY, BUFFER_STOP, BUFFER_STOP_LENGTH, BUFFER_STOP_TYPES, bufferStopFits, bufferStopStations,
  DEFAULT_BUFFER_STOP_TYPE, defaultBrakeLength, endKey, flipEndMarks, newBoundary, newBufferStop,
  pruneEndMarks, remapEndMarks,
} from './trackEndMarks'
export {
  assignmentFields, assignTracks, groupHeading, groupTitle, groupTracks, plannedNames,
  trackGroupKey, trackKind, trackListLabel, trackTypeName,
} from './trackGroups'
export { existingLinks, findTrackJoints, JOINT_TOL, linkAllJoints, linksForJoints, linkSymbol } from './trackLinkUtils'
export {
  flipSwitchEndpoints, inheritedSpeed, joinTracks, makeTrack, nextTrackName, portTracks,
  rebuildCoords, referencesTrack, remapSwitches, reverseTrack, trackEndAnchor, trackLabel,
} from './trackModel'
export { carveSwitchRoute, splitElementAt, splitTrackAtJoint } from './trackSplitUtils'
