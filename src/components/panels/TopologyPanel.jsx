import { useEffect, useMemo } from 'react'
import { loadTracks, loadSwitches } from '../../storage'
import { topologySwitchAt } from '../../utils/topologyLayer'
import { portsOf, switchKindLabelKey } from '../../utils/switchModel'
import { mapIsLive } from '../../utils/mapConstants'
import TopologyEndsList from './TopologyEndsList'

/**
 * The topology of the project, as a panel of its own beside the map layers
 * (AP 9.5). While it is open the map shows the network and nothing else — the
 * tracks as lines, switches as circles, open ends in red, over a pale Liberty
 * (App switches both on with the panel). A click on a switch highlights the
 * tracks it connects and names them here; the button opens the diagram of the
 * connections, cluster by cluster (AP 9.6).
 */
export default function TopologyPanel({
  t, map, project, onTrackSaved, version, selectedSwitchId, onSelectSwitch, graphOpen, onShowGraph,
}) {
  // Clicking the map: a switch selects it, anywhere else clears the selection.
  useEffect(() => {
    const m = map?.current
    if (!m) return
    const onClick = (e) => onSelectSwitch?.(topologySwitchAt(m, e.point))
    const onMove = (e) => { m.getCanvas().style.cursor = topologySwitchAt(m, e.point) ? 'pointer' : '' }
    m.on('click', onClick)
    m.on('mousemove', onMove)
    return () => {
      m.off('click', onClick)
      m.off('mousemove', onMove)
      if (mapIsLive(map, m)) m.getCanvas().style.cursor = ''
    }
  }, [map, onSelectSwitch])

  const selected = useMemo(() => {
    if (!selectedSwitchId || !project) return null
    const sw = loadSwitches(project.id).find(s => s.switchId === selectedSwitchId)
    if (!sw) return null
    const byId = new Map(loadTracks(project.id).map(tr => [tr.id, tr]))
    return {
      sw,
      ports: portsOf(sw)
        .filter(p => sw[p.trackKey])
        .map(p => ({ port: p.port, track: byId.get(sw[p.trackKey]), endpoint: sw[p.endKey] })),
    }
    // `version` stands for the store, which the memo cannot see.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSwitchId, project, version])

  return (
    <>
      <h2>{t('topology_title')}</h2>
      <p className="selecting-hint">{t('topology_hint')}</p>

      <button className="panel-btn panel-btn-full" onClick={() => onShowGraph?.(!graphOpen)}>
        {t(graphOpen ? 'topology_graph_hide' : 'topology_graph_show')}
      </button>

      {selected && (
        <div className="element-form topology-selected">
          <p style={{ margin: 0 }}>
            <strong>{t(switchKindLabelKey(selected.sw.kind))} {selected.sw.name ?? ''}</strong>
          </p>
          <ul className="form-list">
            {selected.ports.map(p => (
              <li key={p.port}>
                {p.port}: {p.track?.name ?? t('topology_track_gone')}
                {' · '}{t(p.endpoint === 'BEGIN' ? 'end_begin' : 'end_end')}
              </li>
            ))}
          </ul>
          <button className="topology-ends-action" onClick={() => onSelectSwitch?.(null)}>
            {t('topology_clear_selection')}
          </button>
        </div>
      )}

      <TopologyEndsList t={t} map={map} project={project} onTrackSaved={onTrackSaved} version={version} />
    </>
  )
}
