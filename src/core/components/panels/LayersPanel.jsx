import { useState } from 'react'
import { BASEMAPS, LANDESVERMESSUNG_STATES, LANDESVERMESSUNG_THUMBNAIL } from '../../basemaps'
import { KM_COLOR, KM_OTHER_COLOR, KM_JUMP_COLOR } from '../../utils/kmLineLayer'
import { OverlayThumbnail } from '../icons'
import { useI18n } from '../../locales/i18nContext'

const GROUPS = ['worldwide', 'france', 'germany']

/** The overlays the list offers, in its order: key into `kmOverlays` and label. */
const KM_OVERLAY_ENTRIES = [
  ['db', 'overlay_km_lines'],
  ['other', 'overlay_km_lines_other'],
]

/**
 * The map layers as one list: every basemap a row with its preview, grouped by
 * where it covers, then the overlays, which lie on top of whichever basemap is
 * chosen and so are a section of their own rather than part of a group.
 */
export default function LayersPanel({ activeBasemap, onBasemapChange, kmOverlays, onKmOverlayChange, kmLinesError }) {
  const { t } = useI18n()
  // The state list is open for the basemap it was opened under: choosing a
  // state (or any other basemap, here or elsewhere) closes it again, and the
  // row then names the state in use.
  const [lvOpenFor, setLvOpenFor] = useState(null)
  const lvExpanded = lvOpenFor === activeBasemap
  const activeState = LANDESVERMESSUNG_STATES.find((s) => s.id === activeBasemap)

  return (
    <>
      <h2>{t('layers_title')}</h2>
      {GROUPS.map((group) => (
        <section key={group} className="layer-group">
          <p className="layers-group-label">{t(`layers_group_${group}`)}</p>
          <div className="layer-list">
            {BASEMAPS.filter((b) => b.group === group).map((basemap) => (
              <button
                key={basemap.id}
                type="button"
                className={`layer-row${activeBasemap === basemap.id ? ' active' : ''}`}
                aria-pressed={activeBasemap === basemap.id}
                onClick={() => onBasemapChange(basemap.id)}
              >
                <img src={basemap.thumbnail} alt="" className="layer-thumbnail" />
                <span className="layer-label">{t(basemap.labelKey)}</span>
              </button>
            ))}
            {group === 'germany' && (
              <>
                <button
                  type="button"
                  className={`layer-row${activeState ? ' active' : ''}`}
                  aria-expanded={lvExpanded}
                  aria-controls="layers-lv-states"
                  onClick={() => setLvOpenFor(lvExpanded ? null : activeBasemap)}
                >
                  <img src={LANDESVERMESSUNG_THUMBNAIL} alt="" className="layer-thumbnail" />
                  <span className="layer-label">
                    {t('basemap_landesvermessung')}
                    <span className="layer-sublabel">{activeState ? activeState.name : t('basemap_landesvermessung_pick')}</span>
                  </span>
                  <span className={`layer-caret${lvExpanded ? ' open' : ''}`} aria-hidden="true">▸</span>
                </button>
                {lvExpanded && (
                  <div id="layers-lv-states" className="layer-state-list">
                    {LANDESVERMESSUNG_STATES.map((state) => (
                      <button
                        key={state.id}
                        type="button"
                        className={`layer-state${activeBasemap === state.id ? ' active' : ''}`}
                        aria-pressed={activeBasemap === state.id}
                        onClick={() => state.wmsUrl && onBasemapChange(state.id)}
                        disabled={!state.wmsUrl}
                      >
                        {state.name}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      ))}

      <section className="layer-group">
        <p className="layers-group-label">{t('layers_overlays')}</p>
        <div className="layer-list">
          {KM_OVERLAY_ENTRIES.map(([key, labelKey]) => (
            <label key={key} className={`layer-row${kmOverlays[key] ? ' active' : ''}`}>
              <OverlayThumbnail kind={key} kmColor={KM_COLOR} kmOtherColor={KM_OTHER_COLOR} kmJumpColor={KM_JUMP_COLOR} />
              <span className="layer-label">{t(labelKey)}</span>
              <input
                type="checkbox"
                checked={kmOverlays[key]}
                onChange={(e) => onKmOverlayChange(key, e.target.checked)}
              />
            </label>
          ))}
        </div>
        {kmLinesError && <p className="overlay-error">{t('overlay_km_lines_missing')}</p>}
      </section>
    </>
  )
}
