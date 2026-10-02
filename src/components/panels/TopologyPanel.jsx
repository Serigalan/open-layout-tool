import { useEffect, useMemo } from 'react'
import { loadTracks, loadSwitches, loadEndMarks } from '../../storage'
import { topologySelectionAt } from '../../utils/topologyLayer'
import { classifyTrackEnds } from '../../utils/topology'
import { selectionHighlight } from '../../utils/topologyGraph'
import { portsOf, switchKindLabelKey } from '../../utils/switchModel'
import { mapIsLive } from '../../utils/mapConstants'
import TopologyEndsList from './TopologyEndsList'

/** What an end that holds no switch port is, in the panel's words. */
const END_STATE_KEY = {
  joint: 'topology_legend_joint',
  buffer_stop: 'buffer_stop_create',
  boundary: 'topology_mark_boundary',
  open: 'topology_state_open',
}

/**
 * The topology of the project, as a panel of its own beside the map layers
 * (AP 9.5). While it is open the map shows the network and nothing else — the
 * tracks as lines, switches as circles, open ends in red, over a pale Liberty
 * (App switches both on with the panel). A click on a switch highlights the
 * tracks it connects, each in a colour of its own, a click on a track the
 * switches it runs into; either is named here, each name a step on to that
 * switch or track. The diagram of the connections, cluster by cluster
 * (AP 9.6), comes up with the panel; the button hides it and brings it back.
 */
export default function TopologyPanel({
  t, map, project, selection, onSelect, graphOpen, onShowGraph,
}) {
  // Clicking the map: a switch or a track selects it, anywhere else clears the selection.
  useEffect(() => {
    const m = map?.current
    if (!m) return
    const onClick = (e) => onSelect?.(topologySelectionAt(m, e.point))
    const onMove = (e) => { m.getCanvas().style.cursor = topologySelectionAt(m, e.point) ? 'pointer' : '' }
    m.on('click', onClick)
    m.on('mousemove', onMove)
    return () => {
      m.off('click', onClick)
      m.off('mousemove', onMove)
      if (mapIsLive(map, m)) m.getCanvas().style.cursor = ''
    }
  }, [map, onSelect])

  const selected = useMemo(() => {
    if (!selection || !project) return null
    const tracks = loadTracks()
    const switches = loadSwitches()
    const byId = new Map(tracks.map(tr => [tr.id, tr]))
    if (selection.kind === 'switch') {
      const sw = switches.find(s => s.switchId === selection.id)
      if (!sw) return null
      const { colors } = selectionHighlight(selection, switches)
      return {
        kind: 'switch', sw, colors,
        ports: portsOf(sw)
          .filter(p => sw[p.trackKey])
          .map(p => ({ port: p.port, trackId: sw[p.trackKey], track: byId.get(sw[p.trackKey]), endpoint: sw[p.endKey] })),
      }
    }
    const track = byId.get(selection.id)
    if (!track) return null
    const ends = classifyTrackEnds(tracks, switches, loadEndMarks()).filter(e => e.trackId === track.id)
    return {
      kind: 'track', track,
      ends: ['BEGIN', 'END'].map(endpoint => {
        const sw = switches.find(s => portsOf(s).some(p => s[p.trackKey] === track.id && s[p.endKey] === endpoint))
        const port = sw && portsOf(sw).find(p => sw[p.trackKey] === track.id && sw[p.endKey] === endpoint).port
        const state = ends.find(e => e.endpoint === endpoint)?.state
        return { endpoint, sw, port, state }
      }),
    }
    // `project` is the store's live record: it changes with every write.
  }, [selection, project])

  const pickTrack = (trackId) => onSelect?.({ kind: 'track', id: trackId })
  const pickSwitch = (switchId) => onSelect?.({ kind: 'switch', id: switchId })
  const endLabel = (endpoint) => t(endpoint === 'BEGIN' ? 'end_begin' : 'end_end')

  return (
    <>
      <h2>{t('topology_title')}</h2>
      <p className="selecting-hint">{t('topology_hint')}</p>

      <button className="panel-btn panel-btn-full" onClick={() => onShowGraph?.(!graphOpen)}>
        {t(graphOpen ? 'topology_graph_hide' : 'topology_graph_show')}
      </button>

      {selected?.kind === 'switch' && (
        <div className="element-form topology-selected">
          <p style={{ margin: 0 }}>
            <strong>{t(switchKindLabelKey(selected.sw.kind))} {selected.sw.name ?? ''}</strong>
          </p>
          <ul className="form-list">
            {selected.ports.map(p => (
              <li key={p.port}>
                <span className="topology-swatch" style={{ background: selected.colors[p.trackId] }} />
                {p.port}:{' '}
                {p.track
                  ? <button type="button" className="link-joint-btn" onClick={() => pickTrack(p.trackId)}>{p.track.name ?? p.trackId.slice(0, 8)}</button>
                  : t('topology_track_gone')}
                {' · '}{endLabel(p.endpoint)}
              </li>
            ))}
          </ul>
          <button className="topology-ends-action" onClick={() => onSelect?.(null)}>
            {t('topology_clear_selection')}
          </button>
        </div>
      )}

      {selected?.kind === 'track' && (
        <div className="element-form topology-selected">
          <p style={{ margin: 0 }}>
            <strong>{t('topology_track')} {selected.track.name ?? selected.track.id.slice(0, 8)}</strong>
          </p>
          <ul className="form-list">
            {selected.ends.map(end => (
              <li key={end.endpoint}>
                {endLabel(end.endpoint)}:{' '}
                {end.sw
                  ? <>
                      <button type="button" className="link-joint-btn" onClick={() => pickSwitch(end.sw.switchId)}>
                        {t(switchKindLabelKey(end.sw.kind))} {end.sw.name ?? ''}
                      </button>
                      {' · '}{end.port}
                    </>
                  : t(END_STATE_KEY[end.state] ?? 'topology_state_open')}
              </li>
            ))}
          </ul>
          <button className="topology-ends-action" onClick={() => onSelect?.(null)}>
            {t('topology_clear_selection')}
          </button>
        </div>
      )}

      <TopologyEndsList t={t} map={map} project={project} />
    </>
  )
}
