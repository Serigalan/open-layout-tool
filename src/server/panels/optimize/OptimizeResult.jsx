import { grundText } from '../../../core/utils/optimizeReport'
import { useI18n } from '../../../core/locales/i18nContext'

/** One curve of the report: what changed in it and what held it, or that it stayed. */
function CurveRow({ r }) {
  const { t } = useI18n()
  const why = grundText(t, r.grund)
  return (
    <div className="list-row">
      <strong>{t('optimize_curve')} {r.group}{r.arcs > 1 ? `.${r.arc}` : ''}{r.target ? ` (${t('optimize_target')})` : ''}</strong>{' '}
      {r.changed ? (
        <>
          r {Math.round(r.rAlt)} → {Math.round(r.rNeu)} m · u {r.uAlt} → {r.uNeu} mm<br />
          v {r.vAlt.toFixed(0)} → {r.vNeu.toFixed(0)} km/h · {t('optimize_offset_used')} {r.offsetCm.toFixed(0)} cm
          {why && <><br /><span className="text-muted">{why}</span></>}
        </>
      ) : (
        <span className="text-muted">{t('optimize_unchanged')}</span>
      )}
    </div>
  )
}

/** What a run came back with: per curve, the stretches it left alone, and the speed won. */
export default function OptimizeResult({ result }) {
  const { t, fill } = useI18n()
  const changed = result.report.filter(r => r.changed).length
  return (
    <div className="mt-4">
      {result.report.map((r, i) => <CurveRow key={i} r={r} />)}
      {/* Part of the track was left alone. Saying so beats handing back half an
          answer in silence — and beats the refusal it used to be. */}
      {result.skipped?.length > 0 && (
        <p className="msg-warn">
          {fill('optimize_skipped', {
            count: result.skipped.length,
            where: result.skipped.map(s => (s.from === s.to ? `#${s.from + 1}` : `#${s.from + 1}–${s.to + 1}`)).join(', '),
          })}
          {' '}{result.skipped[0].why}
        </p>
      )}
      <p className={changed ? 'msg-info' : 'msg-error'}>
        {changed
          ? <>{t('optimize_done')}: v {result.vBestand.toFixed(0)} → {result.vNeu.toFixed(0)} km/h
            {' · '}{t('optimize_variant')}: {result.variant}
            {result.grenzwert && <>{' · '}{t(`optimize_grenzwert_${result.grenzwert}`)}</>}</>
          : t('optimize_nothing')}
      </p>
    </div>
  )
}
