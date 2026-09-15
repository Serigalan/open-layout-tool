import { useMemo, useState } from 'react'
import { renderSvg } from '../utils/planSvg'
import { renderPdf } from '../utils/planPdf'
import { downloadBlob, downloadText } from '../utils/fileUtils'

/**
 * The plan as it will be printed. Preview and PDF are two renderings of the
 * same primitive list, so what is shown here is what comes out of the export —
 * only drawn by the SVG backend instead of the PDF one.
 */
export default function PlanPreviewOverlay({ plan, filenameBase, t, onClose }) {
  const [index, setIndex] = useState(0)
  const [zoom, setZoom] = useState(1)

  const sheet = Math.min(index, plan.sheets.length - 1)
  const svg = useMemo(() => renderSvg(plan, sheet), [plan, sheet])
  const label = (key, vals) => Object.entries(vals)
    .reduce((s, [k, v]) => s.replace(`{${k}}`, v), t(key))

  const savePdf = () => {
    const doc = renderPdf(plan)
    downloadBlob(doc.output('blob'), `${filenameBase}.pdf`)
  }
  const saveSvg = () => {
    downloadText(renderSvg(plan, sheet, { standalone: true }),
      `${filenameBase}_${sheet + 1}.svg`, 'image/svg+xml')
  }

  return (
    <div className="plan-preview-overlay">
      <div className="plan-preview-header">
        <div className="plan-preview-title">
          <strong>{t('plan_preview_title')}</strong>
          <span>{label('plan_sheet_of', { i: sheet + 1, n: plan.sheets.length })}</span>
        </div>

        <div className="plan-preview-tools">
          {plan.sheets.length > 1 && (
            <>
              <button className="plan-preview-step" onClick={() => setIndex(Math.max(0, sheet - 1))}
                disabled={sheet === 0} aria-label={t('plan_sheet')}>‹</button>
              <select value={sheet} onChange={e => setIndex(Number(e.target.value))}>
                {plan.sheets.map((_, i) => (
                  <option key={i} value={i}>{`${t('plan_sheet')} ${i + 1}`}</option>
                ))}
              </select>
              <button className="plan-preview-step" onClick={() => setIndex(Math.min(plan.sheets.length - 1, sheet + 1))}
                disabled={sheet === plan.sheets.length - 1} aria-label={t('plan_sheet')}>›</button>
            </>
          )}
          <select value={zoom} onChange={e => setZoom(Number(e.target.value))}>
            <option value={1}>100 %</option>
            <option value={2}>200 %</option>
            <option value={4}>400 %</option>
            <option value={8}>800 %</option>
          </select>
          <button className="panel-btn" onClick={savePdf}>{t('plan_export_btn')}</button>
          <button className="panel-btn" onClick={saveSvg}>{t('plan_export_svg')}</button>
          <button className="plan-preview-close" onClick={onClose} aria-label={t('btn_cancel')}>×</button>
        </div>
      </div>

      <div className="plan-preview-body">
        <div
          className="plan-preview-sheet"
          style={{ width: `${zoom * 100}%` }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </div>
  )
}
