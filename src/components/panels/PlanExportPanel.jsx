import { useState } from 'react'
import { loadTracks, loadSwitches, loadKmLines } from '../../storage'
import { BASEMAPS } from '../../basemaps'
import { EPSG_OPTIONS } from '../../utils/coordinateUtils'
import { DEFAULT_HEIGHT_EPSG, HEIGHT_DATUMS } from '../../utils/mapConstants'
import { PAPER_FORMATS, SCALES } from '../../utils/planExport'
import { planSheets } from '../../utils/planLayout'
import { buildPlan } from '../../utils/planModel'
import { renderPdf } from '../../utils/planPdf'
import { fetchBasemapImage } from '../../utils/rasterBasemap'
import { downloadBlob } from '../../utils/fileUtils'

/**
 * Backdrops a plan can be drawn over. A plain map is the safe default; an
 * aerial one carries far more ink of its own, so it is faded further to keep
 * the black linework on top of it readable.
 */
const BACKGROUNDS = [
  { key: 'none',   labelKey: 'plan_background_none' },
  { key: 'map',    labelKey: 'plan_background_map',    basemap: 'positron',  opacity: 0.4 },
  { key: 'aerial', labelKey: 'plan_background_aerial', basemap: 'satellite', opacity: 0.6 },
]

const CONTENT_KEYS = [
  ['mainPoints', 'plan_show_main'],
  ['kilometrage', 'plan_show_km'],
  ['labels',     'plan_show_labels'],
  ['switches',   'plan_show_switches'],
  ['trackNames', 'plan_show_names'],
]

/** How a CRS is named on the sheet. */
function crsLabel(epsg) {
  if (!epsg) return ''
  const known = EPSG_OPTIONS.find(o => String(o.code) === String(epsg))
  return known ? `EPSG ${known.code} – ${known.label}` : `EPSG ${epsg}`
}

function heightLabel(epsg) {
  const code = epsg ?? DEFAULT_HEIGHT_EPSG
  const known = HEIGHT_DATUMS.find(d => String(d.epsg) === String(code))
  return known ? `EPSG ${code} – ${known.label}` : `EPSG ${code}`
}

export default function PlanExportPanel({ t, project, language, onShowPlanPreview }) {
  const [scaleKey, setScaleKey] = useState('1000')
  const [paperKey, setPaperKey] = useState('297x840')
  const [mode, setMode]         = useState('auto')
  const [rotation, setRotation] = useState(0)
  const [leadTrackId, setLeadTrackId] = useState('')
  const [split, setSplit]       = useState(true)
  const [overlap, setOverlap]   = useState(50)
  const [show, setShow] = useState({
    mainPoints: true, labels: true, switches: true, trackNames: true,
    kilometrage: true,
  })
  const [background, setBackground] = useState('none')
  const [busy, setBusy]     = useState(false)
  const [status, setStatus] = useState(null)   // { msg, error }

  const tracks = loadTracks(project.id)
  // What the kilometrage of a main point is read off. Fetched in the
  // background when a track names a line (see kmLineSource), so it can
  // legitimately be missing — the plan then simply states no kilometrage.
  const kmLines = loadKmLines(project.id)
  const namedTracks = tracks.filter(tr => (tr.elements ?? []).length > 0)
  const fill = (key, vals) => Object.entries(vals)
    .reduce((s, [k, v]) => s.replace(`{${k}}`, v), t(key))

  /** Layout → model, optionally with a basemap fetched for every sheet. */
  const assemble = async (backgroundKey) => {
    const backdrop = BACKGROUNDS.find(b => b.key === backgroundKey) ?? BACKGROUNDS[0]
    const current = loadTracks(project.id)
    if (!current.length) {
      setStatus({ msg: t('plan_no_tracks'), error: true })
      return null
    }
    const scaleDen = SCALES[scaleKey]
    const [pageW, pageH] = PAPER_FORMATS[paperKey]
    const layout = planSheets({
      tracks: current, paperKey, scaleDen, mode, rotDeg: rotation,
      leadTrackId: leadTrackId || null, split, overlapM: overlap,
      jointText: { next: t('plan_sheet_next'), prev: t('plan_sheet_prev') },
    })

    const zone = current.find(tr => tr.epsg)?.epsg ?? null
    const basemaps = []
    if (backdrop.basemap && zone) {
      const style = BASEMAPS.find(b => b.id === backdrop.basemap)?.style
      for (const [i, sheet] of layout.sheets.entries()) {
        setStatus({ msg: fill('plan_background_busy', { i: i + 1, n: layout.sheets.length }), error: false })
        try {
          basemaps.push(await fetchBasemapImage({
            center: sheet.center, zone, pageW, pageH, scaleDen, rotDeg: sheet.rotDeg, style,
          }))
        } catch {
          basemaps.push(null)
          setStatus({ msg: t('plan_background_failed'), error: false })
        }
      }
    }

    const heightEpsg = current.find(tr => tr.heightEpsg)?.heightEpsg
    const plan = buildPlan({
      tracks: current,
      switches: loadSwitches(project.id),
      kmLines: loadKmLines(project.id),
      sheets: layout.sheets,
      paperKey, scaleDen, show, basemaps,
      basemapOpacity: backdrop.opacity ?? 0.4,
      comma: language !== 'en',
      switchText: {
        plain: t('switch_code_plain'), ibw: t('switch_code_ibw'),
        abw: t('switch_code_abw'), abw_straight: t('switch_code_abw_straight'),
        rBranch: t('switch_r_sub_branch'), rMain: t('switch_r_sub_main'),
        cantException: t('switch_plan_cant_exception'),
      },
      titleBlock: {
        title: project.title || t('plan_default_title'),
        rows: [
          [`${t('plan_field_scale')} 1:${scaleKey}`, t('plan_sheet_of')],
          [crsLabel(zone), `${t('plan_field_heights')}: ${heightLabel(heightEpsg)}`],
          [`${t('plan_field_format')} ${paperKey} mm`,
            new Date().toLocaleDateString(language === 'en' ? 'en-GB' : 'de-DE')],
        ],
        legend: t('plan_legend'),
      },
    })
    return { plan, layout }
  }

  const run = async (after) => {
    setBusy(true)
    setStatus({ msg: t('plan_busy'), error: false })
    try {
      const built = await assemble(background)
      if (!built) return
      after(built)
      setStatus(built.layout.fits
        ? { msg: fill('plan_sheets_built', { n: built.plan.sheets.length }), error: false }
        : { msg: t('plan_overflow'), error: true })
    } catch (err) {
      setStatus({ msg: `${t('plan_error')}: ${err.message}`, error: true })
    } finally {
      setBusy(false)
    }
  }

  const filenameBase = () =>
    `${(project.title || t('plan_default_title')).replace(/\s+/g, '_')}_1-${scaleKey}`

  const handlePreview = () => run(({ plan }) => onShowPlanPreview?.({ plan, filenameBase: filenameBase() }))
  const handleExport  = () => run(({ plan }) => {
    downloadBlob(renderPdf(plan).output('blob'), `${filenameBase()}.pdf`)
  })

  return (
    <>
      <h2>{t('plan_title')}</h2>
      <p style={{ fontSize: 12, color: '#888', marginTop: 0 }}>{t('plan_intro')}</p>

      <div className="element-form">
        <div className="form-field">
          <label>{t('plan_scale')}</label>
          <select value={scaleKey} onChange={e => setScaleKey(e.target.value)}>
            {Object.keys(SCALES).map(k => <option key={k} value={k}>1:{k}</option>)}
          </select>
        </div>

        <div className="form-field">
          <label>{t('plan_paper')}</label>
          <select value={paperKey} onChange={e => setPaperKey(e.target.value)}>
            {Object.keys(PAPER_FORMATS).map(k => <option key={k} value={k}>{k} mm</option>)}
          </select>
        </div>

        <div className="form-field">
          <label>{t('plan_orientation')}</label>
          <select value={mode} onChange={e => setMode(e.target.value)}>
            <option value="auto">{t('plan_orientation_auto')}</option>
            <option value="north">{t('plan_orientation_north')}</option>
            <option value="south">{t('plan_orientation_south')}</option>
            <option value="manual">{t('plan_orientation_manual')}</option>
          </select>
        </div>

        {mode === 'manual' && (
          <div className="form-field">
            <label>{t('plan_rotation')}: {rotation}°</label>
            <input type="range" min="0" max="359" step="1" value={rotation}
              onChange={e => setRotation(Number(e.target.value))} />
          </div>
        )}

        <div className="form-field">
          <label>{t('plan_lead_track')}</label>
          <select value={leadTrackId} onChange={e => setLeadTrackId(e.target.value)}>
            <option value="">{t('plan_lead_auto')}</option>
            {namedTracks.map(tr => (
              <option key={tr.id} value={tr.id}>{tr.name || tr.id.slice(0, 8)}</option>
            ))}
          </select>
        </div>

        <label className="transition-curve-row">
          <input type="checkbox" checked={split} onChange={e => setSplit(e.target.checked)} />
          <span>{t('plan_split')}</span>
        </label>

        {split && (
          <div className="form-field">
            <label>{t('plan_overlap')}</label>
            <input type="number" min="0" step="10" value={overlap}
              onChange={e => setOverlap(Math.max(0, Number(e.target.value) || 0))} />
          </div>
        )}
      </div>

      <div className="element-form">
        <span className="create-element-section">{t('plan_content')}</span>
        {CONTENT_KEYS.map(([key, labelKey]) => (
          <label className="transition-curve-row" key={key}>
            <input type="checkbox" checked={show[key]}
              onChange={e => setShow({ ...show, [key]: e.target.checked })} />
            <span>{t(labelKey)}</span>
          </label>
        ))}
        {show.kilometrage && kmLines.length === 0 && (
          <p className="form-error">{t('plan_km_missing')}</p>
        )}
        <div className="form-field">
          <label>{t('plan_background')}</label>
          <select value={background} onChange={e => setBackground(e.target.value)}>
            {BACKGROUNDS.map(b => (
              <option key={b.key} value={b.key}>{t(b.labelKey)}</option>
            ))}
          </select>
        </div>
      </div>

      {status && (
        <p style={{ color: status.error ? '#e74c3c' : '#5b9bd5', fontSize: 12, marginTop: 4 }}>
          {status.msg}
        </p>
      )}

      <button className="panel-btn panel-btn-full" style={{ marginTop: 8, opacity: busy ? 0.5 : 1 }}
        onClick={handlePreview} disabled={busy}>
        {busy ? t('plan_busy') : t('plan_preview_btn')}
      </button>
      <button className="panel-btn panel-btn-full" style={{ marginTop: 2, opacity: busy ? 0.5 : 1 }}
        onClick={handleExport} disabled={busy}>
        {t('plan_export_btn')}
      </button>
    </>
  )
}
