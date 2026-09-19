import { useState } from 'react'
import { BASEMAPS, LANDESVERMESSUNG_STATES } from '../../basemaps'
import { KM_COLOR, KM_OTHER_COLOR, KM_JUMP_COLOR } from '../../utils/kmLineLayer'
import { OverlayThumbnail } from '../icons'

const THUMBNAIL = {
  liberty:    '/liberty.webp',
  positron:   '/positron.webp',
  elevation:  '/dem.webp',
  satellite:  '/satellite.webp',
  'ign-ortho': '/satellite.webp',
  basemapde:  '/basemap.webp',
  dgm5:       '/dem.webp',
}

const GROUPS = ['worldwide', 'france', 'germany']

const GROUP_LABEL = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: '#888',
  margin: '6px 0 6px',
}

const SEPARATOR = { margin: '10px 0', border: 'none', borderTop: '1px solid #ddd' }

/** The overlays the list offers, in its order: key into `kmOverlays` and label. */
const KM_OVERLAY_ENTRIES = [
  ['db', 'overlay_km_lines'],
  ['other', 'overlay_km_lines_other'],
]

export default function LayersPanel({ activeBasemap, onBasemapChange, kmOverlays, onKmOverlayChange, kmLinesError, t }) {
  const anyOverlay = kmOverlays.db || kmOverlays.other
  const [lvExpanded, setLvExpanded] = useState(activeBasemap.startsWith('lv-'))
  const [overlaysExpanded, setOverlaysExpanded] = useState(anyOverlay)

  const isLvActive = activeBasemap.startsWith('lv-')

  return (
    <>
      <h2>{t('layers_title')}</h2>
      {GROUPS.map((group, i) => {
        const items = BASEMAPS.filter((b) => b.group === group)
        return (
          <div key={group}>
            {i > 0 && <hr style={SEPARATOR} />}
            <p style={GROUP_LABEL}>{t(`layers_group_${group}`)}</p>
            <div className="basemap-grid">
              {items.map((basemap) => (
                <button
                  key={basemap.id}
                  className={`basemap-tile ${activeBasemap === basemap.id ? 'active' : ''}`}
                  onClick={() => { setLvExpanded(false); onBasemapChange(basemap.id) }}
                  title={t(basemap.labelKey)}
                >
                  <img src={THUMBNAIL[basemap.id]} alt={t(basemap.labelKey)} className="basemap-thumbnail" />
                  <span className="basemap-label">{t(basemap.labelKey)}</span>
                </button>
              ))}
              {group === 'germany' && (
                <button
                  className={`basemap-tile basemap-tile-full ${isLvActive ? 'active' : ''}`}
                  onClick={() => setLvExpanded((v) => !v)}
                  title={t('basemap_landesvermessung')}
                >
                  <img src="/satellite.webp" alt={t('basemap_landesvermessung')} className="basemap-thumbnail" />
                  <span className="basemap-label">{t('basemap_landesvermessung')}</span>
                </button>
              )}
            </div>
            {group === 'germany' && lvExpanded && (
              <div className="lv-state-list">
                {LANDESVERMESSUNG_STATES.map((state) => (
                  <button
                    key={state.id}
                    className={`lv-state-btn ${activeBasemap === state.id ? 'active' : ''}`}
                    onClick={() => state.wmsUrl && onBasemapChange(state.id)}
                    disabled={!state.wmsUrl}
                  >
                    {state.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {/* Overlays lie on top of whichever basemap is chosen, so they follow the
          groups rather than belonging to one. The tile only opens the list —
          what is switched on and off are the overlays inside it. The gap is the
          one the tiles keep between themselves, so it reads as the next entry
          rather than a section of its own. */}
      <div className="basemap-grid" style={{ marginTop: 8 }}>
        <button
          className={`basemap-tile basemap-tile-full ${anyOverlay ? 'active' : ''}`}
          onClick={() => setOverlaysExpanded((v) => !v)}
          title={t('layers_overlays')}
        >
          <OverlayThumbnail kmColor={KM_COLOR} kmOtherColor={KM_OTHER_COLOR} kmJumpColor={KM_JUMP_COLOR} />
          <span className="basemap-label">{t('layers_overlays')}</span>
        </button>
      </div>
      {overlaysExpanded && (
        <div className="overlay-list">
          {KM_OVERLAY_ENTRIES.map(([key, labelKey]) => (
            <label key={key} className="transition-curve-row overlay-item">
              <input
                type="checkbox"
                checked={kmOverlays[key]}
                onChange={(e) => onKmOverlayChange(key, e.target.checked)}
              />
              <span>{t(labelKey)}</span>
            </label>
          ))}
          {kmLinesError && <p className="overlay-error">{t('overlay_km_lines_missing')}</p>}
        </div>
      )}
    </>
  )
}
