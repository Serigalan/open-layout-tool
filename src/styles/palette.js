// The colours that are drawn rather than styled (R6.3): MapLibre paint
// properties, SVG and canvas drawings — places a CSS variable cannot reach.
// Named here once, so no component carries a colour value of its own; the
// CSS uses the tokens in styles/tokens.css, which agree with these where they
// overlap.

export const PALETTE = Object.freeze({
  primaryDefault: '#303383',
  white: '#ffffff',
  black: '#000000',

  // Text and lines on drawings
  textStrong: '#333333',
  textDark: '#444444',
  textSoft: '#555555',
  label: '#777777',
  muted: '#888888',
  axis: '#999999',
  gridLine: '#eeeeee',
  error: '#e74c3c',
  danger: '#c0392b',

  // The map's own highlights
  mapHover: '#ff8c00',
  mapSelected: '#a52a1f',
  mapFlash: '#00a37a',
  mapCandidate: '#6c5ce7',

  // Previews of what a dialog would build
  previewPoint: '#1a237e',
  previewLine: '#1565c0',
  valid: '#2e7d32',
  invalid: '#c62828',
  cloudOutline: '#c0601a',

  // The longitudinal profile
  elementBoundary: '#c8c8d8',
  verticalCurve: '#c9c9c9',
  verticalCurveEnd: '#f5c400',
  verticalCurveEndEdge: '#a68500',

  // The cross section
  terrain: '#2e8b3a',
  assumed: '#8a8a8a',
  cloud: '#7a5a14',
  clear: '#1f7a3a',
  measuredAxis: '#b0136e',
  // The 3D view of the point clouds (phase 13), on its dark background.
  view3dAxis: '#ffd400',
  view3dRail: '#d8d8d8',
  view3dSurvey: '#2ee88a',
  view3dPlane: '#4f8cff',
  view3dOutline: '#ff3b30',
  view3dPick: '#ff2bd6',
  referenceAxis: '#6d4c41',
  topOfRail: '#e4e4ec',
  sleeper: '#d9d4cc',
  sleeperEdge: '#8d867a',
  rail: '#6b6b6b',
  datumNote: '#b35c00',

  // The kilometrage overlay's symbol
  iconBackground: '#f4f4f6',
  kmLine: '#0f766e',
  kmLineOther: '#78716c',
  kmJump: '#b3261e',
})

/** The colours a project may be drawn in (Settings). */
export const PROJECT_COLORS = Object.freeze([
  '#303383', '#786ABF', '#2980b9', '#16a085', '#27ae60',
  '#f39c12', '#e67e22', '#e74c3c', '#8e44ad', '#2c3e50',
])
