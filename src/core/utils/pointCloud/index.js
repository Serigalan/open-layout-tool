// pointCloud — point clouds: LAS/LAZ and E57 read as streams, tiled into OPFS,
// cut into sections, rails detected and traced, registration, clearance scans.
//
// This file is the module's public face: code outside src/core/utils/pointCloud/
// imports from here and nowhere else (tools/modules.mjs). What is not listed is
// the module's own business. See docs/modules/pointCloud.md.

export { BOTTOM_BAND, checkClearance } from './clearanceCheck'
export { scanClearance } from './clearanceScan'
export { cacheGet, cacheLimit, cachePut, cacheUsage, clearCache, forgetCache, setCacheLimit } from './cloudCache'
export { cloudPlane, cloudToPlane, planeMapper } from './cloudCrs'
export { CLOUD_CRS, count, crsHint, duration, mb, sizeText, stepText } from './cloudFormat'
export { cloudSize, outlineFeature } from './cloudOutline'
export { coloringsFor, INTRUSION_COLOR, paintCloudCanvas } from './cloudPaint'
export { probeExtent, projectPlane } from './cloudProbe'
export { readCloudHeader } from './cloudReader'
export { registrationHook } from './cloudRegistration'
export { cloudSectionPoints, forgetAllClouds, forgetCloud } from './cloudSection'
export { cloudServerHook } from './cloudServer'
export { sourceOf } from './cloudSource'
export {
  deleteCloud, estimateCloudBytes, INDEX_FILE, listClouds, opfsAvailable, persistStorage,
  storageEstimate, storagePersisted,
} from './cloudStore'
export { importLevels } from './importPipeline'
export { fileSource } from './lasReader'
export { formatName, pointsAsText, PREVIEW_POINTS } from './lasText'
export { previewPoints, startImport } from './pointCloudImport'
export { readableClouds } from './projectClouds'
export {
  axisPointsCsv, cantMm, detectInClouds, lineGuide, soHeight, TRACE_STEP, traceTrack, trackGuide,
} from './railTrace'
export { applyMatrix, IDENTITY, invertMatrix, solveRegistration } from './registration'
export { runIsActive, runsOnServer, serverRunHook } from './serverRuns'
export { cloudRefsOf, shiftSurvey, surveyChanges } from './surveyShift'
export { decodeCloudSegment, LEVELS, originalGrid, segmentPlacement } from './tiles'
