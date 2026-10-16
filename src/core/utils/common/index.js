// common — small helpers without a railway in them: number formatting, files,
// keyboard, the user's own settings, chart axes, SVG paths, the app's logo.
//
// This file is the module's public face: code outside src/core/utils/common/
// imports from here and nowhere else (tools/modules.mjs). What is not listed is
// the module's own business. See docs/modules/common.md.

export { niceStep, stepDecimals, ticks } from './chartAxes'
export { downloadBlob, downloadJSON, downloadText, readFileBuffer, readFileText } from './fileUtils'
export { clamp, formatNumber } from './format'
export { isMultilineTarget, isProjectRedo, isProjectUndo } from './keyboard'
export { fileToLogo } from './logoImage'
export {
  MARK_BLUE, MARK_GROUND, MARK_HEIGHT, MARK_INNER, MARK_LETTERS, MARK_LINK_BLUE, MARK_LINK_OPACITY,
  MARK_LINKS, MARK_RAIL, MARK_WIDTH,
} from './logoMark'
export { MAPTILER_KEY } from './mapTiler'
export {
  fileToProjectImage, PROJECT_IMAGE_MIME, PROJECT_IMAGES, projectImagePicture, projectImageUrl,
} from './projectImages'
export { loadSettings, saveSettings, SETTINGS_KEY } from './settings'
export { parseSvgPath } from './svgPath'
