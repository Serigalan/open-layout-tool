import { useEffect, useMemo } from 'react'
import { useI18n } from '../core/locales/i18nContext'
import { MapContext } from '../core/map/MapContext'
import useMapInstance from '../core/map/useMapInstance'
import TiltToggle from '../core/map/TiltToggle'
import { clearFeatures, comparisonFeatures, drawable, recordFeatures, showFeaturesSoon, zoomToFeatures } from '../core/utils/compareLayer'
import { diffEntries, diffProject } from '../core/utils/merge'
import CompareOverlay from '../core/components/collab/CompareOverlay'
import ConflictDialog from './collab/ConflictDialog'

/**
 * A record looked at read-only on a map of its own, without a working copy
 * (AP 10.8, 10.10): a comparison, a merge of one variant into another being
 * decided, or one revision. `viewer` is useViewer's.
 */
export default function ViewerView({ viewer: v }) {
  const { t } = useI18n()
  const { viewer } = v
  const { map, mapContainer, mapVersion, tilt } = useMapInstance({})
  const mapCtx = useMemo(() => ({ map, mapVersion }), [map, mapVersion])

  // A merge being decided shows on the map what it brings into the target:
  // the target as it is, pale, and the changes coloured as in a comparison.
  // A revision looked at on its own is drawn whole.
  useEffect(() => {
    if (viewer?.kind !== 'merge' && viewer?.kind !== 'view') return undefined
    const m = map.current
    if (!m) return undefined
    let features
    if (viewer.kind === 'view') {
      features = recordFeatures(drawable(viewer.record))
    } else {
      const { target } = viewer.prepared
      const merged = viewer.prepared.result.merged
      features = comparisonFeatures(drawable(target.payload), drawable(merged),
        diffEntries(diffProject(target.payload, merged)), { unchanged: true })
    }
    const stop = showFeaturesSoon(m, 'merge-preview', features)
    zoomToFeatures(m, features, { maxZoom: 15, covered: viewer.kind === 'view' ? 0 : 0.62 })
    return () => { stop(); try { clearFeatures(m, 'merge-preview') } catch { /* map gone */ } }
  }, [viewer, mapVersion, map])

  return (
    <MapContext.Provider value={mapCtx}>
      <div className="layout">
        <div className="map-pane">
          <div className="map-container" ref={mapContainer} />
          <TiltToggle tilt={tilt} />
          <div className="wc-bar" role="status">
            <span className="wc-where">
              <strong>{viewer.title}</strong>
              <span className="wc-sep">›</span>
              <span>{viewer.subtitle}</span>
            </span>
            <span className="wc-rev">{t('viewer_readonly')}</span>
            <span className="wc-actions">
              <button type="button" className="wc-btn" onClick={v.close} disabled={v.busy}>{t('viewer_back')}</button>
            </span>
          </div>
          {viewer.kind === 'compare' && (
            <CompareOverlay mapVersion={mapVersion} before={viewer.before} after={viewer.after} drawUnchanged
              beforeLabel={viewer.beforeLabel} afterLabel={viewer.afterLabel} onClose={v.close} />
          )}
          {viewer.kind === 'merge' && (
            <ConflictDialog mapVersion={mapVersion} result={viewer.prepared.result} busy={v.busy}
              title={t('home_merge_title')} mineLabel={viewer.targetName} theirsLabel={viewer.sourceName}
              onCancel={v.close} onApply={v.applyMerge} />
          )}
        </div>
      </div>
    </MapContext.Provider>
  )
}
