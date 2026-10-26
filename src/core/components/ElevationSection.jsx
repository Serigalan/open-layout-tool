import { useId, useState, useRef } from 'react'
import { insertHeightPoint } from '../utils/track'
import { routeStationOfPart } from '../utils/elevation'
import { deviationAt } from '../utils/survey'
import { clamp, niceStep, stepDecimals, ticks } from '../utils/common'
import { useI18n } from '../locales/i18nContext'
import { PALETTE } from '../styles/palette'
import { useDrag, useElementSize, useWheelZoom } from './chart/useChartViewport'
import { gradeLabel } from './chart/grade'

const MARGIN = { left: 60, right: 20, top: 30, bottom: 32 }
// Narrower than this and the gradient label would not fit between its points.
const GRADE_LABEL_MIN_PX = 52
// How close to the gradient a double click splits it, and how far it has to
// stay from a point already there.
const INSERT_HIT_PX = 8
const INSERT_POINT_GAP_PX = 7
// The strip below the profile that draws how far the gradient lies above or
// below the reference axis — its height and the gap above it [px].
const DEV_STRIP_PX = 64
const DEV_GAP_PX = 14

/** A finding worth drawing: something the rules said, short of "kept". */
const flagged = (entry) => entry?.severity && entry.severity !== 'ok'

/**
 * One longitudinal section of the Höhenplan (ElevationOverlay, decision 393):
 * the overlay shows it above the divider, below it, or in both — each with
 * its own zoom and pan, the data, the selection and the cursor shared (`s`,
 * from the overlay).
 *
 * Stations at 1:1, heights exaggerated, zoomable about the cursor and
 * pannable; a click picks a point (`onPick(index, e)`), Shift-drag a frame
 * (`select`), a double click on the gradient a new point there
 * (`onInsert({ trackId, heights, index, station, z })`). The view is fitted
 * to the data for another track, another exaggeration, once the area is
 * measured, and when `fitGen` says points came or went other than by an
 * edit here; a resize (the divider dragged) keeps the heights in its middle.
 * `empty` stands in for the drawing where there is nothing to draw.
 */
export default function ElevationSection({ s }) {
  const { t, fill, num } = useI18n()
  const {
    viewKey, exaggeration, points, profile, stubs, refRuns, refPoints, devShown, refAxis, limitZ, curves, overlaps,
    stretchAt, curveAt, linkState, selection, locked, lockedByHand, coupled, pointNote, curveNote, stretchNote,
    overlapNote, cursor, setCursor, heightAt, sectionStation, onTrackAt, onPick, select, onInsert, fitGen, empty,
  } = s
  const clip = `profile-clip${useId().replace(/:/g, '')}`
  const bodyRef = useRef(null)
  const svgRef  = useRef(null)
  const size = useElementSize(bodyRef)                // { w, h } of the drawing area
  const [view, setView] = useState(null)              // { k, x0, z0 }: px per m, station at the left edge, height at the bottom edge
  const [band, setBand]   = useState(null)            // rubber band { x0, y0, x1, y1 } while Shift-dragging
  const [hover, setHover] = useState(null)            // { station, z } a double click would add a point at
  const allPoints = [...points, ...stubs.flatMap(st => st.points)]
  const isSelected = (p) => selection.includes(p.index)

  // ── Fit the view to the data when the track or the exaggeration changes ───
  const plotW = size ? size.w - MARGIN.left - MARGIN.right : 0
  // The deviation strip, where shown, takes its share below the profile.
  const devPx = devShown ? DEV_STRIP_PX + DEV_GAP_PX : 0
  const plotBottom = size ? size.h - MARGIN.bottom - devPx : 0
  const plotH = size ? plotBottom - MARGIN.top : 0
  const [fitKey, setFitKey] = useState(null)
  const [seenH, setSeenH] = useState(null)       // the plot height the view was last laid out for
  // Re-fitted for another track or exaggeration, once the area is measured,
  // and when points appear or go (the terrain fill arriving, a reload; told by
  // `fitGen`) — not for an edited height, which must not throw the view
  // around — nor for a point added or deleted in the profile.
  // The reference axis counts as it is laid over the track or taken away.
  const fitPoints = [...allPoints, ...refPoints.map(p => ({ station: p.s, z: p.z }))]
  const wantFit = `${viewKey}|${exaggeration}|${size ? 1 : 0}|${devPx}|${fitGen}`
  if (size && fitPoints.length && fitKey !== wantFit) {
    const stations = fitPoints.map(p => p.station), zs = fitPoints.map(p => p.z)
    const sMin = Math.min(...stations), sMax = Math.max(...stations)
    const zMin = Math.min(...zs), zMax = Math.max(...zs)
    const ds = Math.max(sMax - sMin, 10), dz = Math.max(zMax - zMin, 1)
    const k = Math.min(plotW / ds, plotH / (dz * exaggeration)) * 0.85
    setView({
      k,
      x0: sMin - (plotW / k - ds) / 2,
      z0: zMin - (plotH / (k * exaggeration) - dz) / 2,
    })
    setFitKey(wantFit)
    setSeenH(plotH)
  } else if (size && view && seenH !== plotH) {
    // The drawing area grown or shrunk (the divider dragged): the heights in its middle stay there.
    if (seenH != null) setView(v => ({ ...v, z0: v.z0 + (seenH - plotH) / 2 / (v.k * exaggeration) }))
    setSeenH(plotH)
  }
  // ── Zoom about the cursor (both axes, the exaggeration stays) ─────────────
  useWheelZoom(svgRef, (f, px, py) => setView(v => {
    if (!v) return v
    const k = clamp(v.k * f, 1e-4, 1e4)
    const s = v.x0 + (px - MARGIN.left) / v.k
    const z = v.z0 + (plotBottom - py) / (v.k * exaggeration)
    return { k, x0: s - (px - MARGIN.left) / k, z0: z - (plotBottom - py) / (k * exaggeration) }
  }), !!size)

  // ── Pan by dragging, pick a group of points with Shift ────────────────────
  // A drag that stays put is a click on the background: it drops the selection.
  const svgXY = (e) => {
    const rect = svgRef.current.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }
  const drag = useDrag({
    onStart: (e) => {
      if (!view) return null
      if (e.shiftKey) { const { x, y } = svgXY(e); setBand({ x0: x, y0: y, x1: x, y1: y }) }
      return { view, band: e.shiftKey, quiet: e.shiftKey, add: e.ctrlKey || e.metaKey }
    },
    onMove: (e, start, { dx, dy }) => {
      if (start.band) { const { x, y } = svgXY(e); setBand(b => b && { ...b, x1: x, y1: y }); return }
      const { k, x0, z0 } = start.view
      setView({ k, x0: x0 - dx / k, z0: z0 + dy / (k * exaggeration) })
    },
    onEnd: (start, moved) => {
      setBand(null)
      if (start.band && band) selectInBand(band, start.add)
      else if (!start.band && !moved) select([])
    },
  })

  /** Every point of the track inside the rubber band, added to or replacing the selection. */
  const selectInBand = (b, add) => {
    const [xLo, xHi] = [Math.min(b.x0, b.x1), Math.max(b.x0, b.x1)]
    const [yLo, yHi] = [Math.min(b.y0, b.y1), Math.max(b.y0, b.y1)]
    const hit = points.filter(p => {
      const x = X(p.station), y = Y(p.z)
      return x >= xLo && x <= xHi && y >= yLo && y <= yHi
    }).map(p => p.index)
    if (!hit.length && !add) return select([])
    select(add ? [...new Set([...selection, ...hit])] : hit)
  }

  // ── Splitting the gradient with a new point ──────────────────────────────
  /**
   * The point a double click at (x, y) would add: on the gradient, between
   * two points of the track the route runs there — added to that track.
   */
  const insertAt = ({ x, y }) => {
    if (!view || !size || !points.length || x < MARGIN.left || x > size.w - MARGIN.right || y > plotBottom) return null
    const station = Math.round((view.x0 + (x - MARGIN.left) / view.k) * 100) / 100
    const on = onTrackAt(station)
    if (!on || station < 0 || station > profile.length) return null
    const r = insertHeightPoint(on.part.track.heights, on.station)
    if (!r) return null
    const z = r.heights[r.index].z
    const [a, b] = [r.heights[r.index - 1], r.heights[r.index + 1]].map(h => X(routeStationOfPart(on.part, h.station)))
    if (Math.abs(Y(z) - y) > INSERT_HIT_PX
      || Math.abs(x - a) < INSERT_POINT_GAP_PX || Math.abs(b - x) < INSERT_POINT_GAP_PX) return null
    return { station, z, trackId: on.trackId, ...r }
  }
  // The station under the cursor, on the track — or null beside the plot.
  const cursorAt = ({ x, y }) => {
    if (!view || !size || x < MARGIN.left || x > size.w - MARGIN.right
      || y < MARGIN.top || y > size.h - MARGIN.bottom) return null
    const station = view.x0 + (x - MARGIN.left) / view.k
    return station >= 0 && station <= (profile?.length ?? 0) ? station : null
  }
  const showInsert = (e) => {
    const c = e.buttons ? null : insertAt(svgXY(e))
    setHover(h => (h?.station === c?.station ? h : c && { station: c.station, z: c.z }))
  }
  const insert = (e) => {
    const c = insertAt(svgXY(e))
    if (!c) return
    setHover(null)
    onInsert(c)
  }

  // Drawn values to what the drawing shows: stations and lengths to the cm, heights to the mm.
  const cm = (v) => num(v, { digits: 2 })
  const mm = (v) => num(v, { digits: 3 })

  // ── Geometry helpers ──────────────────────────────────────────────────────
  const X = (station) => MARGIN.left + (station - view.x0) * view.k
  const Y = (z) => plotBottom - (z - view.z0) * view.k * exaggeration
  const typeLabel = (el) => {
    if (el.elementType === 2) return t(el.transitionType === 'bloss' ? 'table_type_bloss' : 'table_type_transition')
    if (el.radius != null) return `R ${Math.round(Math.abs(el.radius))}`
    return t('table_type_straight')
  }

  const sectionZ = sectionStation != null ? heightAt(sectionStation) : null
  const cursorZ = cursor != null ? heightAt(cursor) : null
  const cursorDz = cursor != null && devShown ? deviationAt(refRuns, cursor) : null
  /** A lift in mm, signed. */
  const mmLabel = (v) => { const m = Math.round(v * 1000); return `${m > 0 ? '+' : m < 0 ? '−' : ''}${Math.abs(m)} mm` }

  /**
   * The points of a reference run one to a pixel column — the one furthest
   * from 0 by `value` — so a long axis read every metre stays a clean line.
   */
  const perPixel = (pts, value = () => 0) => {
    const out = []
    let px = null, best = null
    for (const p of pts) {
      const x = Math.round(X(p.s))
      if (x !== px) { if (best) out.push(best); px = x; best = p }
      else if (Math.abs(value(p)) > Math.abs(value(best))) best = p
    }
    if (best) out.push(best)
    return out
  }

  /**
   * Below the profile: the gradient minus the reference axis [mm] over the
   * same stations, the height limit dashed either side, red dots beyond it.
   */
  const deviationStrip = ({ sTicks, right, foot }) => {
    const top = foot - DEV_STRIP_PX, mid = top + DEV_STRIP_PX / 2
    const devs = refPoints.filter(p => p.dz != null)
    const peak = Math.max(limitZ, 0.005, ...devs.map(p => Math.abs(p.dz))) * 1.15
    const DY = (d) => mid - d / peak * (DEV_STRIP_PX / 2)
    const labelled = Math.abs(DY(limitZ) - mid) >= 10 ? limitZ : peak / 1.15
    return (
      <g>
        <rect x={MARGIN.left} y={top} width={plotW} height={DEV_STRIP_PX} fill="none" stroke={PALETTE.gridLine} />
        {sTicks.map(s => <line key={`ds${s}`} x1={X(s)} x2={X(s)} y1={top} y2={foot} stroke={PALETTE.gridLine} />)}
        <line x1={MARGIN.left} x2={right} y1={mid} y2={mid} stroke={PALETTE.axis} />
        {[limitZ, -limitZ].map(v => (
          <line key={`dl${v}`} x1={MARGIN.left} x2={right} y1={DY(v)} y2={DY(v)}
            stroke={PALETTE.invalid} strokeDasharray="4 3" />
        ))}
        {[labelled, -labelled].map(v => (
          <text key={`dt${v}`} x={MARGIN.left - 6} y={DY(v) + 4} fontSize="10" fill={PALETTE.textSoft} textAnchor="end">
            {mmLabel(v).replace(' mm', '')}
          </text>
        ))}
        <text x={MARGIN.left - 6} y={top - 4} fontSize="11" fill={PALETTE.muted} textAnchor="end">Δh [mm]</text>
        <text x={MARGIN.left + 4} y={top - 4} fontSize="10" fill={PALETTE.referenceAxis}>
          {fill('elevation_ref_strip', { name: refAxis.name, limit: Math.round(limitZ * 1000) })}
        </text>
        <g clipPath={`url(#${clip}-dev)`} pointerEvents="none">
          {refRuns.map((run, i) => {
            // A run may lose the track's gradient on the way: draw what has one.
            const parts = []
            let part = []
            for (const p of run) {
              if (p.dz == null) { if (part.length) parts.push(part); part = []; continue }
              part.push(p)
            }
            if (part.length) parts.push(part)
            return parts.map((pts, j) => (
              <polyline key={`dv${i}-${j}`} fill="none" stroke={PALETTE.previewLine} strokeWidth="1.5"
                points={perPixel(pts, p => p.dz).map(p => `${X(p.s)},${DY(p.dz)}`).join(' ')} />
            ))
          })}
          {devs.filter(p => Math.abs(p.dz) > limitZ + 1e-9).map(p => (
            <circle key={`db${p.s}`} cx={X(p.s)} cy={DY(p.dz)} r="2" fill={PALETTE.invalid} />
          ))}
          {sectionStation != null && (
            <line x1={X(sectionStation)} x2={X(sectionStation)} y1={top} y2={foot}
              stroke={PALETTE.mapSelected} strokeWidth="1.5" strokeDasharray="3 2" />
          )}
          {cursor != null && (
            <>
              <line x1={X(cursor)} x2={X(cursor)} y1={top} y2={foot} stroke={PALETTE.mapHover} strokeWidth="1" strokeDasharray="2 2" />
              {cursorDz != null && (
                <circle cx={X(cursor)} cy={DY(cursorDz)} r="3" fill={PALETTE.mapHover} stroke={PALETTE.white} strokeWidth="1.5" />
              )}
            </>
          )}
        </g>
      </g>
    )
  }

  const drawing = () => {
    if (!size || !view) return null
    // `bottom` is the profile's, `foot` the station axis' below the strip.
    const right = size.w - MARGIN.right, bottom = plotBottom, foot = size.h - MARGIN.bottom
    const sStep = niceStep(70, view.k), zStep = niceStep(26, view.k * exaggeration)
    const sTicks = ticks(view.x0, view.x0 + plotW / view.k, sStep)
    const zTicks = ticks(view.z0, view.z0 + plotH / (view.k * exaggeration), zStep)

    // Gradient of every stretch in ‰, at its middle — left out where the label
    // would not fit between the two points.
    const grades = []
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i]
      const run = b.station - a.station
      if (!(run > 0)) continue
      const x1 = X(a.station), x2 = X(b.station)
      if (x2 - x1 < GRADE_LABEL_MIN_PX) continue
      grades.push({ x: (x1 + x2) / 2, y: (Y(a.z) + Y(b.z)) / 2, grade: (b.z - a.z) / run * 1000, stretch: stretchAt.get(i) })
    }

    let lastLabelX = -Infinity
    const labelled = points.filter(p => {
      const x = X(p.station)
      if (x - lastLabelX < 44) return false
      lastLabelX = x
      return true
    })

    return (
      <svg ref={svgRef} className={`profile-svg${drag.dragging ? ' dragging' : ''}`} width={size.w} height={size.h}
        style={hover && !drag.dragging ? { cursor: 'copy' } : undefined}
        {...drag.handlers}
        onPointerMove={e => { drag.handlers.onPointerMove(e); showInsert(e); setCursor(cursorAt(svgXY(e))) }}
        onPointerLeave={() => { setHover(null); setCursor(null) }}
        onDoubleClick={insert}>
        <defs>
          <clipPath id={clip}><rect x={MARGIN.left} y={MARGIN.top} width={plotW} height={plotH} /></clipPath>
          <clipPath id={`${clip}-dev`}><rect x={MARGIN.left} y={foot - DEV_STRIP_PX} width={plotW} height={DEV_STRIP_PX} /></clipPath>
        </defs>
        {/* grid */}
        {sTicks.map(s => <line key={`gs${s}`} x1={X(s)} x2={X(s)} y1={MARGIN.top} y2={bottom} stroke={PALETTE.gridLine} />)}
        {zTicks.map(z => <line key={`gz${z}`} x1={MARGIN.left} x2={right} y1={Y(z)} y2={Y(z)} stroke={PALETTE.gridLine} />)}
        {/* axes */}
        <line x1={MARGIN.left} x2={right} y1={bottom} y2={bottom} stroke={PALETTE.axis} />
        <line x1={MARGIN.left} x2={MARGIN.left} y1={MARGIN.top} y2={bottom} stroke={PALETTE.axis} />
        {sTicks.map(s => (
          <text key={`ts${s}`} x={X(s)} y={foot + 16} fontSize="11" fill={PALETTE.textSoft} textAnchor="middle">{num(s, { digits: stepDecimals(sStep) })}</text>
        ))}
        {zTicks.map(z => (
          <text key={`tz${z}`} x={MARGIN.left - 6} y={Y(z) + 4} fontSize="11" fill={PALETTE.textSoft} textAnchor="end">{num(z, { digits: stepDecimals(zStep) })}</text>
        ))}
        <text x={right} y={foot + 28} fontSize="11" fill={PALETTE.muted} textAnchor="end">{t('elevation_station')} [m]</text>
        <text x={4} y={MARGIN.top - 12} fontSize="11" fill={PALETTE.muted}>{t('elevation_height')} [m]</text>

        <g clipPath={`url(#${clip})`}>
          {/* element boundaries */}
          {[...profile.boundaries, { station: profile.length }].map((b, i) => (
            <g key={`b${i}`}>
              <line x1={X(b.station)} x2={X(b.station)} y1={MARGIN.top} y2={bottom} stroke={PALETTE.elementBoundary} strokeDasharray="3 3" />
              {b.el && <text x={X(b.station) + 3} y={MARGIN.top + 11} fontSize="10" fill={PALETTE.label}>{typeLabel(b.el)}</text>}
            </g>
          ))}
          {/* where the route goes over from one track to the next, named */}
          {profile.partStarts.map(({ station, part }) => (
            <g key={`ps${part.trackId}${station}`} pointerEvents="none">
              <line x1={X(station)} x2={X(station)} y1={MARGIN.top} y2={bottom} stroke={PALETTE.axis} strokeWidth="1.5" />
              <text x={X(station) + 3} y={MARGIN.top + 23} fontSize="10" fill={PALETTE.textStrong}>
                {`▶ ${part.track.name || part.trackId.slice(0, 8)}${part.reversed ? ' ⇄' : ''}`}
              </text>
            </g>
          ))}
          {/* joined tracks */}
          {stubs.map((s, i) => {
            const [a, b] = s.points
            return (
              <g key={`n${i}`}>
                <line x1={X(a.station)} y1={Y(a.z)} x2={X(b.station)} y2={Y(b.z)} stroke={PALETTE.axis} strokeWidth="2" strokeDasharray="6 4" />
                <circle cx={X(b.station)} cy={Y(b.z)} r="3" fill={PALETTE.white} stroke={PALETTE.axis} strokeWidth="1.5" />
                <text x={X(b.station)} y={Y(b.z) - 8} fontSize="10" fill={PALETTE.label} textAnchor="middle">{s.name}</text>
              </g>
            )
          })}
          {/* the reference axis, where it runs along the track */}
          {refRuns.map((run, i) => (
            <polyline key={`ref${i}`} fill="none" stroke={PALETTE.referenceAxis} strokeWidth="1.5" strokeDasharray="6 3"
              pointerEvents="none" points={perPixel(run).map(p => `${X(p.s)},${Y(p.z)}`).join(' ')} />
          ))}
          {/* the vertical curves rounding the gradient changes */}
          {curves.map((c, i) => (
            <polyline key={`vc${i}`} fill="none" stroke={PALETTE.verticalCurve} strokeWidth="2"
              points={c.map(p => `${X(p.station)},${Y(p.z)}`).join(' ')} />
          ))}
          {/* where two of them run into each other: the shared stretch, framed */}
          {overlaps.map(o => {
            const x1 = X(o.from), x2 = X(o.to), y1 = Y(o.zMax), y2 = Y(o.zMin)
            const w = Math.max(x2 - x1, 4), h = Math.max(y2 - y1, 4)
            return (
              <rect key={`vo${o.a}-${o.b}`} className="rule-sev-error" x={(x1 + x2 - w) / 2 - 4} y={(y1 + y2 - h) / 2 - 6}
                width={w + 8} height={h + 12} rx="3" fill="currentColor" fillOpacity="0.15"
                stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 2">
                <title>{overlapNote(o)}</title>
              </rect>
            )
          })}
          {/* the track */}
          <polyline fill="none" stroke="var(--color-primary)" strokeWidth="2"
            points={points.map(p => `${X(p.station)},${Y(p.z)}`).join(' ')} />
          {/* the tangent points, where each vertical curve begins and ends */}
          {curves.flatMap((c, i) => [c[0], c[c.length - 1]].map((p, k) => (
            <circle key={`ve${i}-${k}`} cx={X(p.station)} cy={Y(p.z)} r="3" fill={PALETTE.verticalCurveEnd}
              stroke={PALETTE.verticalCurveEndEdge} strokeWidth="0.75">
              <title>{fill(k ? 'elevation_vcurve_end' : 'elevation_vcurve_start', { station: cm(p.station) })}</title>
            </circle>
          )))}
          {/* stretches a rule flags, in the colour of its step */}
          {[...stretchAt.values()].filter(flagged).map(s => (
            <line key={`sf${s.index}`} className={`rule-sev-${s.severity}`} stroke="currentColor" strokeWidth="4"
              strokeOpacity="0.75" strokeLinecap="round"
              x1={X(points[s.index - 1].station)} y1={Y(points[s.index - 1].z)}
              x2={X(points[s.index].station)} y2={Y(points[s.index].z)}>
              <title>{stretchNote(s)}</title>
            </line>
          ))}
          {grades.map((g, i) => (
            <text key={`g${i}`} x={g.x} y={g.y + 14} fontSize="10" textAnchor="middle"
              className={flagged(g.stretch) ? `rule-sev-${g.stretch.severity}` : undefined}
              fill={flagged(g.stretch) ? 'currentColor' : PALETTE.muted}>
              {g.stretch && <title>{stretchNote(g.stretch)}</title>}
              {gradeLabel(g.grade, num)}
            </text>
          ))}
          {/* gradient changes a rule flags: a ring in the colour of its step */}
          {[...curveAt.values()].filter(flagged).map(c => (
            <circle key={`cf${c.index}`} className={`rule-sev-${c.severity}`} cx={X(c.station)} cy={Y(points[c.index].z)}
              r="8.5" fill="none" stroke="currentColor" strokeWidth="2" pointerEvents="none" />
          ))}
          {labelled.map(p => (
            <text key={`l${p.index}`} x={X(p.station)} y={Y(p.z) - 9} fontSize="10" fill={PALETTE.textStrong} textAnchor="middle">
              {mm(p.z)}{p.rv != null && <tspan fill={PALETTE.label}> R{Math.round(p.rv)}
                {p.la != null && ` ${fill('elevation_vcurve_length_label', { la: num(p.la, { digits: 0 }) })}`}</tspan>}
            </text>
          ))}
          {/* where the cross section is taken */}
          {sectionStation != null && (
            <g pointerEvents="none">
              <line x1={X(sectionStation)} x2={X(sectionStation)} y1={MARGIN.top} y2={bottom}
                stroke={PALETTE.mapSelected} strokeWidth="1.5" strokeDasharray="3 2" />
              {sectionZ != null && (
                <circle cx={X(sectionStation)} cy={Y(sectionZ)} r="4.5" fill={PALETTE.mapSelected} stroke={PALETTE.white} strokeWidth="1.5" />
              )}
            </g>
          )}
          {cursor != null && (
            <g pointerEvents="none">
              <line x1={X(cursor)} x2={X(cursor)} y1={MARGIN.top} y2={bottom}
                stroke={PALETTE.mapHover} strokeWidth="1" strokeDasharray="2 2" />
              {cursorZ != null && (
                <circle cx={X(cursor)} cy={Y(cursorZ)} r="3.5" fill={PALETTE.mapHover} stroke={PALETTE.white} strokeWidth="1.5" />
              )}
            </g>
          )}
          {hover && (
            <circle cx={X(hover.station)} cy={Y(hover.z)} r="4" fill={PALETTE.white}
              stroke="var(--color-primary)" strokeWidth="1.5" strokeDasharray="2 2" pointerEvents="none" />
          )}
          {/* A turnout's toe, marked as such (decision 392). */}
          {points.filter(p => coupled(p.index)?.kind === 'wa').map(p => (
            <text key={`wa${p.index}`} x={X(p.station)} y={Y(p.z) + 17} fontSize="9" fontWeight="600"
              fill={PALETTE.label} textAnchor="middle" pointerEvents="none">WA</text>
          ))}
          {points.filter(p => lockedByHand(p.index)).map(p => (
            // A lock above its point.
            <text key={`lk${p.index}`} x={X(p.station)} y={Y(p.z) - 22} fontSize={12}
              textAnchor="middle" pointerEvents="none">🔒</text>
          ))}
          {points.map(p => {
            const on = isSelected(p)
            return (
              <circle className="clickable" key={`p${p.index}`} cx={X(p.station)} cy={Y(p.z)} r={on ? 5.5 : 3.5}
                fill={on ? PALETTE.heightPointSelected : linkState.get(p.index) === 'source' ? PALETTE.heightPointSource
                  : linkState.get(p.index) === 'dependent' ? PALETTE.heightPointDependent : PALETTE.white}
                stroke={on ? PALETTE.heightPointSelected : 'var(--color-primary)'} strokeWidth="2"
                strokeDasharray={locked.has(p.index) ? '2 1.5' : undefined}
                onPointerDown={e => e.stopPropagation()} onClick={e => onPick(p.index, e)}>
                {(curveAt.has(p.index) || pointNote(p.index)) && (
                  <title>
                    {[pointNote(p.index), curveAt.has(p.index) && curveNote(curveAt.get(p.index))].filter(Boolean).join('\n')}
                  </title>
                )}
              </circle>
            )
          })}
        </g>
        {devShown && deviationStrip({ sTicks, right, foot })}
        {sectionStation != null && X(sectionStation) >= MARGIN.left && X(sectionStation) <= right && (
          <text x={X(sectionStation)} y={MARGIN.top - 6} fontSize="10" fill={PALETTE.mapSelected} textAnchor="middle" pointerEvents="none">
            {fill('elevation_section_marker', {
              station: cm(sectionStation),
              z: sectionZ != null ? ` · ${mm(sectionZ)} m` : '',
            })}
          </text>
        )}
        {cursor != null && sectionStation == null && (
          <text x={clamp(X(cursor), MARGIN.left + 40, right - 40)} y={MARGIN.top - 6} fontSize="10" fill={PALETTE.mapHover}
            textAnchor="middle" pointerEvents="none">
            {`${cm(cursor)} m${cursorZ != null ? ` · ${mm(cursorZ)} m` : ''}${cursorDz != null ? ` · Δh ${mmLabel(cursorDz)}` : ''}`}
          </text>
        )}
        {band && (
          <rect x={Math.min(band.x0, band.x1)} y={Math.min(band.y0, band.y1)}
            width={Math.abs(band.x1 - band.x0)} height={Math.abs(band.y1 - band.y0)}
            fill={PALETTE.heightPointSelected} fillOpacity="0.08" stroke={PALETTE.heightPointSelected} strokeDasharray="4 3" />
        )}
      </svg>
    )
  }

  return (
    <div className="profile-body" ref={bodyRef}>
      {empty ?? drawing()}
    </div>
  )
}
