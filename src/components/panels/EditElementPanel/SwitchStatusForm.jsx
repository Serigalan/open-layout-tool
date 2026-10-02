import { useEffect, useState } from 'react'
import { loadSwitches, loadTracks, updateSwitch } from '../../../storage'
import { switchStatus } from '../../../utils/planStatus'
import StatusField from '../StatusField'
import { FILTER_NONE, HIT_TOLERANCE, filterForSwitch, mapIsLive } from '../../../utils/mapConstants'
import { useI18n } from '../../../locales/i18nContext'
import { useMap } from '../../../map/MapContext'
import { useProject } from '../../../hooks/useStore'
import { SWITCH_FILLS_LAYER, TRACKS_LAYER, TRACKS_SELECTED_LAYER } from '../../../map/layerIds'

/**
 * The planning status of a switch, picked on the map like a switch to delete.
 * Left open, the status follows the switch's tracks (planStatus.switchStatus),
 * which is what it is for most switches — only one renewed in a standing
 * track, or kept where its branch goes, needs a status of its own.
 */
export default function SwitchStatusForm({ onCommitted }) {
  const { t } = useI18n()
  const map = useMap()
  const project = useProject()
  const [selected, setSelected] = useState(null)   // switch record
  const [status, setStatus] = useState(null)

  useEffect(() => {
    const m = map?.current
    return () => {
      if (!mapIsLive(map, m)) return
      m.setFilter(TRACKS_SELECTED_LAYER, FILTER_NONE)
      m.getCanvas().style.cursor = ''
    }
  }, [map])

  useEffect(() => {
    if (selected !== null || !map?.current) return
    const m = map.current
    m.getCanvas().style.cursor = 'pointer'

    const onClick = (e) => {
      const bbox = [
        [e.point.x - HIT_TOLERANCE, e.point.y - HIT_TOLERANCE],
        [e.point.x + HIT_TOLERANCE, e.point.y + HIT_TOLERANCE],
      ]
      const hit = [
        ...m.queryRenderedFeatures(bbox, { layers: [SWITCH_FILLS_LAYER] }),
        ...m.queryRenderedFeatures(bbox, { layers: [TRACKS_LAYER] }),
      ].find(f => f.properties?.switchId)
      if (!hit) return
      const sw = loadSwitches().find(s => s.switchId === hit.properties.switchId)
      if (!sw) return
      m.setFilter(TRACKS_SELECTED_LAYER, filterForSwitch(sw.switchId))
      setSelected(sw)
      setStatus(sw.status ?? null)
    }

    m.on('click', onClick)
    return () => { m.off('click', onClick); m.getCanvas().style.cursor = '' }
  }, [selected, map, project.id])

  const derived = selected
    ? switchStatus({ ...selected, status: null }, new Map(loadTracks().map(tr => [tr.id, tr])))
    : null

  const handleCommit = () => {
    updateSwitch(selected.switchId, { status: status ?? undefined })
    onCommitted?.()
  }

  return (
    <>
      {!selected ? (
        <p>{t('switch_status_hint')}</p>
      ) : (
        <div className="element-form">
          <p>{t('switch_status_selected').replace('{name}', selected.name || selected.switchId.slice(0, 8))}</p>
          <StatusField value={status} onChange={setStatus} auto={derived} />
        </div>
      )}
      {selected && (
        <button className="panel-btn panel-btn-full" style={{ marginTop: 8 }} onClick={handleCommit}>
          {t('btn_commit')}
        </button>
      )}
      <button className="panel-btn panel-btn-full" style={{ marginTop: selected ? 2 : 8, background: '#888' }} onClick={onCommitted}>
        {t('btn_cancel')}
      </button>
    </>
  )
}
