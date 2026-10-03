import { checkServices, SERVICES } from '../utils/serviceHealth'
import useServiceHealth from '../hooks/useServiceHealth'
import { formatDate } from '../locales/i18n'
import { useI18n } from '../locales/i18nContext'

/**
 * Whether what the app depends on is there (R10.12): a dot per service at the
 * foot of the sidebar — green, red, grey while not yet asked — named with the
 * time of the last look; a click asks again at once.
 */
export default function ServiceStatus() {
  const { t, fill, language } = useI18n()
  const health = useServiceHealth()
  const line = (s) => {
    const { ok, at } = health[s]
    const state = ok === null ? t('service_unknown') : t(ok ? 'service_ok' : 'service_down')
    return at ? fill('service_line', { name: t(`service_${s}`), state, at: formatDate(at, language, { time: true }) })
      : `${t(`service_${s}`)}: ${state}`
  }
  const title = `${SERVICES.map(line).join('\n')}\n${t('service_recheck')}`
  return (
    <button type="button" className="service-status" title={title} aria-label={title} onClick={() => checkServices()}>
      {SERVICES.map(s => (
        <span key={s} className={`service-dot ${health[s].ok === null ? 'unknown' : health[s].ok ? 'ok' : 'down'}`} aria-hidden="true" />
      ))}
    </button>
  )
}
