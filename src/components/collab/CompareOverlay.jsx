import { useEffect, useMemo, useState } from 'react'
import { diffEntries, diffProject, primary } from '../../utils/merge'
import {
  COMPARE_COLORS, clearFeatures, comparisonFeatures, comparisonTopology, drawable, showFeaturesSoon,
  trackStylesOf, zoomToFeatures,
} from '../../utils/compareLayer'
import TopologyGraphOverlay from '../TopologyGraphOverlay'
import { entryText, fill } from './mergeText'
import './collab.css'
import { useI18n } from '../../locales/i18nContext'
import { useMap } from '../../map/MapContext'

const LAYER = 'compare'
const KINDS = ['added', 'changed', 'removed']

/**
 * Two states of a project over each other (AP 10.3): on the map what is new
 * green, what changed orange, what is gone grey and dashed; the same in the
 * topology diagram; and beside it the list of the objects concerned — a click
 * zooms to one.
 *
 * `before` and `after` are records (hydrated or not). With `drawUnchanged`
 * the tracks neither touched are drawn too, for a comparison of states the
 * map does not show of itself.
 */
export default function CompareOverlay({ mapVersion = 0, before, after, beforeLabel, afterLabel, drawUnchanged = false, onClose }) {
  const { t } = useI18n()
  const map = useMap()
  const data = useMemo(() => {
    const entries = diffEntries(diffProject(before, after))
    const hb = drawable(primary(before)), ha = drawable(primary(after))
    const features = comparisonFeatures(hb, ha, entries, { unchanged: drawUnchanged })
    return {
      entries, features,
      topology: comparisonTopology(primary(before), primary(after)),
      styles: trackStylesOf(entries),
    }
  }, [before, after, drawUnchanged])
  const [tab, setTab] = useState('list')
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    const m = map?.current
    if (!m) return undefined
    const stop = showFeaturesSoon(m, LAYER, data.features)
    if (drawUnchanged) zoomToFeatures(m, data.features, { maxZoom: 15 })
    return () => { stop(); try { clearFeatures(m, LAYER) } catch { /* map already gone */ } }
  }, [map, mapVersion, data, drawUnchanged])

  const counts = Object.fromEntries(KINDS.map(k => [k, data.entries.filter(e => e.kind === k).length]))
  const pick = (e) => {
    const key = `${e.collection}|${e.id}`
    setSelected(key)
    zoomToFeatures(map?.current, data.features.filter(f => f.properties.entry === key))
  }

  if (tab === 'topology') {
    return (
      <TopologyGraphOverlay source={data.topology} trackStyles={data.styles}
        title={t('compare_topology_title')} onClose={() => setTab('list')} />
    )
  }

  return (
    <div className="track-table-overlay collab-overlay">
      <div className="track-table-header">
        <span className="track-table-title">
          {t('compare_title')}
          <span className="track-table-subtitle">{fill(t, 'compare_from_to', { before: beforeLabel, after: afterLabel })}</span>
        </span>
        <div className="collab-header-actions">
          <button type="button" className="collab-tab" onClick={() => setTab('topology')}>{t('compare_topology')}</button>
          <button className="track-table-close" onClick={onClose} aria-label="close">✕</button>
        </div>
      </div>
      <div className="collab-legend">
        {KINDS.map(k => (
          <span key={k} className="collab-legend-item">
            <span className={`collab-swatch collab-swatch-${k}`} style={{ '--swatch': COMPARE_COLORS[k] }} />
            {t(`compare_${k}`)} ({counts[k]})
          </span>
        ))}
        <span className="collab-legend-hint">{t('compare_zoom_hint')}</span>
      </div>
      <div className="track-table-scroll collab-scroll">
        {data.entries.length === 0 && <p className="collab-empty">{t('compare_none')}</p>}
        <ul className="collab-list">
          {data.entries.map(e => {
            const key = `${e.collection}|${e.id}`
            return (
              <li key={`${key}|${e.kind}`}>
                <button type="button" className={`collab-row ${selected === key ? 'selected' : ''}`} onClick={() => pick(e)}>
                  <span className="collab-badge" style={{ '--badge': COMPARE_COLORS[e.kind] }}>{t(`compare_${e.kind}`)}</span>
                  <span className="collab-row-text">{entryText(t, e)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
