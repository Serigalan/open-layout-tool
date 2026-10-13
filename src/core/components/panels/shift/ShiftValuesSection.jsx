import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import {
  heightsComparable, nearestAxis, shiftSummary, shiftValues, shiftValuesCsv,
} from '../../../utils/shiftValues'
import { loadSettings, saveSettings } from '../../../utils/settings'
import { downloadText } from '../../../utils/fileUtils'
import { utmToWgs84 } from '../../../utils/coordinateUtils'
import { useReferenceAxes } from '../../../hooks/useStore'
import { useI18n } from '../../../locales/i18nContext'
import usePreview from '../../../map/usePreview'
import { useMap } from '../../../map/MapContext'
import { mapIsLive } from '../../../map/pick'
import useReferenceAxesOnMap from '../../../map/useReferenceAxesOnMap'
import { PALETTE } from '../../../styles/palette'
import NumberInput from '../../form/NumberInput'
import DeviationBand from '../../chart/DeviationBand'

const EVERY = [1, 5, 10]
const DEFAULT_LIMIT = 50          // mm, across and in height (Entscheidung 200)

/** The settings this device keeps for the section: raster and the two limits [mm]. */
function useShiftSettings() {
  const [s, setS] = useState(() => {
    let saved = {}
    try { saved = loadSettings().shiftValues ?? {} } catch { saved = {} }
    return { every: 5, limitQ: DEFAULT_LIMIT, limitZ: DEFAULT_LIMIT, ...saved }
  })
  const set = (key, value) => setS(prev => {
    const next = { ...prev, [key]: value }
    try { saveSettings({ shiftValues: next }) } catch { /* kept for this session only */ }
    return next
  })
  return [s, set]
}

const layersFor = (id) => [{
  sourceId: `${id}-beyond`,
  layer: {
    id: `${id}-beyond-layer`, type: 'circle',
    paint: { 'circle-radius': 4, 'circle-color': PALETTE.invalid, 'circle-stroke-color': PALETTE.white, 'circle-stroke-width': 1 },
  },
}, {
  // The station under the cursor in the bands or the table, as the Höhenplan
  // shows its own: the shift from the reference axis to the line, and a dot.
  sourceId: `${id}-cursor-shift`,
  layer: {
    id: `${id}-cursor-shift-layer`, type: 'line',
    paint: { 'line-color': PALETTE.mapHover, 'line-width': 3 },
  },
}, {
  sourceId: `${id}-cursor`,
  layer: {
    id: `${id}-cursor-layer`, type: 'circle',
    paint: { 'circle-radius': 6, 'circle-color': PALETTE.mapHover, 'circle-stroke-color': PALETTE.white, 'circle-stroke-width': 2 },
  },
}]

/** The row nearest the station `s` — null beyond a step of the raster from every row. */
function rowNear(rows, s, every) {
  let best = null
  for (const r of rows) if (!best || Math.abs(r.station - s) < Math.abs(best.station - s)) best = r
  return best && Math.abs(best.station - s) <= every ? best : null
}

/** A tooltip on the map at `lngLat` [lng, lat] saying `text` — none while either is null. */
function useMapTooltip(lngLat, text) {
  const mapRef = useMap()
  const popupRef = useRef(null)
  useEffect(() => {
    const m = mapRef?.current
    if (!m) return
    if (!lngLat || !text) { popupRef.current?.remove(); return }
    if (!popupRef.current) {
      popupRef.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'preview-tooltip', offset: 12, anchor: 'bottom', maxWidth: 'none' })
    }
    popupRef.current.setLngLat(lngLat).setText(text)
    if (!popupRef.current.isOpen()) popupRef.current.addTo(m)
  }, [mapRef, lngLat, text])
  useEffect(() => () => {
    if (mapIsLive(mapRef, mapRef?.current)) popupRef.current?.remove()
    popupRef.current = null
  }, [mapRef])
}

/**
 * Shift values against a reference axis (Paket V, Entscheidung 200): of
 * `line` (shiftValues comparedLine) in the plane `epsg` — the reference axis
 * the line runs along the furthest unless another is chosen, the raster, the
 * two limits, the largest values either way, their bands, a table and a CSV
 * file; on the map the reference axis and the stations beyond a limit. Over a
 * limit it only warns (Entscheidung 197). `heightEpsg` is the system of the
 * line's gradient, `heightNote` says why it has none where that is worth
 * saying. Nothing where the project has no reference axis.
 */
export default function ShiftValuesSection({ id, line, epsg, heightEpsg = null, heightNote = null, name = '', open = false }) {
  const { t, fill, num } = useI18n()
  const axes = useReferenceAxes()
  const [s, set] = useShiftSettings()
  const [chosenId, setChosenId] = useState(null)
  const inPlane = useMemo(() => axes.filter(a => Number(a.epsg) === Number(epsg)), [axes, epsg])
  const auto = useMemo(() => (line ? nearestAxis(inPlane, line, epsg) : null), [inPlane, line, epsg])
  const axis = inPlane.find(a => a.id === chosenId) ?? auto
  const withHeights = !!axis && heightsComparable(axis, heightEpsg)
  const rows = useMemo(
    () => (axis && line ? shiftValues(axis, line, { every: Number(s.every) || 5, withHeights }) : []),
    [axis, line, s.every, withHeights])
  const limitQ = (Number(s.limitQ) || 0) / 1000, limitZ = (Number(s.limitZ) || 0) / 1000
  const sum = useMemo(() => shiftSummary(rows, { limitQ, limitZ }), [rows, limitQ, limitZ])
  const every = Number(s.every) || 5
  const [hoverStation, setHoverStation] = useState(null)
  const hoverRow = hoverStation != null ? rows.find(r => r.station === hoverStation) ?? null : null
  const onCursor = (st) => setHoverStation(st == null ? null : rowNear(rows, st, every)?.station ?? null)

  useReferenceAxesOnMap(`${id}-axis`, axis ? [axis] : [])
  const layers = useMemo(() => layersFor(id), [id])
  const preview = usePreview(layers)
  useEffect(() => {
    preview.set(`${id}-beyond`, axis ? {
      type: 'FeatureCollection',
      features: rows.filter(r => Math.abs(r.dq) > limitQ || (r.dz != null && Math.abs(r.dz) > limitZ)).map(r => ({
        type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: utmToWgs84(r.at[0], r.at[1], axis.epsg) },
      })),
    } : null)
  }, [preview, id, rows, axis, limitQ, limitZ])
  const hoverAt = useMemo(() => (hoverRow && axis ? utmToWgs84(hoverRow.at[0], hoverRow.at[1], axis.epsg) : null), [hoverRow, axis])
  useEffect(() => {
    if (!hoverRow || !hoverAt) {
      preview.set(`${id}-cursor`, null)
      preview.set(`${id}-cursor-shift`, null)
      return
    }
    preview.set(`${id}-cursor`, { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: hoverAt } })
    preview.set(`${id}-cursor-shift`, {
      type: 'Feature', properties: {},
      geometry: { type: 'LineString', coordinates: [hoverAt, utmToWgs84(hoverRow.hit[0], hoverRow.hit[1], axis.epsg)] },
    })
  }, [preview, id, hoverRow, hoverAt, axis])
  const mmOf = (v) => (v == null ? '–' : Math.round(v * 1000) === 0 ? '0' : `${v > 0 ? '+' : ''}${num(v * 1000, { digits: 0 })}`)
  useMapTooltip(hoverAt, hoverRow && fill('shift_hover', {
    station: num(hoverRow.station, { digits: 1 }),
    q: mmOf(hoverRow.dq),
    z: hoverRow.dz != null ? fill('shift_hover_z', { z: mmOf(hoverRow.dz) }) : '',
  }))

  if (!axes.length) return null
  const mm = mmOf
  const st = (r) => num(r.station, { digits: 1 })
  const beyond = sum.beyondQ + sum.beyondZ > 0
  const head = !axis ? t('shift_no_axis')
    : !rows.length ? fill('shift_no_overlap', { axis: axis.name })
      : fill('shift_head', {
        q: num(Math.max(Math.abs(sum.right?.dq ?? 0), Math.abs(sum.left?.dq ?? 0)) * 1000, { digits: 0 }),
        z: sum.heights ? fill('shift_head_z', { z: num(Math.max(Math.abs(sum.up?.dz ?? 0), Math.abs(sum.down?.dz ?? 0)) * 1000, { digits: 0 }) }) : '',
      })

  return (
    <details className="shift-values" open={open || undefined}>
      <summary className={beyond ? 'msg-warn' : undefined}>
        {t('shift_title')}: {head}{beyond ? ' ⚠' : ''}
      </summary>
      <div className="element-form">
        <div className="form-field">
          <label>{t('shift_axis')}</label>
          <select value={chosenId ?? ''} onChange={e => setChosenId(e.target.value || null)}>
            <option value="">{fill('shift_axis_auto', { name: auto?.name ?? '–' })}</option>
            {inPlane.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="form-field">
          <label>{t('shift_every')}</label>
          <select value={s.every} onChange={e => set('every', Number(e.target.value))}>
            {EVERY.map(v => <option key={v} value={v}>{num(v, { digits: 0, unit: 'm' })}</option>)}
          </select>
        </div>
        <div className="row">
          <div className="form-field grow">
            <label>{t('shift_limit_q')}</label>
            <NumberInput min={0} step={5} value={s.limitQ} onChange={e => set('limitQ', e.target.value)} />
          </div>
          <div className="form-field grow">
            <label>{t('shift_limit_z')}</label>
            <NumberInput min={0} step={5} value={s.limitZ} onChange={e => set('limitZ', e.target.value)} />
          </div>
        </div>
      </div>
      {inPlane.length < axes.length && <p className="msg-hint msg-small">{t('shift_other_plane')}</p>}
      {rows.length > 0 && (
        <>
          <p className="msg-info msg-small">
            {fill('shift_max_q', {
              right: sum.right ? `${mm(sum.right.dq)} mm (${st(sum.right)})` : '–',
              left: sum.left ? `${mm(sum.left.dq)} mm (${st(sum.left)})` : '–',
            })}
            <br />
            {sum.heights
              ? fill('shift_max_z', {
                up: sum.up ? `${mm(sum.up.dz)} mm (${st(sum.up)})` : '–',
                down: sum.down ? `${mm(sum.down.dz)} mm (${st(sum.down)})` : '–',
              })
              : (heightNote ?? t(!axis.points.z ? 'shift_no_heights_axis' : !withHeights ? 'shift_no_heights_datum' : 'shift_no_heights_line'))}
          </p>
          {sum.beyondQ > 0 && <p className="msg-warn msg-small">{fill('shift_beyond_q', { n: String(sum.beyondQ), limit: num(Number(s.limitQ), { digits: 0 }) })}</p>}
          {sum.beyondZ > 0 && <p className="msg-warn msg-small">{fill('shift_beyond_z', { n: String(sum.beyondZ), limit: num(Number(s.limitZ), { digits: 0 }) })}</p>}
          <span className="create-element-section">{t('shift_band_q')}</span>
          <DeviationBand band={rows.map(r => [r.station, r.dq])} tolerance={limitQ} label={t('shift_band_q')}
            cursor={hoverStation} onCursor={onCursor} />
          {sum.heights && (
            <>
              <span className="create-element-section">{t('shift_band_z')}</span>
              <DeviationBand band={rows.filter(r => r.dz != null).map(r => [r.station, r.dz])} tolerance={limitZ} label={t('shift_band_z')}
                cursor={hoverStation} onCursor={onCursor} />
            </>
          )}
          <details className="mt-4">
            <summary>{fill('shift_table', { n: String(rows.length) })}</summary>
            <table className="shift-table" onPointerLeave={() => setHoverStation(null)}>
              <thead><tr><th>{t('shift_col_station')}</th><th>{t('shift_col_q')}</th><th>{t('shift_col_z')}</th></tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.station} className={r.station === hoverStation ? 'hovered' : undefined}
                    onPointerEnter={() => setHoverStation(r.station)}>
                    <td>{num(r.station, { digits: 2 })}</td>
                    <td className={Math.abs(r.dq) > limitQ ? 'msg-warn' : undefined}>{mm(r.dq)}</td>
                    <td className={r.dz != null && Math.abs(r.dz) > limitZ ? 'msg-warn' : undefined}>{mm(r.dz)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          <button type="button" className="panel-btn panel-btn-full secondary mt-4"
            onClick={() => downloadText(shiftValuesCsv(rows, { axisName: axis.name, lineName: name }),
              `Verschiebewerte_${(name || 'Achse').replace(/[^\w.-]+/g, '_')}.csv`, 'text/csv')}>
            {t('shift_csv')}
          </button>
        </>
      )}
    </details>
  )
}
