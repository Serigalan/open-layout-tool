import { useEffect, useState } from 'react'
import { cacheLimit, cacheUsage, clearCache, setCacheLimit } from '../../../utils/pointCloud/cloudCache'
import { sizeText } from '../../../utils/pointCloud/cloudFormat'
import { useI18n } from '../../../locales/i18nContext'
import NumberInput from '../../form/NumberInput'

const GB = 1024 ** 3

/**
 * The cache of what was fetched of the server's clouds (AP 13.6): how full it
 * is, how large it may grow on this device, and emptying it.
 */
export default function CloudCacheSetting() {
  const { t, fill } = useI18n()
  const [used, setUsed] = useState(null)
  const [limit, setLimit] = useState(() => cacheLimit())

  useEffect(() => {
    let live = true
    cacheUsage().then(n => { if (live) setUsed(n) })
    return () => { live = false }
  }, [])

  const change = (gb) => {
    const bytes = Math.max(0.25, Math.min(100, gb || 2)) * GB
    setLimit(bytes)
    setCacheLimit(bytes)
  }

  return (
    <div className="pointcloud-cache">
      <span className="pointcloud-meta">
        {fill('pointcloud_cache', { used: sizeText(used ?? 0), limit: sizeText(limit) })}
      </span>
      <label className="pointcloud-meta">
        {t('pointcloud_cache_limit')}
        <NumberInput className="track-table-input" min={0.25} max={100} step={0.5}
          value={Math.round(limit / GB * 100) / 100} onChange={e => change(Number(e.target.value))} />
        GB
      </label>
      <button className="modal-btn modal-btn-cancel" onClick={async () => { await clearCache(); setUsed(0) }}>
        {t('pointcloud_cache_clear')}
      </button>
    </div>
  )
}
