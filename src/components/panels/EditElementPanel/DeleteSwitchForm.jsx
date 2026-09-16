import { useEffect, useState } from 'react'
import { commitSwitchDeletion, loadSwitches, loadTracks } from '../../../storage'
import { planSwitchDeletion } from '../../../utils/switchDelete'
import ConfirmModal from '../../ConfirmModal'
import { FILTER_NONE, HIT_TOLERANCE, filterForSwitch, mapIsLive } from '../../../utils/mapConstants'

/**
 * Delete a turnout (AP 1.2). The switch is picked on the map — its body, or any
 * element of either of its routes — and what the deletion would do is worked
 * out before anything happens (switchDelete.planSwitchDeletion) and shown, so
 * the difference between "the branch goes" and "the switch and both its routes
 * go" is visible from the dialog rather than from the map afterwards.
 */
export default function DeleteSwitchForm({ t, map, project, onTrackSaved, onCommitted }) {
  const [selected, setSelected]     = useState(null)   // { sw, plan }
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    const m = map?.current
    return () => {
      if (!mapIsLive(map, m)) return
      m.setFilter('tracks-selected-layer', FILTER_NONE)
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
      // The body first — it is the switch itself; an element of one of its
      // routes names it just as well.
      const hit = [
        ...m.queryRenderedFeatures(bbox, { layers: ['switch-fills-layer'] }),
        ...m.queryRenderedFeatures(bbox, { layers: ['tracks-layer'] }),
      ].find(f => f.properties?.switchId)
      if (!hit) return

      const sw = loadSwitches(project.id).find(s => s.switchId === hit.properties.switchId)
      if (!sw) return
      const plan = planSwitchDeletion(sw, loadTracks(project.id))
      if (!plan) return

      m.setFilter('tracks-selected-layer', filterForSwitch(sw.switchId))
      setSelected({ sw, plan })
    }

    m.on('click', onClick)
    return () => { m.off('click', onClick); m.getCanvas().style.cursor = '' }
  }, [selected, map, project.id])

  const handleDelete = () => {
    commitSwitchDeletion(project.id, selected.plan)
    setConfirming(false)
    setSelected(null)
    map?.current?.setFilter('tracks-selected-layer', FILTER_NONE)
    onTrackSaved?.()
  }

  const fill = (key, values) =>
    Object.entries(values).reduce((msg, [k, v]) => msg.replace(`{{${k}}}`, v), t(key))

  const plan = selected?.plan
  const name = selected ? (selected.sw.name || selected.sw.switchId.slice(0, 8)) : ''

  return (
    <>
      {!selected ? (
        <p>{t('switch_delete_hint')}</p>
      ) : (
        <>
          <p>{fill('switch_delete_selected', { name, label: selected.sw.label ?? '' })}</p>
          <p className="selecting-hint">{t(`switch_delete_reason_${plan.reason}`)}</p>
          <ul className="form-list">
            <li>{fill('switch_delete_elements', { n: plan.removedElements })}</li>
            {plan.removedTracks.length > 0 && (
              <li>{fill('switch_delete_tracks', { names: plan.removedTracks.join(', ') })}</li>
            )}
            {plan.joined && <li>{t('switch_delete_joined')}</li>}
            {plan.mergedElements > 0 && (
              <li>{fill('switch_delete_merged', { n: plan.mergedElements, m: plan.mergedInto })}</li>
            )}
          </ul>
          <button className="panel-btn panel-btn-full panel-btn-danger" onClick={() => setConfirming(true)}>
            {t('switch_delete')}
          </button>
        </>
      )}
      <button className="panel-btn panel-btn-full" style={{ marginTop: 2, background: '#888' }} onClick={onCommitted}>
        {t('btn_cancel')}
      </button>

      {confirming && (
        <ConfirmModal
          t={t}
          message={fill('switch_delete_confirm', { name })}
          onConfirm={handleDelete}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  )
}
