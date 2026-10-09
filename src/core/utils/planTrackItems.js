import { kmForTrackPoint } from './kmLineUtils'
import { formatKm } from './kmLineMath'
import { trackPathUtm, mainPoints, switchSymbolUtm, trackPointAt, isArc, isTransition } from './planGeometry'
import { pointAtStationUtm, trackLength } from './heightUtils'
import { BUFFER_STOP, bufferStopStations } from './trackEndMarks'
import { FACE_HALF_WIDTH } from './bufferStopGeometry'
import { cantExceptionOf, computeCantDef, worstCantOf } from './rules/cant'
import {
  CAP_CENTRE, PRIO, STYLE, arrowItems, circlePath, fmtNum, line, mapPath, pageAngle, pageDown,
  pageLeft, path, polyPath, readable, text, textWidth,
} from './planItems'

// What a sheet shows of the tracks: lines, labels, stations, switches, kilometrage and main points.

export const SWITCH_TEXT = {
  plain: 'EW', ibw: 'IBW', abw: 'ABW', abw_straight: 'ABW', sym: 'SYM',
  rBranch: 'z', rMain: 's', cantException: 'Ausnahme',
}

/** Is this element a switch's own geometry rather than a running track? */
const isBranch = (el) => !!el.switchBranch

/**
 * What separates one design value from the next. The extra space is not
 * decoration: in Helvetica a pipe and a lower-case l are near enough identical
 * that "| l =" reads as "l l =" when they sit one space apart.
 */
const separatorPart = () => ({ t: '  |  ', color: STYLE.separator })

/**
 * Label of one element: what a plan states about it — radius, length, cant and
 * cant deficiency, the values a design is read by. The deficiency is stated
 * rather than the speed it was derived from, because it is what the geometry
 * has to answer for; it needs a design speed to exist, so an element without
 * one carries none.
 *
 * `brief` keeps only radius and length: on an element too short to carry the
 * full set, those two still have to be readable.
 */
function elementParts(el, comma, { brief = false, switchText = SWITCH_TEXT } = {}) {
  const n = (v, d = 2) => fmtNum(v, d, comma)
  // A turnout's own route runs on the switch form's dimension, which is not a
  // design value of the alignment: it states the radius of that route and
  // nothing else, the same way the map labels it.
  if (isBranch(el)) {
    const route = el.switchRoute ?? (el.radius == null ? 'main' : 'branch')
    const r = (v) => (v == null ? '∞' : `${n(Math.abs(v))} m`)
    // Laid into a clothoid, the route is a clothoid and runs from one radius to
    // the other. The dash is set rather than an arrow: the PDF draws glyph by
    // glyph in a standard font, which has the one and not the other.
    const value = isTransition(el) ? `${r(el.r1)} – ${r(el.r2)}` : r(el.radius)
    const parts = [{ t: 'r' }, { t: route === 'main' ? switchText.rMain : switchText.rBranch, sub: true },
      { t: ` = ${value}` }]
    // A turnout canted past its plain limit stands on a written justification
    // (rules/cant: MAX_SWITCH_CANT). That justification is a design decision,
    // so the plan states it rather than leaving the raised cant unexplained.
    // `brief` drops it with everything else that does not fit the element.
    const reason = cantExceptionOf(el)
    if (!brief && reason) {
      parts.push(separatorPart(),
        { t: `u = ${n(worstCantOf(el), 0)} mm (${switchText.cantException}: ${reason})` })
    }
    return parts
  }
  if (isTransition(el)) {
    return [{ t: 'l' }, { t: el.transitionType === 'bloss' ? 'ub' : 'u', sub: true },
      { t: ` = ${n(el.length)} m` }]
  }

  const parts = []
  const add = (...p) => {
    if (parts.length) parts.push(separatorPart())
    parts.push(...p)
  }
  if (isArc(el)) add({ t: `r = ${n(Math.abs(el.radius))} m` })
  add({ t: `l = ${n(el.length)} m` })
  if (!brief && el.cant) add({ t: `u = ${n(Math.abs(el.cant), 0)} mm` })
  if (!brief && isArc(el) && el.speed) {
    add({ t: 'u' }, { t: 'f', sub: true },
      { t: ` = ${n(computeCantDef(el.speed, el.radius, el.cant ?? 0), 0)} mm` })
  }
  return parts
}

/** Station as it is written on a plan: 1+234.56 → kilometre plus metres. */
function stationText(station, comma) {
  const km = Math.floor(station / 1000)
  const m = station - km * 1000
  const mm = m.toFixed(2).padStart(6, '0')
  return `${km}+${comma ? mm.replace('.', ',') : mm}`
}

/**
 * The page polyline a label is set along: the track's own axis, offset sideways
 * by `gap`, sampled over the stretch the text needs. Text laid on this bends
 * with the alignment instead of cutting the chord of a curve.
 *
 * Two details decide whether it reads: the window is shifted back inside the
 * track when it would run off an end, and a stretch that runs right to left on
 * the page is reversed so the text is never upside down.
 *
 * Glyphs rise from the baseline towards the left of the path's own direction.
 * That side is the offset side only when the path was not reversed and the
 * label sits to the left anyway; in the other two cases the lettering would
 * grow back across the axis, so the baseline moves out by one text height.
 */
function labelPath(track, station, spanM, side, gap, size, rotDeg, transform, total, steps = 16) {
  let from = station - spanM / 2
  let to = station + spanM / 2
  if (from < 0)     { to = Math.min(total, to - from); from = 0 }
  if (to > total)   { from = Math.max(0, from - (to - total)); to = total }
  if (!(to > from)) return null

  const samples = []
  for (let i = 0; i <= steps; i++) {
    const at = trackPointAt(track, from + (to - from) * i / steps)
    if (at) samples.push(at)
  }
  if (samples.length < 2) return null

  const place = (at, off) => {
    const [x, y] = transform(at.point[0], at.point[1])
    const [nx, ny] = pageLeft(pageAngle(at.bearing, rotDeg))
    return [x + off * nx, y + off * ny]
  }
  const reversed = place(samples[samples.length - 1], 0)[0] < place(samples[0], 0)[0]
  const risesTowards = reversed ? -1 : 1
  const off = side * (gap + (risesTowards === side ? 0 : size))
  const pts = samples.map(at => place(at, off))
  if (reversed) pts.reverse()
  return pts
}

/** Everything drawn from the tracks themselves, clipped to the drawing area. */
export function trackItems(sheet, ctx) {
  const { tracks, switches, show, comma, scaleDen, switchText, kmLines, endMarks = [] } = ctx
  const transform = sheet.transform
  const items = []
  const mmPerM = 1000 / scaleDen

  // Where turnouts begin. Collected here, drawn last: the circle marks the toe
  // on its own, so nothing that crosses it may show through. Each node keeps
  // the side its branch turns to, which is what names the point WA and sets
  // that name on the branch's radius.
  const switchNodes = []
  const switchNodeAt = (x, y) => switchNodes.find(n =>
    Math.hypot(x - n.x, y - n.y) <= STYLE.switchNodeR + STYLE.switchNodeClear) ?? null

  // Switch bodies go under the axes: the axes are what the plan is about.
  if (show.switches) {
    const trackById = Object.fromEntries(tracks.map(tr => [tr.id, tr]))
    for (const sw of switches) {
      const sym = switchSymbolUtm(sw, trackById)
      if (!sym) continue
      // A crossing's body is two wedges, a pair of rings where a turnout's is
      // one — each becomes its own path, so each is clipped to its sheet alone.
      const fillRings = Array.isArray(sym.fill[0][0]) ? sym.fill : [sym.fill]
      for (const ring of fillRings) {
        items.push(path(mapPath(polyPath(ring), transform),
          { fill: STYLE.switchFill, stroke: null }))
      }
      if (sym.lcs) {
        items.push(path(mapPath([['M', ...sym.lcs[0]], ['L', ...sym.lcs[1]]], transform),
          { width: STYLE.switchLcs }))
      }
      const [nodeX, nodeY] = transform(sym.node[0], sym.node[1])
      switchNodes.push({ x: nodeX, y: nodeY, turn: sym.branchTurn })

      // The toe is a main point of the plan in its own right — the branch arc
      // begins there — but it belongs to no running track, so no main-point
      // list holds it. It is set like a Bogenanfang, on the radius of that arc,
      // with the turnout's number facing it from the other side.
      const toe = pageAngle(sym.bearing, sheet.rotDeg)
      const [tnx, tny] = pageLeft(toe)
      const turn = sym.branchTurn || 1
      const ox = turn * tnx
      const oy = turn * tny
      const angle = readable(Math.atan2(-oy, ox) * 180 / Math.PI)
      const [ddx, ddy] = pageDown(angle)
      const radial = (parts, out, prio) => {
        const reach = STYLE.radiusArrow + STYLE.mainTextGap
          + textWidth(parts, STYLE.sizeMain) / 2
        return text(
          nodeX + out * ox * reach + ddx * CAP_CENTRE * STYLE.sizeMain,
          nodeY + out * oy * reach + ddy * CAP_CENTRE * STYLE.sizeMain,
          parts, { angle, size: STYLE.sizeMain, align: 'center', prio })
      }
      items.push(radial([{ t: `WA ${stationText(sym.station, comma)}` }], -1, PRIO.main))
      if (sym.number != null) {
        items.push(radial([{ t: `W ${sym.number}` }], 1, PRIO.switch))
      }
      if (sym.label) {
        // Centred on the body, and on the side the branch does not take — the
        // fill is solid black, so a name on top of it would not be readable.
        const [x, y] = transform(sym.mid[0], sym.mid[1])
        const a = pageAngle(sym.midBearing, sheet.rotDeg)
        const [lx, ly] = pageLeft(a)
        const side = sym.branchTurn || 1
        const angle = readable(a)
        const [dx, dy] = pageDown(angle)
        items.push(text(
          x + side * lx * STYLE.trackNameGap + dx * CAP_CENTRE * STYLE.sizeTrack,
          y + side * ly * STYLE.trackNameGap + dy * CAP_CENTRE * STYLE.sizeTrack,
          [{ t: `${switchText[sym.bauform] ?? switchText.plain} ${sym.label}` }],
          { angle, size: STYLE.sizeTrack, align: 'center', prio: PRIO.switch }))
      }
    }
  }

  for (const track of tracks) {
    const els = (track.elements ?? []).filter(el => el.length > 0)
    if (!els.length) continue
    const branchOnly = els.every(isBranch)
    const total = els.reduce((sum, el) => sum + el.length, 0)
    // Text set along the axis: a little slack so it never touches the ends.
    const along = (station, parts, size, side, gap) => labelPath(
      track, station, textWidth(parts, size) / mmPerM * 1.1,
      side, gap, size, sheet.rotDeg, transform, total)

    items.push(path(mapPath(trackPathUtm(track), transform),
      { width: branchOnly ? STYLE.branchAxis : STYLE.axis }))

    if (show.labels) {
      let station = 0
      for (const el of els) {
        const mid = station + el.length / 2
        station += el.length
        const p = pointAtStationUtm(el, el.length / 2, track.epsg)
        const [x, y] = transform(p.easting, p.northing)
        // Outside of the curve, so the text never falls inside a tight bend.
        // A right-hand curve (radius > 0) has its centre to the right, so its
        // outside is the left-hand side the offset already points to.
        const side = isArc(el) && el.radius < 0 ? -1 : 1
        // Every element is named. One too short for the full set falls back to
        // radius and length, which is what a plan is read by; the label may then
        // reach past the element it belongs to, which the arrow-free side and
        // the collision pass keep legible.
        const full = elementParts(el, comma, { switchText })
        const parts = textWidth(full, STYLE.sizeElement) <= el.length * mmPerM
          ? full
          : elementParts(el, comma, { brief: true, switchText })
        items.push(text(x, y, parts, {
          size: STYLE.sizeElement, align: 'center', prio: PRIO.element,
          path: along(mid, parts, STYLE.sizeElement, side, STYLE.elementTextGap),
        }))
      }
    }

    // Beyond its elements a switch's own branch track carries no plan
    // annotation: it is the turnout's geometry, not a running track, so it has
    // no main points and no name of its own.
    if (branchOnly) continue

    if (show.mainPoints) {
      for (const mp of mainPoints(track)) {
        const [x, y] = transform(mp.point[0], mp.point[1])
        const [nx, ny] = pageLeft(pageAngle(mp.bearing, sheet.rotDeg))
        // Where a curve begins, the centre of that curve is to one side: for a
        // right-hand curve (radius > 0) to the right of travel, so the arrow
        // flies from there onto the point, along the radius. Elsewhere — a
        // straight starting, the track's own end — a plain tick will do.
        // A turnout's toe carries its own circle, name and number, so a track
        // that happens to be split there adds nothing.
        if (switchNodeAt(x, y)) continue

        const turn = mp.signedR ? Math.sign(mp.signedR) : 0
        if (turn) {
          items.push(...arrowItems(x, y, turn * nx, turn * ny))
        } else {
          items.push(line(x - nx * STYLE.mainTickHalf, y - ny * STYLE.mainTickHalf,
            x + nx * STYLE.mainTickHalf, y + ny * STYLE.mainTickHalf, { width: STYLE.mainTick }))
        }

        // The track's own station says where on the track a point lies, the
        // kilometrage where on the line it lies — a plan is read against the
        // second, so it goes after the first rather than in place of it.
        // Without a line for this track there is simply nothing to add.
        const km = show.kilometrage
          ? kmForTrackPoint(kmLines, track, mp.point)
          : null
        const parts = [{
          t: `${mp.code} ${stationText(mp.station, comma)}`
            + (km ? `   km ${formatKm(km.km)}` : ''),
        }]
        if (turn) {
          // On the radius, in line with the arrow and beyond its tail, so mark
          // and name read as the one annotation pointing at the point. The
          // baseline drops half a cap height so the text straddles that line
          // instead of hanging off one side of it.
          const ox = turn * nx
          const oy = turn * ny
          const reach = STYLE.radiusArrow + STYLE.mainTextGap
            + textWidth(parts, STYLE.sizeMain) / 2
          const angle = readable(Math.atan2(-oy, ox) * 180 / Math.PI)
          const [dx, dy] = pageDown(angle)
          items.push(text(
            x - ox * reach + dx * CAP_CENTRE * STYLE.sizeMain,
            y - oy * reach + dy * CAP_CENTRE * STYLE.sizeMain,
            parts, { angle, size: STYLE.sizeMain, align: 'center', prio: PRIO.main }))
        } else {
          // Nothing to point at, so the name follows the alignment itself.
          items.push(text(x, y, parts, {
            size: STYLE.sizeMain, align: 'center', prio: PRIO.main,
            path: along(mp.station, parts, STYLE.sizeMain, -1, STYLE.mainTextGap),
          }))
        }
      }
    }

    if (show.trackNames && track.name) {
      const p = pointAtStationUtm(els[0], 0, track.epsg)
      const [x, y] = transform(p.easting, p.northing)
      const parts = [{ t: track.name }]
      items.push(text(x, y, parts, {
        size: STYLE.sizeTrack, align: 'center', prio: PRIO.track,
        path: along(textWidth(parts, STYLE.sizeTrack) / mmPerM / 2, parts,
          STYLE.sizeTrack, 1, STYLE.trackNameGap),
      }))
    }
  }

  // Buffer stops, true to scale: the bar across the track at the face and the
  // body behind it filled. The brake length is the axis running on to the
  // track end, already drawn.
  const trackOf = new Map(tracks.map(tr => [tr.id, tr]))
  for (const mark of endMarks) {
    const track = mark.kind === BUFFER_STOP && trackOf.get(mark.trackId)
    if (!track) continue
    const st = bufferStopStations(trackLength(track), mark)
    const face = trackPointAt(track, st.face)
    const back = trackPointAt(track, mark.endpoint === 'BEGIN' ? st.body[0] : st.body[1])
    if (!face || !back) continue
    const across = (at, half) => {
      const r = at.bearing * Math.PI / 180
      const dx = half * Math.cos(r), dy = -half * Math.sin(r)
      return [[at.point[0] - dx, at.point[1] - dy], [at.point[0] + dx, at.point[1] + dy]]
    }
    const [f1, f2] = across(face, STYLE.bufferStopHalf)
    const [b1, b2] = across(back, STYLE.bufferStopHalf)
    items.push(path(mapPath(polyPath([f1, f2, b2, b1]), transform), { fill: STYLE.ink, stroke: null }))
    const [c1, c2] = across(face, FACE_HALF_WIDTH).map(p => transform(p[0], p[1]))
    items.push(line(c1[0], c1[1], c2[0], c2[1], { width: STYLE.axis }))
  }

  // Where the next sheet takes over.
  for (const j of sheet.joints ?? []) {
    const [x, y] = transform(j.point[0], j.point[1])
    const a = pageAngle(j.bearing, sheet.rotDeg)
    const [nx, ny] = pageLeft(a)
    const half = 14
    items.push(line(x - nx * half, y - ny * half, x + nx * half, y + ny * half,
      { width: STYLE.joint, dash: [3, 1.5], stroke: STYLE.jointColor }))
    items.push(text(x + nx * (half + 2), y + ny * (half + 2), [{ t: j.text }],
      { angle: readable(a), size: STYLE.sizeElement, align: 'center', color: STYLE.jointColor, prio: PRIO.joint }))
  }

  // Last, so the white ground of each circle covers the axis running through it.
  for (const node of switchNodes) {
    items.push(path(circlePath(node.x, node.y, STYLE.switchNodeR),
      { width: STYLE.mainTick, fill: '#ffffff' }))
  }

  return items
}
