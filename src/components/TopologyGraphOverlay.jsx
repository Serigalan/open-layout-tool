import { useMemo } from 'react'
import { loadTracks, loadSwitches, loadEndMarks } from '../storage'
import { buildTopologyGraph, topologyClusters, layoutCluster, switchTrackIds } from '../utils/topologyGraph'
import { TOPOLOGY_RED, TOPOLOGY_HIGHLIGHT } from '../utils/topologyLayer'

const STEP_X = 84     // px between columns — room for a track name
const STEP_Y = 34     // px between rows
const PAD    = 28     // px around a diagram
const PARALLEL_BOW = 16   // px a second track between the same two nodes bows out by

const PRIMARY = { stroke: 'var(--color-primary)' }
const GREY = '#8a8a8a'

/**
 * The topological connections of the project and nothing else (AP 9.6): no
 * map, no geometry — nodes where tracks meet or end, and the tracks between
 * them. Each cluster of tracks connected among themselves is drawn as a
 * section of its own, in columns by the order its nodes come in along the
 * line and rows that keep parallel tracks apart (topologyGraph.layoutCluster);
 * the tracks connected to nothing are gathered in a last section.
 *
 * Clicking a switch selects it here and on the map alike: the tracks it
 * connects are highlighted in both.
 */
export default function TopologyGraphOverlay({ project, version, selectedSwitchId, onSelectSwitch, onClose, t }) {
  const data = useMemo(() => {
    if (!project) return null
    const tracks = loadTracks(project.id)
    const switches = loadSwitches(project.id)
    const graph = buildTopologyGraph(tracks, switches, loadEndMarks(project.id))
    const { clusters, loose } = topologyClusters(graph)
    return {
      switches,
      clusters: clusters.map(c => ({ ...c, pos: layoutCluster(c) })),
      loose,
      nodes: graph.nodes,
    }
    // `version` stands for the store, which the memo cannot see.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, version])

  const highlighted = useMemo(() => {
    const sw = data?.switches.find(s => s.switchId === selectedSwitchId)
    return new Set(sw ? switchTrackIds(sw) : [])
  }, [data, selectedSwitchId])

  if (!data) return null
  const fill = (key, values) =>
    Object.entries(values).reduce((msg, [k, v]) => msg.replace(`{${k}}`, v), t(key))

  return (
    <div className="track-table-overlay topology-graph-overlay">
      <div className="track-table-header">
        <span className="track-table-title">
          {t('topology_graph_title')}
          <span className="track-table-subtitle">
            {fill('topology_graph_summary', { clusters: data.clusters.length, loose: data.loose.length })}
          </span>
        </span>
        <button className="track-table-close" onClick={onClose}>✕</button>
      </div>
      <div className="track-table-scroll topology-graph-scroll">
        <Legend t={t} />
        {data.clusters.map((cluster, i) => (
          <section key={i} className="topology-graph-section">
            <h4>{fill('topology_cluster', {
              n: i + 1,
              tracks: cluster.edges.length,
              switches: cluster.nodes.filter(n => n.kind === 'switch').length,
            })}</h4>
            <div className="topology-graph-wrap">
              <ClusterDiagram cluster={cluster} highlighted={highlighted}
                selectedSwitchId={selectedSwitchId} onSelectSwitch={onSelectSwitch} />
            </div>
          </section>
        ))}
        {data.loose.length > 0 && (
          <section className="topology-graph-section">
            <h4>{fill('topology_loose', { n: data.loose.length })}</h4>
            {data.loose.map(edge => (
              <LooseTrack key={edge.trackId} edge={edge} nodes={data.nodes} />
            ))}
          </section>
        )}
        {!data.clusters.length && !data.loose.length && <p className="selecting-hint">{t('topology_graph_empty')}</p>}
      </div>
    </div>
  )
}

/** One node's symbol, centred on (x, y) — the same vocabulary as the map. */
function NodeGlyph({ node, x, y, selected, onSelect }) {
  if (node.kind === 'switch') {
    return (
      <g className="topology-graph-node" onClick={onSelect}>
        <title>{node.name ?? ''}</title>
        <circle cx={x} cy={y} r={9} fill="#fff" strokeWidth={selected ? 4 : 2.5}
          style={selected ? { stroke: TOPOLOGY_HIGHLIGHT } : PRIMARY} />
      </g>
    )
  }
  if (node.kind === 'link') {
    return (
      <g className="topology-graph-node" onClick={onSelect}>
        <title>{node.name ?? ''}</title>
        <rect x={x - 6} y={y - 6} width={12} height={12} fill="#fff" strokeWidth={selected ? 4 : 2.5}
          style={selected ? { stroke: TOPOLOGY_HIGHLIGHT } : PRIMARY} />
      </g>
    )
  }
  if (node.kind === 'joint') return <circle cx={x} cy={y} r={2.5} style={{ fill: 'var(--color-primary)' }} />
  if (node.state === 'buffer_stop') return <line x1={x} y1={y - 7} x2={x} y2={y + 7} stroke="#000" strokeWidth={3} />
  if (node.state === 'boundary') return <line x1={x} y1={y - 7} x2={x} y2={y + 7} stroke={GREY} strokeWidth={3} />
  return (
    <g>
      {node.state === 'near' && <circle cx={x} cy={y} r={8} fill="none" stroke={TOPOLOGY_RED} strokeWidth={2} />}
      <circle cx={x} cy={y} r={4.5} fill={TOPOLOGY_RED} stroke="#fff" strokeWidth={1.5} />
    </g>
  )
}

function ClusterDiagram({ cluster, highlighted, selectedSwitchId, onSelectSwitch }) {
  const { pos } = cluster
  const xs = [...pos.values()].map(p => p.x)
  const ys = [...pos.values()].map(p => p.y)
  const maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const X = (x) => PAD + x * STEP_X
  const Y = (y) => PAD + (maxY - y) * STEP_Y
  const width = PAD * 2 + maxX * STEP_X
  const height = PAD * 2 + (maxY - minY) * STEP_Y

  // Tracks between the same two nodes bow out from one another.
  const pairs = new Map()
  for (const e of cluster.edges) {
    const key = [e.from, e.to].sort().join('|')
    if (!pairs.has(key)) pairs.set(key, [])
    pairs.get(key).push(e)
  }

  // A track along one row that skips a column with a node in it would run
  // straight through that node; it bows over it instead.
  const occupied = new Set([...pos.values()].map(p => `${p.x},${p.y}`))
  const runsThrough = (a, b) => {
    if (a.y !== b.y) return false
    for (let x = Math.min(a.x, b.x) + 1; x < Math.max(a.x, b.x); x++) if (occupied.has(`${x},${a.y}`)) return true
    return false
  }

  const edgePaths = []
  for (const group of pairs.values()) {
    group.forEach((e, k) => {
      const a = pos.get(e.from), b = pos.get(e.to)
      const x1 = X(a.x), y1 = Y(a.y), x2 = X(b.x), y2 = Y(b.y)
      let d, lx, ly
      if (e.from === e.to) {
        // A loop back to its own node.
        d = `M ${x1} ${y1} C ${x1 - 30} ${y1 - 40} ${x1 + 30} ${y1 - 40} ${x1} ${y1}`
        lx = x1; ly = y1 - 32
      } else {
        let off = (k - (group.length - 1) / 2) * PARALLEL_BOW * 2
        if (!off && runsThrough(a, b)) off = PARALLEL_BOW * 1.5
        const len = Math.hypot(x2 - x1, y2 - y1) || 1
        const nx = -(y2 - y1) / len, ny = (x2 - x1) / len
        const cx = (x1 + x2) / 2 + nx * off, cy = (y1 + y2) / 2 + ny * off
        d = off ? `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}` : `M ${x1} ${y1} L ${x2} ${y2}`
        lx = (x1 + 2 * cx + x2) / 4; ly = (y1 + 2 * cy + y2) / 4
      }
      edgePaths.push({ e, d, lx, ly, on: highlighted.has(e.trackId) })
    })
  }

  return (
    <svg width={width} height={height} className="topology-graph-svg">
      {edgePaths.map(({ e, d, on }) => (
        <path key={e.trackId} d={d} fill="none" strokeWidth={on ? 5 : 2.5} strokeLinecap="round"
          style={on ? { stroke: TOPOLOGY_HIGHLIGHT } : PRIMARY}>
          <title>{e.name ?? e.trackId}</title>
        </path>
      ))}
      {edgePaths.map(({ e, lx, ly }) => (
        <text key={`l-${e.trackId}`} x={lx} y={ly - 5} className="topology-graph-label">{e.name ?? ''}</text>
      ))}
      {cluster.nodes.map(n => {
        const p = pos.get(n.id)
        const selected = n.switchId && n.switchId === selectedSwitchId
        return (
          <g key={n.id}>
            <NodeGlyph node={n} x={X(p.x)} y={Y(p.y)} selected={selected}
              onSelect={() => onSelectSwitch?.(selected ? null : n.switchId)} />
            {n.name && (n.kind === 'switch' || n.kind === 'link') && (
              <text x={X(p.x)} y={Y(p.y) + 22} className="topology-graph-label topology-graph-node-label">{n.name}</text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

/** A track connected to nothing: its two ends and its name, on one row. */
function LooseTrack({ edge, nodes }) {
  const a = nodes.get(edge.from), b = nodes.get(edge.to)
  return (
    <svg width={320} height={26} className="topology-graph-svg">
      <line x1={16} y1={13} x2={176} y2={13} strokeWidth={2.5} style={PRIMARY}>
        <title>{edge.name ?? edge.trackId}</title>
      </line>
      <NodeGlyph node={a} x={16} y={13} />
      <NodeGlyph node={b} x={176} y={13} />
      <text x={192} y={17} className="topology-graph-label" style={{ textAnchor: 'start' }}>{edge.name ?? ''}</text>
    </svg>
  )
}

function Legend({ t }) {
  const item = (node, label) => (
    <span className="topology-graph-legend-item">
      <svg width={22} height={22}><NodeGlyph node={node} x={11} y={11} /></svg>
      {label}
    </span>
  )
  return (
    <div className="topology-graph-legend">
      {item({ kind: 'switch' }, t('topology_legend_switch'))}
      {item({ kind: 'link' }, t('topology_legend_link'))}
      {item({ kind: 'joint' }, t('topology_legend_joint'))}
      {item({ kind: 'end', state: 'open' }, t('topology_state_open'))}
      {item({ kind: 'end', state: 'near' }, t('topology_state_near'))}
      {item({ kind: 'end', state: 'buffer_stop' }, t('buffer_stop_create'))}
      {item({ kind: 'end', state: 'boundary' }, t('topology_mark_boundary'))}
    </div>
  )
}
