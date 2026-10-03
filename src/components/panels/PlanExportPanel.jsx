import { useState } from 'react'
import { currentProject } from '../../storage'
import { DEFAULT_CORRIDOR } from '../../utils/planSchematic'
import { assembleSchematic, assembleSite, planFileBase } from '../../utils/planAssemble'
import { renderPdf } from '../../utils/planPdf'
import { downloadBlob } from '../../utils/fileUtils'
import { useI18n } from '../../locales/i18nContext'
import { useProject } from '../../hooks/useStore'
import FormSection from '../form/FormSection'
import PlanHeaderFields from './PlanHeaderFields'
import PlanSheetFields from './plan/PlanSheetFields'
import PlanContentSection from './plan/PlanContentSection'
import usePlanHeader from './plan/usePlanHeader'

/** The settings a new dialog starts with. */
const DEFAULTS = {
  kind: 'site',               // 'site' | 'schematic'
  scaleKey: '1000',
  schematicScaleKey: '10000',
  corridor: DEFAULT_CORRIDOR,
  schematicShow: { km: true, switches: true, trackNames: true, platforms: true },
  paperKey: '297x1920',
  mode: 'auto',
  rotation: 0,
  leadTrackId: '',
  split: true,
  overlap: 50,
  show: { mainPoints: true, labels: true, switches: true, trackNames: true, kilometrage: true },
  background: 'none',
}

/**
 * The plan of the project as a PDF (R5.5: the sheet settings, the content and
 * the title block are sections of their own; utils/planAssemble turns them
 * into the plan model).
 */
export default function PlanExportPanel({ onShowPlanPreview }) {
  const { t, language, fill } = useI18n()
  const project = useProject()
  const [o, setO] = useState(DEFAULTS)
  const set = (key, value) => setO(prev => ({ ...prev, [key]: value }))
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null)   // { msg, error }
  const [header, changeHeader] = usePlanHeader(() => setStatus({ msg: t('plan_logo_failed'), error: true }))

  const run = async (after) => {
    setBusy(true)
    setStatus({ msg: t('plan_busy'), error: false })
    try {
      // Let the busy state paint before the layout takes the thread.
      await new Promise(resolve => setTimeout(resolve, 30))
      const current = currentProject()
      if (!current.tracks?.length) { setStatus({ msg: t('plan_no_tracks'), error: true }); return }
      const opts = { ...o, header }
      const built = o.kind === 'schematic'
        ? assembleSchematic(current, opts, { t, language })
        : await assembleSite(current, opts, {
          t, language,
          onProgress: (i, n) => setStatus({ msg: fill('plan_background_busy', { i: i + 1, n }), error: false }),
          onBasemapFailed: () => setStatus({ msg: t('plan_background_failed'), error: false }),
        })
      after(built.plan, planFileBase(current, o, t))
      setStatus(built.layout.fits
        ? { msg: fill('plan_sheets_built', { n: built.plan.sheets.length }), error: false }
        : { msg: t(o.kind === 'schematic' ? 'plan_schematic_crowded' : 'plan_overflow'), error: true })
    } catch (err) {
      setStatus({ msg: `${t('plan_error')}: ${err.message}`, error: true })
    } finally {
      setBusy(false)
    }
  }

  if (!project) return null
  return (
    <>
      <h2>{t('plan_title')}</h2>
      <p className="msg-hint m-0">{t('plan_intro')}</p>
      <PlanSheetFields o={o} set={set} />
      <PlanContentSection o={o} set={set} />
      <FormSection title={t('plan_titleblock')}>
        <div className="form-field">
          <select value={header.style} onChange={e => changeHeader({ ...header, style: e.target.value })}>
            <option value="compact">{t('plan_titleblock_compact')}</option>
            <option value="full">{t('plan_titleblock_full')}</option>
          </select>
        </div>
        <PlanHeaderFields header={header} onChange={changeHeader} simple={header.style !== 'full'}
          onError={msg => setStatus({ msg, error: true })} />
      </FormSection>
      {status && <p className={status.error ? 'msg-error' : 'msg-info'}>{status.msg}</p>}
      <button className="panel-btn panel-btn-full mt-8" disabled={busy}
        onClick={() => run((plan, filenameBase) => onShowPlanPreview?.({ plan, filenameBase }))}>
        {busy ? t('plan_busy') : t('plan_preview_btn')}
      </button>
      <button className="panel-btn panel-btn-full mt-2" disabled={busy}
        onClick={() => run((plan, filenameBase) => downloadBlob(renderPdf(plan).output('blob'), `${filenameBase}.pdf`))}>
        {t('plan_export_btn')}
      </button>
    </>
  )
}
