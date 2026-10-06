import { useEffect, useState } from 'react'
import { deleteElements } from '../../../storage'
import { useI18n } from '../../../locales/i18nContext'
import { useTracks } from '../../../hooks/useStore'
import useMapPick, { useSelectedOnMap } from '../../../map/useMapPick'
import { useMap } from '../../../map/MapContext'
import { mapIsLive } from '../../../map/pick'

const same = (a, b) => a.trackId === b.trackId && a.elementIndex === b.elementIndex

/**
 * Deleting elements, as many as are picked, in one go (deleteElements). A
 * click adds an element or takes it out again, a Shift-click adds every
 * element of that track from the one picked last up to it; a click beside the
 * tracks lets the whole selection go. A switch's own elements — its branch
 * and the through route carved into the track it lies in — are deleted with
 * the switch, not here.
 */
export default function DeleteForm({ onCommitted }) {
  const { t, fill } = useI18n()
  const tracks = useTracks()
  const [picks, setPicks] = useState([])   // [{ trackId, elementIndex }], in the order picked
  const mapRef = useMap()

  // Shift-click picks a range here; the map would take it for a box zoom.
  useEffect(() => {
    const m = mapRef.current
    if (!m?.boxZoom?.isEnabled()) return undefined
    m.boxZoom.disable()
    return () => { if (mapIsLive(mapRef, m)) m.boxZoom.enable() }
  }, [mapRef])

  useMapPick({
    noSwitchBranch: true, hover: 'element',
    accept: (p) => !p.switchId,
    onPick: ({ trackId, elementIndex }, e) => {
      const hit = { trackId, elementIndex }
      setPicks(prev => {
        const last = prev[prev.length - 1]
        if (e?.originalEvent?.shiftKey && last?.trackId === trackId) {
          const [lo, hi] = [Math.min(last.elementIndex, elementIndex), Math.max(last.elementIndex, elementIndex)]
          const range = Array.from({ length: hi - lo + 1 }, (_, k) => ({ trackId, elementIndex: lo + k }))
            .filter(r => !tracks.find(tr => tr.id === trackId)?.elements?.[r.elementIndex]?.switchId)
          return [...prev.filter(p => !range.some(r => same(p, r))), ...range]
        }
        return prev.some(p => same(p, hit)) ? prev.filter(p => !same(p, hit)) : [...prev, hit]
      })
    },
    onMiss: () => setPicks([]),
  })
  useSelectedOnMap(picks.length ? { elements: picks } : null)

  // What is picked, by track: its name and the elements in their order.
  const byTrack = []
  for (const p of picks) {
    let row = byTrack.find(r => r.trackId === p.trackId)
    if (!row) {
      const tr = tracks.find(x => x.id === p.trackId)
      row = { trackId: p.trackId, name: tr?.name || p.trackId.slice(0, 8), idx: [] }
      byTrack.push(row)
    }
    row.idx.push(p.elementIndex)
  }

  const handleDelete = () => {
    if (!picks.length) return
    deleteElements(picks)
    setPicks([])
    onCommitted?.()
  }

  return (
    <>
      <p>{t('delete_elements_hint')}</p>
      {picks.length > 0 && (
        <>
          {byTrack.map(r => (
            <p key={r.trackId} className="msg-info">
              {fill('delete_elements_row', { track: r.name, elements: [...r.idx].sort((a, b) => a - b).map(i => i + 1).join(', ') })}
            </p>
          ))}
          <button className="panel-btn panel-btn-full panel-btn-danger" onClick={handleDelete}>
            {fill('delete_elements_btn', { n: String(picks.length) })}
          </button>
          <button className="panel-btn panel-btn-full mt-2 secondary" onClick={() => setPicks([])}>
            {t('delete_elements_clear')}
          </button>
        </>
      )}
    </>
  )
}
