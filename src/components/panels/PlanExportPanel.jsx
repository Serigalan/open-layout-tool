import { useEffect, useRef, useState } from 'react'
import { loadTracks, loadSwitches, loadKmLines, loadPlatforms, loadPlanHeader, savePlanHeader, loadEndMarks } from '../../storage'
import PlanHeaderFields from './PlanHeaderFields'
import { PARTIES, STAFF, normalizeHeader, todayIso } from '../../utils/planHeader'
import { BASEMAPS } from '../../basemaps'
import { DEFAULT_HEIGHT_EPSG, HEIGHT_DATUMS } from '../../utils/heightDatums'
import { PAPER_FORMATS, SCALES, TITLE_COLUMN_MM } from '../../utils/planExport'
import { planSheets } from '../../utils/planLayout'
import { buildPlan } from '../../utils/planModel'
import { renderPdf } from '../../utils/planPdf'
import { buildSchematicPlan, SCHEMATIC_SCALES } from '../../utils/planSchematicPlan'
import { DEFAULT_CORRIDOR } from '../../utils/planSchematic'
import { fetchBasemapImage } from '../../utils/rasterBasemap'
import { sketchLines } from '../../utils/planSketch'
import { STATUSES } from '../../utils/planStatus'
import { downloadBlob } from '../../utils/fileUtils'
import { groupHeading, groupTracks, trackListLabel } from '../../utils/trackGroups'
import { useI18n } from '../../locales/i18nContext'
import { useProject } from '../../hooks/useStore'
import FormSection from '../form/FormSection'

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

/** What the overview can show, keyed as buildSchematicPlan reads it. */
const SCHEMATIC_CONTENT_KEYS = [
  ['km',         'plan_show_km'],
  ['switches',   'plan_show_switches'],
  ['trackNames', 'plan_show_names'],
  ['platforms',  'plan_show_platforms'],
]

function heightLabel(epsg) {
  const code = epsg ?? DEFAULT_HEIGHT_EPSG
  const known = HEIGHT_DATUMS.find(d => String(d.epsg) === String(code))
  return known ? `EPSG ${code} – ${known.label}` : `EPSG ${code}`
}

/** Pause in typing after which the title block is saved to the project [ms]. */
const HEADER_SAVE_DELAY = 500

export default function PlanExportPanel({ onShowPlanPreview }) {
  const { t, language, fill } = useI18n()
  const project = useProject()
  const [kind, setKind]         = useState('site')   // 'site' | 'schematic'
  const [scaleKey, setScaleKey] = useState('1000')
  const [schematicScaleKey, setSchematicScaleKey] = useState('10000')
  const [corridor, setCorridor] = useState(DEFAULT_CORRIDOR)
  const [schematicShow, setSchematicShow] = useState({
    km: true, switches: true, trackNames: true, platforms: true,
  })
  const [paperKey, setPaperKey] = useState('297x1920')
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
  const [header, setHeader] = useState(() => normalizeHeader(loadPlanHeader()))
  const blockStyle = header.style
  const [busy, setBusy]     = useState(false)
  const [status, setStatus] = useState(null)   // { msg, error }

  const tracks = loadTracks()
  // What the kilometrage of a main point is read off. Fetched in the
  // background when a track names a line (see kmLineSource), so it can
  // legitimately be missing — the plan then simply states no kilometrage.
  const kmLines = loadKmLines()
  const namedTracks = tracks.filter(tr => (tr.elements ?? []).length > 0)
  // The header is project metadata; typing in it saves once the typing pauses
  // rather than writing the whole project on every key.
  const pendingHeader = useRef(null)
  const saveTimer = useRef(null)
  const flushHeader = () => {
    clearTimeout(saveTimer.current)
    saveTimer.current = null
    if (!pendingHeader.current) return
    const ok = savePlanHeader(pendingHeader.current)
    pendingHeader.current = null
    if (!ok) setStatus({ msg: t('plan_logo_failed'), error: true })
  }
  const flushRef = useRef(flushHeader)
  flushRef.current = flushHeader
  useEffect(() => () => flushRef.current(), [])
  const changeHeader = (next) => {
    setHeader(next)
    pendingHeader.current = next
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => flushRef.current(), HEADER_SAVE_DELAY)
  }
  const setBlockStyle = (style) => changeHeader({ ...header, style })


  /**
   * The title block for a plan. Both blocks state the same: plan kind, scale,
   * sheet and what else `lines` holds, reference system and paper, who drew
   * and checked it — the detailed one adds parties, sketch and signatures.
   */
  const titleBlockOf = ({ legend, kind: kindName, scale, zone, lines, current }) => {
    const plan = {
      kind: kindName, scale, lines,
      epsg: zone ? String(zone) : '-',
      heightEpsg: String(current.find(tr => tr.heightEpsg)?.heightEpsg ?? DEFAULT_HEIGHT_EPSG),
      format: formatText(),
    }
    return {
      ...(blockStyle === 'full' ? fullBlockFields(header, plan, current) : simpleBlockFields(header, plan)),
      title: project.title || t('plan_default_title'),
      legend,
    }
  }
  /** A date the calendar gave (yyyy-mm-dd) as the plan states it; anything else as typed. */
  const planDate = (value) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '')
    if (!m) return value ?? ''
    return language === 'en' ? `${m[3]}/${m[2]}/${m[1]}` : `${m[3]}.${m[2]}.${m[1]}`
  }
  /**
   * Who drew and checked the plan, dated. Without an entry the plan is drawn
   * today, by whoever created the project.
   */
  const staffRow = (h, key) => ({
    date: planDate(h.staff[key].date || (key === 'drawn' ? todayIso() : '')),
    name: h.staff[key].name || (key === 'drawn' ? project.creator ?? '' : ''),
  })
  const formatText = () => {
    const [w, hgt] = PAPER_FORMATS[paperKey]
    return `${hgt} × ${w} mm`
  }

  /** The overview: the network as a strip along the kilometrage. */
  const assembleSchematic = (current) => {
    const zone = current.find(tr => tr.epsg)?.epsg ?? null
    const plan = buildSchematicPlan({
      tracks: current,
      switches: loadSwitches(),
      platforms: loadPlatforms(),
      kmLines: loadKmLines(),
      leadTrackId: leadTrackId || null,
      paperKey,
      scaleDen: SCHEMATIC_SCALES[schematicScaleKey],
      corridor,
      show: schematicShow,
      comma: language !== 'en',
      texts: {
        next: t('plan_sheet_next'), prev: t('plan_sheet_prev'), range: t('plan_km_range'),
        status: Object.fromEntries(STATUSES.map(s => [s, t(`status_${s}`)])),
      },
      // A schematic plan is to no scale, so its scale reads "-".
      titleBlock: titleBlockOf({
        legend: t('plan_schematic_legend'),
        kind: t('plan_kind_schematic_short'), scale: '-', zone, lines: [t('plan_sheet_of')],
        current,
      }),
    })
    return { plan, layout: { fits: plan.fits } }
  }

  /** Layout → model, optionally with a basemap fetched for every sheet. */
  const assemble = async (backgroundKey) => {
    const backdrop = BACKGROUNDS.find(b => b.key === backgroundKey) ?? BACKGROUNDS[0]
    const current = loadTracks()
    if (!current.length) {
      setStatus({ msg: t('plan_no_tracks'), error: true })
      return null
    }
    if (kind === 'schematic') return assembleSchematic(current)
    const scaleDen = SCALES[scaleKey]
    const [pageW, pageH] = PAPER_FORMATS[paperKey]
    const reserve = blockStyle === 'full' ? TITLE_COLUMN_MM : 0
    const layout = planSheets({
      reserve,
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
            center: sheet.center, zone, pageW, pageH, scaleDen, rotDeg: sheet.rotDeg, style, reserve,
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
      switches: loadSwitches(),
      kmLines: loadKmLines(),
      endMarks: loadEndMarks(),
      sheets: layout.sheets,
      paperKey, scaleDen, show, basemaps, reserve,
      basemapOpacity: backdrop.opacity ?? 0.4,
      comma: language !== 'en',
      switchText: {
        plain: t('switch_code_plain'), ibw: t('switch_code_ibw'),
        abw: t('switch_code_abw'), abw_straight: t('switch_code_abw_straight'),
        sym: t('switch_code_sym'),
        rBranch: t('switch_r_sub_branch'), rMain: t('switch_r_sub_main'),
        cantException: t('switch_plan_cant_exception'),
      },
      titleBlock: titleBlockOf({
        legend: t('plan_legend'),
        kind: t('plan_default_title'), scale: `1:${scaleKey}`, zone,
        lines: [t('plan_sheet_of'), `${t('plan_field_heights')}: ${heightLabel(heightEpsg)}`],
        current,
      }),
    })
    return { plan, layout }
  }

  /** What the simple title block reads: kind, scale, content, who drew and checked it, EPSG and paper. */
  const simpleBlockFields = (h, plan) => ({
    ...plan,
    labels: {
      kind: t('plan_block_kind'), scale: t('plan_block_scale'), content: t('plan_block_content'),
      epsg: t('plan_block_epsg'), format: t('plan_block_format'),
    },
    staff: [['drawn', 'plan_staff_drawn_short'], ['checked', 'plan_staff_checked_short']]
      .map(([key, labelKey]) => ({ label: t(labelKey), ...staffRow(h, key) })),
    dateHeader: t('plan_staff_date'),
    nameHeader: t('plan_staff_name'),
  })

  /**
   * What the detailed title block reads on top of the title.
   * Without an image of its own the location sketch draws the network.
   */
  const fullBlockFields = (h, plan, current) => ({
    full: true,
    // Without a plan title of its own the third title line names the plan kind.
    subtitle: h.subtitle || plan.kind,
    range: h.range,
    // The cell above the code states the scale; a schematic plan has none.
    scale: plan.scale === '-' ? '-' : `M ${plan.scale}`,
    code: h.code,
    // The fields below the planner name the reference systems and the paper,
    // so the cells at the foot beside the sheet number stay free.
    systems: [
      [t('plan_system_position'), plan.epsg === '-' ? '-' : `EPSG ${plan.epsg}`],
      [t('plan_system_height'), `EPSG ${plan.heightEpsg}`],
      [t('plan_system_format'), plan.format],
    ],
    footer: [[], [plan.lines[0]], []],
    sketchImage: h.sketch,
    sketch: h.sketch ? null : sketchLines(current),
    sketchCaption: t('plan_sketch_caption'),
    parties: PARTIES.map(({ key, labelKey }) => {
      const party = h.parties[key]
      const lines = party.address.split('\n').map(l => l.trim()).filter(Boolean)
      // Lines to sign on only under a column that names someone.
      return { label: `${t(labelKey)}:`, lines, logo: party.logo, signs: party.signs && (lines.length > 0 || !!party.logo) }
    }),
    staff: STAFF.map(({ key, labelKey }) => ({ label: t(labelKey), ...staffRow(h, key) })),
    dateCaption: t('plan_place_date'),
    signCaption: t('plan_signature'),
    dateHeader: t('plan_staff_date'),
    nameHeader: t('plan_staff_name'),
  })

  const run = async (after) => {
    setBusy(true)
    setStatus({ msg: t('plan_busy'), error: false })
    try {
      // Let the busy state paint before the layout takes the thread.
      await new Promise(resolve => setTimeout(resolve, 30))
      const built = await assemble(background)
      if (!built) return
      after(built)
      setStatus(built.layout.fits
        ? { msg: fill('plan_sheets_built', { n: built.plan.sheets.length }), error: false }
        : { msg: t(kind === 'schematic' ? 'plan_schematic_crowded' : 'plan_overflow'), error: true })
    } catch (err) {
      setStatus({ msg: `${t('plan_error')}: ${err.message}`, error: true })
    } finally {
      setBusy(false)
    }
  }

  const filenameBase = () => {
    const base = (project.title || t('plan_default_title')).replace(/\s+/g, '_')
    return kind === 'schematic'
      ? `${base}_${t('plan_schematic_file')}_1-${schematicScaleKey}`
      : `${base}_1-${scaleKey}`
  }

  const handlePreview = () => run(({ plan }) => onShowPlanPreview?.({ plan, filenameBase: filenameBase() }))
  const handleExport  = () => run(({ plan }) => {
    downloadBlob(renderPdf(plan).output('blob'), `${filenameBase()}.pdf`)
  })

  return (
    <>
      <h2>{t('plan_title')}</h2>
      <p className="msg-hint m-0">{t('plan_intro')}</p>

      <div className="element-form">
        <div className="form-field">
          <label>{t('plan_kind')}</label>
          <select value={kind} onChange={e => setKind(e.target.value)}>
            <option value="site">{t('plan_kind_site')}</option>
            <option value="schematic">{t('plan_kind_schematic')}</option>
          </select>
        </div>

        <div className="form-field">
          <label>{t('plan_scale')}</label>
          {kind === 'schematic' ? (
            <select value={schematicScaleKey} onChange={e => setSchematicScaleKey(e.target.value)}>
              {Object.keys(SCHEMATIC_SCALES).map(k => (
                <option key={k} value={k}>1:{Number(k).toLocaleString('de-DE')}</option>
              ))}
            </select>
          ) : (
            <select value={scaleKey} onChange={e => setScaleKey(e.target.value)}>
              {Object.keys(SCALES).map(k => <option key={k} value={k}>1:{k}</option>)}
            </select>
          )}
        </div>

        <div className="form-field">
          <label>{t('plan_paper')}</label>
          <select value={paperKey} onChange={e => setPaperKey(e.target.value)}>
            {Object.keys(PAPER_FORMATS).map(k => <option key={k} value={k}>{k} mm</option>)}
          </select>
        </div>

        {kind === 'site' && (
          <>
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
          </>
        )}

        <div className="form-field">
          <label>{t(kind === 'schematic' ? 'plan_reference_track' : 'plan_lead_track')}</label>
          <select value={leadTrackId} onChange={e => setLeadTrackId(e.target.value)}>
            <option value="">{t('plan_lead_auto')}</option>
            {groupTracks(namedTracks).map(group => (
              <optgroup key={group.key} label={groupHeading(t, group)}>
                {group.tracks.map(tr => (
                  <option key={tr.id} value={tr.id}>{trackListLabel(tr)}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {kind === 'schematic' ? (
          <div className="form-field">
            <label>{t('plan_corridor')}</label>
            <input type="number" min="20" step="50" value={corridor}
              onChange={e => setCorridor(Math.max(20, Number(e.target.value) || DEFAULT_CORRIDOR))} />
          </div>
        ) : (
          <>
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
          </>
        )}
      </div>

      <FormSection title={t('plan_content')}>
        {kind === 'schematic' ? (
          <>
            {SCHEMATIC_CONTENT_KEYS.map(([key, labelKey]) => (
              <label className="transition-curve-row" key={key}>
                <input type="checkbox" checked={schematicShow[key]}
                  onChange={e => setSchematicShow({ ...schematicShow, [key]: e.target.checked })} />
                <span>{t(labelKey)}</span>
              </label>
            ))}
            {schematicShow.km && kmLines.length === 0 && (
              <p className="form-error">{t('plan_schematic_km_missing')}</p>
            )}
          </>
        ) : (
          <>
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
          </>
        )}
      </FormSection>

      <FormSection title={t('plan_titleblock')}>
        <div className="form-field">
          <select value={blockStyle} onChange={e => setBlockStyle(e.target.value)}>
            <option value="compact">{t('plan_titleblock_compact')}</option>
            <option value="full">{t('plan_titleblock_full')}</option>
          </select>
        </div>
        <PlanHeaderFields header={header} onChange={changeHeader} simple={blockStyle !== 'full'}
          onError={msg => setStatus({ msg, error: true })} />
      </FormSection>

      {status && (
        <p className={status.error ? 'msg-error' : 'msg-info'}>
          {status.msg}
        </p>
      )}

      <button className="panel-btn panel-btn-full mt-8"
        onClick={handlePreview} disabled={busy}>
        {busy ? t('plan_busy') : t('plan_preview_btn')}
      </button>
      <button className="panel-btn panel-btn-full mt-2"
        onClick={handleExport} disabled={busy}>
        {t('plan_export_btn')}
      </button>
    </>
  )
}
