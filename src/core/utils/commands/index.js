// commands — what the dialogs commit, as pure functions of their inputs: new
// tracks and elements, switches, connecting, splicing, reconnecting, geometry
// edits and what an optimizer run sends and keeps.
//
// This file is the module's public face: code outside src/core/utils/commands/
// imports from here and nowhere else (tools/modules.mjs). What is not listed is
// the module's own business. See docs/modules/commands.md.

export { buildCrossingConnect, crossingConnectOutcome, crossingConnectSolutions } from './connectCrossing'
export { connectRemedies } from './connectRemedies'
export { adoptCrossover, crossoverRequest } from './crossover'
export { editCommit, editStart, switchConnectionOf, takeApart } from './crossoverEdit'
export { buildSwitchConnect, switchConnectChainSolutions, switchConnectOutcome, switchConnectSolutions } from './connectSwitch'
export { elementRoles, rolesFor, withRole } from './elementRoles'
export { mergeElementEdits, planElementChange, planIntermediateChange } from './editGeometry'
export { optimizedTrack, optimizeErrorText, optimizeRequest } from './optimizeApply'
export { grundText } from './optimizeReport'
export {
  axisPoints, buildReconnect, elementPoints, reconnectFromAnswer, reconnectPick, reconnectRange,
  reconnectRequest, replacedSpan, stretchDefaults,
} from './reconnect'
export {
  buildSCurve, computeShiftBounds, connectionPick, isUsableStem, preferredShift, REASON_MSG,
  settleConnection, shiftSnaps, stems, waOffset,
} from './sCurve'
export {
  buildSplice, clearanceRequest, neighbourAxis, neighbourAxisNear, secondPickRefusal,
  picksAtSpeed, settleLengths, spliceFromAnswer, spliceKeptCant, splicePick, spliceRequest,
} from './splice'
export {
  buildCrossingOnTrack, buildSwitchOnTrack, crossingOnTrackPlacement, crossingOnTrackSlider,
  SLIDER_REACH, switchOnTrackPlacement, switchOnTrackRemnant, switchOnTrackSlider,
  switchOnTrackToeValid,
} from './switches'
export {
  buildConnectCurved, buildConnectStraight, buildCurvedLineTrack, buildLineTrack,
  buildParallelLineTrack, buildParallelTrack, cantAtTrackEnd, curveCant, trackMeta,
} from './tracks'
