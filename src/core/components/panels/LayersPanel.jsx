import { useState } from 'react'
import {
  BASEMAPS, DEFAULT_BASEMAP, LANDESVERMESSUNG_STATES, LANDESVERMESSUNG_THUMBNAIL, lvBasemapId, lvStatesOf,
} from '../../basemaps'
import { KM_COLOR, KM_OTHER_COLOR, KM_JUMP_COLOR } from '../../map/kmLineLayer'
import { OverlayThumbnail } from '../icons'
import { useI18n } from '../../locales/i18nContext'

const GROUPS = ['worldwide', 'france', 'germany']

/** The kilometrage overlays, in their order: key into `kmOverlays` and label. */
const KM_OVERLAY_ENTRIES = [
  ['db', 'overlay_km_lines'],
  ['other', 'overlay_km_lines_other'],
]

/**
 * A row that opens a list of options below it rather than choosing anything
 * itself — the state orthophotos and the kilometrage. `sublabel` says what is
 * on; the row is marked while anything is.
 */
function FoldRow({ id, thumbnail, label, sublabel, active, open, onToggle, lang, children }) {
  return (
    <>
      <button
        type="button"
        className={`layer-row${active ? ' active' : ''}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
      >
        {thumbnail}
        <span className="layer-label">
          {label}
          <span className="layer-sublabel">{sublabel}</span>
        </span>
        <span className={`layer-caret${open ? ' open' : ''}`} aria-hidden="true">▸</span>
      </button>
      {open && <div id={id} className="layer-option-list" lang={lang}>{children}</div>}
    </>
  )
}

/** A small tile with a checkbox, one option under a FoldRow. */
function OptionTile({ label, checked, disabled, onChange }) {
  return (
    <label className={`layer-option${checked ? ' active' : ''}${disabled ? ' disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

/**
 * The map layers as one list: every basemap a row with its preview, grouped by
 * where it covers, then the overlays, which lie on top of whichever basemap is
 * chosen and so are a section of their own rather than part of a group. The
 * state orthophotos and the kilometrage open into tiles with checkboxes —
 * several states can be shown at once.
 */
export default function LayersPanel({ activeBasemap, onBasemapChange, kmOverlays, onKmOverlayChange, kmLinesError }) {
  const { t, fill, language } = useI18n()
  const [lvOpen, setLvOpen] = useState(false)
  const [kmOpen, setKmOpen] = useState(false)

  const lvStates = lvStatesOf(activeBasemap)
  const lvIds = lvStates.map((s) => s.id)
  // Ticking a state while another basemap is shown starts from that state
  // alone; unticking the last one goes back to the default map.
  const setLvState = (id, on) => {
    const next = on ? [...lvIds, id] : lvIds.filter((x) => x !== id)
    onBasemapChange(next.length ? lvBasemapId(next) : DEFAULT_BASEMAP)
  }
  const lvSublabel = lvStates.length === 0 ? t('basemap_landesvermessung_pick')
    : lvStates.length <= 2 ? lvStates.map((s) => s.name).join(', ')
    : fill('basemap_landesvermessung_count', { n: lvStates.length })

  const kmOn = KM_OVERLAY_ENTRIES.filter(([key]) => kmOverlays[key])
  const kmSublabel = kmOn.length ? kmOn.map(([, labelKey]) => t(labelKey)).join(', ') : t('layers_off')

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
              <FoldRow
                id="layers-lv-states"
                thumbnail={<img src={LANDESVERMESSUNG_THUMBNAIL} alt="" className="layer-thumbnail" />}
                label={t('basemap_landesvermessung')}
                sublabel={lvSublabel}
                active={lvStates.length > 0}
                open={lvOpen}
                onToggle={() => setLvOpen((v) => !v)}
                lang={language}
              >
                {LANDESVERMESSUNG_STATES.map((state) => (
                  <OptionTile
                    key={state.id}
                    label={state.name}
                    checked={lvIds.includes(state.id)}
                    disabled={!state.wmsUrl}
                    onChange={(on) => setLvState(state.id, on)}
                  />
                ))}
              </FoldRow>
            )}
          </div>
        </section>
      ))}

      <section className="layer-group">
        <p className="layers-group-label">{t('layers_overlays')}</p>
        <div className="layer-list">
          <FoldRow
            id="layers-km"
            thumbnail={<OverlayThumbnail kmColor={KM_COLOR} kmOtherColor={KM_OTHER_COLOR} kmJumpColor={KM_JUMP_COLOR} />}
            label={t('layers_km')}
            sublabel={kmSublabel}
            active={kmOn.length > 0}
            open={kmOpen}
            onToggle={() => setKmOpen((v) => !v)}
            lang={language}
          >
            {KM_OVERLAY_ENTRIES.map(([key, labelKey]) => (
              <OptionTile
                key={key}
                label={t(labelKey)}
                checked={kmOverlays[key]}
                onChange={(on) => onKmOverlayChange(key, on)}
              />
            ))}
          </FoldRow>
        </div>
        {kmLinesError && <p className="overlay-error">{t('overlay_km_lines_missing')}</p>}
      </section>
    </>
  )
}
