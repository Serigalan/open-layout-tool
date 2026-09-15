// SVG-based curved labels that follow LineString geometry.
//
// One shared full-viewport SVG hosts all labels (instead of one SVG per
// label). On map movement only the viewport-visible labels are reprojected;
// labels whose on-screen path is shorter than their text are hidden.

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Below this zoom no label is drawn, and the type size is measured from it. */
const MIN_ZOOM = 15

/**
 * A turnout's designation goes earlier than the rest. Every other label is
 * written along the element it belongs to and drops out on its own once that
 * element is too short on screen to carry the text; this one is set beside the
 * turnout and belongs to no element, so it needs a zoom of its own to go by.
 */
export const SWITCH_LABEL_MIN_ZOOM = 18

let _labels = []          // { coords, bbox, pathEl, textEl, unitWidth, minZoom, avoid }
let _container = null
let _svg = null
let _debounceTimer = null

function ensureSvg(map) {
  // Container may have been removed from the DOM (e.g. on a style change).
  if (_container && !_container.parentNode) {
    _container = null
    _svg = null
  }
  if (_svg) return _svg
  _container = document.createElement('div')
  _container.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:hidden;z-index:1'
  map.getCanvasContainer().appendChild(_container)
  _svg = document.createElementNS(SVG_NS, 'svg')
  _svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none'
  _container.appendChild(_svg)
  for (const label of _labels) {           // re-attach after container loss
    _svg.appendChild(label.pathEl)
    _svg.appendChild(label.textEl)
  }
  return _svg
}

// `text` is either a plain string, or an array of parts for rich labels:
//   [{ t: 'l' }, { t: 'u', sub: true }, { t: ' = 60m' }]  →  l with subscript u.
function appendText(textPath, text) {
  if (!Array.isArray(text)) {
    textPath.textContent = text
    return
  }
  for (const part of text) {
    const tspan = document.createElementNS(SVG_NS, 'tspan')
    tspan.textContent = part.t
    if (part.sub) {
      tspan.setAttribute('baseline-shift', '-25%')
      tspan.setAttribute('font-size', '75%')
    }
    textPath.appendChild(tspan)
  }
}

// Approximate text width in font-size units (average glyph ≈ 0.62 em;
// subscript parts are rendered at 75%).
function estimateUnitWidth(text) {
  const parts = Array.isArray(text) ? text : [{ t: text }]
  let units = 0
  for (const part of parts) units += part.t.length * (part.sub ? 0.75 : 1)
  return units * 0.62
}

export function updateLabels(map) {
  if (_labels.length === 0) return
  if (_debounceTimer !== null) return
  _debounceTimer = requestAnimationFrame(() => {
    _debounceTimer = null
    _updateLabelsNow(map)
  })
}

function _updateLabelsNow(map) {
  const zoom = map.getZoom()
  const visible = zoom > MIN_ZOOM
  if (_svg) _svg.style.display = visible ? '' : 'none'
  if (!visible) return

  const fontSize = Math.round(7 + (zoom - MIN_ZOOM) * (17 / 9))
  const bounds = map.getBounds()
  const west = bounds.getWest(), east = bounds.getEast()
  const south = bounds.getSouth(), north = bounds.getNorth()

  for (const label of _labels) {
    if (zoom <= label.minZoom) {
      label.textEl.style.display = 'none'
      continue
    }
    const [minX, minY, maxX, maxY] = label.bbox
    if (maxX < west || minX > east || maxY < south || minY > north) {
      label.textEl.style.display = 'none'
      continue
    }

    // Project to screen pixels; reverse when the text would be upside-down.
    const points = label.coords.map(c => map.project(c))
    const leftToRight = points[points.length - 1].x >= points[0].x
    const ordered = leftToRight ? points : [...points].reverse()

    let d = `M ${ordered[0].x} ${ordered[0].y}`
    let screenLen = 0
    for (let j = 1; j < ordered.length; j++) {
      d += ` L ${ordered[j].x} ${ordered[j].y}`
      screenLen += Math.hypot(ordered[j].x - ordered[j - 1].x, ordered[j].y - ordered[j - 1].y)
    }

    // Hide labels that do not fit on their element.
    if (screenLen < label.unitWidth * fontSize) {
      label.textEl.style.display = 'none'
      continue
    }

    label.textEl.style.display = ''
    label.pathEl.setAttribute('d', d)
    label.textEl.setAttribute('font-size', fontSize)
    // Text hangs above its line. Where the label was given something it must
    // not cover — a switch body, which fills the side one of its two routes
    // faces — and that thing lies above the line here, the text goes below it
    // instead. Decided on screen, so it holds however the map is turned and
    // whichever way round the element itself was stored.
    label.textEl.setAttribute('dy', coversAvoid(map, label, ordered) ? fontSize * 1.1 : -fontSize * 0.4)
  }
}

/**
 * Does the label's own side of its line — the side the text hangs on — face the
 * point the label was told to keep clear of? Screen coordinates run y down, so
 * that side is the one a negative cross product puts a point on.
 */
function coversAvoid(map, label, ordered) {
  if (!label.avoid || ordered.length < 2) return false
  const i = Math.max(0, Math.floor((ordered.length - 1) / 2))
  const p = ordered[i], q = ordered[i + 1] ?? ordered[i - 1] ?? p
  const dx = q.x - p.x, dy = q.y - p.y
  if (!dx && !dy) return false
  const a = map.project(label.avoid)
  return dx * (a.y - p.y) - dy * (a.x - p.x) < 0
}

export function clearTrackLabels() {
  if (_debounceTimer !== null) {
    cancelAnimationFrame(_debounceTimer)
    _debounceTimer = null
  }
  _labels = []
  _container?.remove()
  _container = null
  _svg = null
}

export function createTrackLabel(map, coords, text, { minZoom = MIN_ZOOM, avoid = null } = {}) {
  const svg = ensureSvg(map)

  const pathId = `lbl-${Math.random().toString(36).slice(2)}`
  const pathEl = document.createElementNS(SVG_NS, 'path')
  pathEl.setAttribute('id', pathId)
  pathEl.setAttribute('fill', 'none')

  const textEl = document.createElementNS(SVG_NS, 'text')
  textEl.setAttribute('class', 'track-label-svg')
  const textPath = document.createElementNS(SVG_NS, 'textPath')
  textPath.setAttribute('href', `#${pathId}`)
  textPath.setAttribute('startOffset', '50%')
  textPath.setAttribute('text-anchor', 'middle')
  appendText(textPath, text)
  textEl.appendChild(textPath)

  svg.appendChild(pathEl)
  svg.appendChild(textEl)

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of coords) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }

  _labels.push({
    coords, bbox: [minX, minY, maxX, maxY], pathEl, textEl,
    unitWidth: estimateUnitWidth(text), minZoom, avoid,
  })
}
