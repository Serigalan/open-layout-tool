import { useI18n } from '../../locales/i18nContext'

/** The kind of track a track search keeps to (R10.6): all, on a line, in a station. */
export default function TrackKindSelect({ search }) {
  const { t } = useI18n()
  return (
    <select value={search.kind} onChange={e => search.setKind(e.target.value)} aria-label={t('type')}>
      <option value="">{t('search_kind_all')}</option>
      <option value="line">{t('search_kind_line')}</option>
      <option value="station">{t('search_kind_station')}</option>
    </select>
  )
}
