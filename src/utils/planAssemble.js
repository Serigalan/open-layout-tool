import { PARTIES, STAFF, todayIso } from './planHeader'
import { BASEMAPS } from '../basemaps'
import { DEFAULT_HEIGHT_EPSG, heightDatumLabel } from './heightDatums'
import { PAPER_FORMATS, SCALES, TITLE_COLUMN_MM } from './planExport'
import { planSheets } from './planLayout'
import { buildPlan } from './planModel'
import { buildSchematicPlan, SCHEMATIC_SCALES } from './planSchematicPlan'
import { fetchBasemapImage } from './rasterBasemap'
import { sketchLines } from './planSketch'
import { STATUSES } from './planStatus'

// From the settings of the plan dialog and a project to the plan model —
// the layout, the title block's fields and the basemaps, apart from the
// dialog that collects the settings (R5.5).

/**
 * Backdrops a plan can be drawn over. A plain map is the safe default; an
 * aerial one carries far more ink of its own, so it is faded further to keep
 * the black linework on top of it readable.
 */
export const BACKGROUNDS = [
  { key: 'none',   labelKey: 'plan_background_none' },
  { key: 'map',    labelKey: 'plan_background_map',    basemap: 'positron',  opacity: 0.4 },
  { key: 'aerial', labelKey: 'plan_background_aerial', basemap: 'satellite', opacity: 0.6 },
]

/** A date the calendar gave (yyyy-mm-dd) as the plan states it; anything else as typed. */
export function planDate(value, language) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '')
  if (!m) return value ?? ''
  return language === 'en' ? `${m[3]}/${m[2]}/${m[1]}` : `${m[3]}.${m[2]}.${m[1]}`
}

/**
 * Who drew and checked the plan, dated. Without an entry the plan is drawn
 * today, by whoever created the project.
 */
function staffRow(header, key, { creator, language }) {
  return {
    date: planDate(header.staff[key].date || (key === 'drawn' ? todayIso() : ''), language),
    name: header.staff[key].name || (key === 'drawn' ? creator ?? '' : ''),
  }
}

/** What the simple title block reads: kind, scale, content, who drew and checked it, EPSG and paper. */
function simpleBlockFields(header, plan, { t, ...ctx }) {
  return {
    ...plan,
    labels: {
      kind: t('plan_block_kind'), scale: t('plan_block_scale'), content: t('plan_block_content'),
      epsg: t('plan_block_epsg'), format: t('plan_block_format'),
    },
    staff: [['drawn', 'plan_staff_drawn_short'], ['checked', 'plan_staff_checked_short']]
      .map(([key, labelKey]) => ({ label: t(labelKey), ...staffRow(header, key, ctx) })),
    dateHeader: t('plan_staff_date'),
    nameHeader: t('plan_staff_name'),
  }
}

/**
 * What the detailed title block reads on top of the title. Without an image
 * of its own the location sketch draws the network.
 */
function fullBlockFields(header, plan, tracks, { t, ...ctx }) {
  return {
    full: true,
    // Without a plan title of its own the third title line names the plan kind.
    subtitle: header.subtitle || plan.kind,
    range: header.range,
    // The cell above the code states the scale; a schematic plan has none.
    scale: plan.scale === '-' ? '-' : `M ${plan.scale}`,
    code: header.code,
    // The fields below the planner name the reference systems and the paper,
    // so the cells at the foot beside the sheet number stay free.
    systems: [
      [t('plan_system_position'), plan.epsg === '-' ? '-' : `EPSG ${plan.epsg}`],
      [t('plan_system_height'), `EPSG ${plan.heightEpsg}`],
      [t('plan_system_format'), plan.format],
    ],
    footer: [[], [plan.lines[0]], []],
    sketchImage: header.sketch,
    sketch: header.sketch ? null : sketchLines(tracks),
    sketchCaption: t('plan_sketch_caption'),
    parties: PARTIES.map(({ key, labelKey }) => {
      const party = header.parties[key]
      const lines = party.address.split('\n').map(l => l.trim()).filter(Boolean)
      // Lines to sign on only under a column that names someone.
      return { label: `${t(labelKey)}:`, lines, logo: party.logo, signs: party.signs && (lines.length > 0 || !!party.logo) }
    }),
    staff: STAFF.map(({ key, labelKey }) => ({ label: t(labelKey), ...staffRow(header, key, ctx) })),
    dateCaption: t('plan_place_date'),
    signCaption: t('plan_signature'),
    dateHeader: t('plan_staff_date'),
    nameHeader: t('plan_staff_name'),
  }
}

/**
 * The title block for a plan. Both blocks state the same: plan kind, scale,
 * sheet and what else `lines` holds, reference system and paper, who drew and
 * checked it — the detailed one adds parties, sketch and signatures.
 */
export function titleBlockOf({ legend, kind, scale, lines }, { project, header, paperKey, t, language }) {
  const tracks = project.tracks ?? []
  const zone = tracks.find(tr => tr.epsg)?.epsg ?? null
  const [w, h] = PAPER_FORMATS[paperKey]
  const plan = {
    kind, scale, lines,
    epsg: zone ? String(zone) : '-',
    heightEpsg: String(tracks.find(tr => tr.heightEpsg)?.heightEpsg ?? DEFAULT_HEIGHT_EPSG),
    format: `${h} × ${w} mm`,
  }
  const ctx = { t, language, creator: project.creator }
  return {
    ...(header.style === 'full' ? fullBlockFields(header, plan, tracks, ctx) : simpleBlockFields(header, plan, ctx)),
    title: project.title || t('plan_default_title'),
    legend,
  }
}

/** The overview: the network as a strip along the kilometrage. */
export function assembleSchematic(project, o, { t, language }) {
  const plan = buildSchematicPlan({
    tracks: project.tracks ?? [],
    switches: project.switches ?? [],
    platforms: project.platforms ?? [],
    kmLines: project.kmLines ?? [],
    leadTrackId: o.leadTrackId || null,
    paperKey: o.paperKey,
    scaleDen: SCHEMATIC_SCALES[o.schematicScaleKey],
    corridor: o.corridor,
    show: o.schematicShow,
    comma: language !== 'en',
    texts: {
      next: t('plan_sheet_next'), prev: t('plan_sheet_prev'), range: t('plan_km_range'),
      status: Object.fromEntries(STATUSES.map(s => [s, t(`status_${s}`)])),
    },
    // A schematic plan is to no scale, so its scale reads "-".
    titleBlock: titleBlockOf({
      legend: t('plan_schematic_legend'), kind: t('plan_kind_schematic_short'), scale: '-', lines: [t('plan_sheet_of')],
    }, { project, header: o.header, paperKey: o.paperKey, t, language }),
  })
  return { plan, layout: { fits: plan.fits } }
}

/**
 * The site plan: sheets along the tracks, each with the basemap of
 * `o.background` fetched for it (`onProgress(i, n)` before each, `onBasemapFailed`
 * when one could not be had), and the model drawn onto them.
 */
export async function assembleSite(project, o, { t, language, onProgress, onBasemapFailed }) {
  const tracks = project.tracks ?? []
  const backdrop = BACKGROUNDS.find(b => b.key === o.background) ?? BACKGROUNDS[0]
  const scaleDen = SCALES[o.scaleKey]
  const [pageW, pageH] = PAPER_FORMATS[o.paperKey]
  const reserve = o.header.style === 'full' ? TITLE_COLUMN_MM : 0
  const layout = planSheets({
    reserve,
    tracks, paperKey: o.paperKey, scaleDen, mode: o.mode, rotDeg: o.rotation,
    leadTrackId: o.leadTrackId || null, split: o.split, overlapM: o.overlap,
    jointText: { next: t('plan_sheet_next'), prev: t('plan_sheet_prev') },
  })

  const zone = tracks.find(tr => tr.epsg)?.epsg ?? null
  const basemaps = []
  if (backdrop.basemap && zone) {
    const style = BASEMAPS.find(b => b.id === backdrop.basemap)?.style
    for (const [i, sheet] of layout.sheets.entries()) {
      onProgress?.(i, layout.sheets.length)
      try {
        basemaps.push(await fetchBasemapImage({
          center: sheet.center, zone, pageW, pageH, scaleDen, rotDeg: sheet.rotDeg, style, reserve,
        }))
      } catch {
        basemaps.push(null)
        onBasemapFailed?.()
      }
    }
  }

  const heightEpsg = tracks.find(tr => tr.heightEpsg)?.heightEpsg
  const plan = buildPlan({
    tracks,
    switches: project.switches ?? [],
    kmLines: project.kmLines ?? [],
    endMarks: project.endMarks ?? [],
    sheets: layout.sheets,
    paperKey: o.paperKey, scaleDen, show: o.show, basemaps, reserve,
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
      legend: t('plan_legend'), kind: t('plan_default_title'), scale: `1:${o.scaleKey}`,
      lines: [t('plan_sheet_of'), `${t('plan_field_heights')}: ${heightDatumLabel(heightEpsg ?? DEFAULT_HEIGHT_EPSG)}`],
    }, { project, header: o.header, paperKey: o.paperKey, t, language }),
  })
  return { plan, layout }
}

/** The file name of a plan, without extension. */
export function planFileBase(project, o, t) {
  const base = (project.title || t('plan_default_title')).replace(/\s+/g, '_')
  return o.kind === 'schematic'
    ? `${base}_${t('plan_schematic_file')}_1-${o.schematicScaleKey}`
    : `${base}_1-${o.scaleKey}`
}
