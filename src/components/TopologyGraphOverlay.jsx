import { useMemo } from 'react'
import { loadTracks, loadSwitches, loadEndMarks } from '../storage'
import {
  buildTopologyGraph, topologyClusters, layoutClusterEven, selectionHighlight,
} from '../utils/topologyGraph'
import { TOPOLOGY_RED, TOPOLOGY_HIGHLIGHT } from '../utils/topologyLayer'

const PAD    = 28     // px around a diagram
const STEP_X = 56     // px between columns — a track two columns at least, its name on the middle one
const STEP_Y = 44     // px between rows

const PRIMARY = { stroke: 'var(--color-primary)' }
const GREY = '#8a8a8a'

/**
 * The topological connections of the project and nothing else (AP 9.6): no
 * map, no geometry — nodes where tracks meet or end, and the tracks between
 * them. Each cluster of tracks connected among themselves is drawn as a
 * section of its own, on an even grid with nothing drawn over anything else
 * (topologyGraph.layoutClusterEven); the tracks connected to nothing are
 * gathered in a last section.
 *
 * Clicking a switch or a track selects it here and on the map alike: a switch
 * with the tracks it connects, each in a colour of its own, a track with the
 * switches it runs into, are highlighted in both — and the map zooms to them
 * (App, through `onSelect`).
 */
export default function TopologyGraphOverlay({ project, version, selection, onSelect, onClose, t }) {
  const data = useMemo(() => {
    if (!project) return null
    const tracks = loadTracks(project.id)
    const switches = loadSwitches(project.id)
    const graph = buildTopologyGraph(tracks, switches, loadEndMarks(project.id))
    const { clusters, loose } = topologyClusters(graph)
    return {
      switches,
      clusters: clusters.map(c => ({
        ...c,
        layout: layoutClusterEven(c),
      })),
      loose,
      nodes: graph.nodes,
    }
    // `version` stands for the store, which the memo cannot see.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, version])

  const highlighted = useMemo(() => {
    const h = selectionHighlight(selection, data?.switches)
    return { colors: h.colors, switches: new Set(h.switchIds) }
  }, [data, selection])

  if (!data) return null
  const fill = (key, values) =>
    Object.entries(values).reduce((msg, [k, v]) => msg.replace(`{${k}}`, v), t(key))
  const isSelected = (kind, id) => selection?.kind === kind && selection.id === id
  const toggle = (kind, id) => onSelect?.(isSelected(kind, id) ? null : { kind, id })

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
              <ClusterDiagram cluster={cluster} highlighted={highlighted} onToggle={toggle} />
            </div>
          </section>
        ))}
        {data.loose.length > 0 && (
          <section className="topology-graph-section">
            <h4>{fill('topology_loose', { n: data.loose.length })}</h4>
            {data.loose.map(edge => (
              <LooseTrack key={edge.trackId} edge={edge} nodes={data.nodes}
                color={highlighted.colors[edge.trackId]} onToggle={toggle} />
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
      <circle cx={x} cy={y} r={4.5} fill={TOPOLOGY_RED} stroke="#fff" strokeWidth={1.5} />
    </g>
  )
}

/** Size [px] of a label in the diagram's 9 px type, near enough to keep labels apart. */
const labelBox = (text) => ({ w: String(text).length * 5.2 + 4, h: 11 })

/** Does the segment (x1, y1)–(x2, y2) touch the box? (Liang–Barsky) */
function segmentHitsBox([x1, y1, x2, y2], b) {
  let t0 = 0, t1 = 1
  const dx = x2 - x1, dy = y2 - y1
  for (const [p, q] of [[-dx, x1 - b.x0], [dx, b.x1 - x1], [-dy, y1 - b.y0], [dy, b.y1 - y1]]) {
    if (p === 0) { if (q < 0) return false; continue }
    const r = q / p
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r }
    else { if (r < t0) return false; if (r < t1) t1 = r }
  }
  return true
}

const boxesMeet = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1

/**
 * Where each label goes so that it lies over no line, no node and no other
 * label: the first of its candidate places that is free, else the one that
 * meets the least. `items` are { key, text, x, y, offsets: [[dx, dy]] } — the
 * offsets from (x, y) to the label's centre, in order of preference.
 * Returns Map(key → { x, y }), the centre of each label.
 */
function placeLabels(items, segments, nodeBoxes) {
  const placed = []
  const out = new Map()
  for (const it of items) {
    const { w, h } = labelBox(it.text)
    let best = null
    for (const [dx, dy] of it.offsets) {
      const cx = it.x + dx, cy = it.y + dy
      const box = { x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2 }
      const hits = segments.filter(sg => segmentHitsBox(sg, box)).length * 2
        + nodeBoxes.filter(nb => boxesMeet(nb, box)).length * 2
        + placed.filter(pb => boxesMeet(pb, box)).length
      if (!best || hits < best.hits) best = { hits, box, cx, cy }
      if (!hits) break
    }
    placed.push(best.box)
    out.set(it.key, { x: best.cx, y: best.cy })
  }
  return out
}

/**
 * A track's line, with a wider invisible one over it to click it by; drawn
 * broad in `color` while highlighted.
 */
function TrackPath({ edge, d, color, onToggle }) {
  return (
    <g className="topology-graph-track" onClick={() => onToggle('track', edge.trackId)}>
      <title>{edge.name ?? edge.trackId}</title>
      <path d={d} fill="none" strokeWidth={color ? 5 : 2.5} strokeLinecap="round" strokeLinejoin="round"
        style={color ? { stroke: color } : PRIMARY} />
      <path d={d} fill="none" stroke="transparent" strokeWidth={12} />
    </g>
  )
}

function ClusterDiagram({ cluster, highlighted, onToggle }) {
  const { pos, routes, labels } = cluster.layout
  const all = [...pos.values(), ...[...routes.values()].flat()]
  const xs = all.map(p => p.x)
  const ys = all.map(p => p.y)
  const maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const X = (x) => PAD + x * STEP_X
  const Y = (y) => PAD + (maxY - y) * STEP_Y
  const width = PAD * 2 + maxX * STEP_X
  const height = PAD * 2 + (maxY - minY) * STEP_Y

  // Every track along its own points, its name by its middle one and every
  // switch name by its node, each where it covers nothing. A track back to its
  // own node is a loop at that node.
  const edgePaths = []
  const segments = []
  for (const e of cluster.edges) {
    const route = routes.get(e.trackId)
    if (!route) {
      const p = pos.get(e.from)
      const x1 = X(p.x), y1 = Y(p.y)
      edgePaths.push({ e, d: `M ${x1} ${y1} C ${x1 - 30} ${y1 - 40} ${x1 + 30} ${y1 - 40} ${x1} ${y1}`, lx: x1, ly: y1 - 32 })
      continue
    }
    for (let k = 1; k < route.length; k++) {
      segments.push([X(route[k - 1].x), Y(route[k - 1].y), X(route[k].x), Y(route[k].y)])
    }
    edgePaths.push({ e, d: route.map((p, k) => `${k ? 'L' : 'M'} ${X(p.x)} ${Y(p.y)}`).join(' ') })
  }
  const nodeBoxes = cluster.nodes.map(n => {
    const p = pos.get(n.id)
    return { x0: X(p.x) - 10, x1: X(p.x) + 10, y0: Y(p.y) - 10, y1: Y(p.y) + 10 }
  })
  const half = (text) => labelBox(text).w / 2
  const named = cluster.nodes.filter(n => n.name && (n.kind === 'switch' || n.kind === 'link'))
  const places = placeLabels([
    ...named.map(n => {
      const p = pos.get(n.id)
      const r = half(n.name) + 12
      return {
        key: `n:${n.id}`, text: n.name, x: X(p.x), y: Y(p.y),
        offsets: [[0, 18], [0, -18], [r, 0], [-r, 0], [r - 6, 16], [-r + 6, 16], [r - 6, -16], [-r + 6, -16]],
      }
    }),
    ...edgePaths.filter(ep => ep.e.name && labels.has(ep.e.trackId)).map(ep => {
      const p = labels.get(ep.e.trackId)
      const r = half(ep.e.name) + 4
      return {
        key: `e:${ep.e.trackId}`, text: ep.e.name, x: X(p.x), y: Y(p.y),
        offsets: [[0, -9], [0, 9], [r, -9], [-r, -9], [r, 9], [-r, 9], [0, -20], [0, 20]],
      }
    }),
  ], segments, nodeBoxes)
  for (const ep of edgePaths) {
    const at = places.get(`e:${ep.e.trackId}`)
    if (at) { ep.lx = at.x; ep.ly = at.y + 8.5 }   // drawn 5 px above ly, the baseline 3.5 px below the centre
  }

  return (
    <svg width={width} height={height} className="topology-graph-svg">
      {edgePaths.map(({ e, d }) => (
        <TrackPath key={e.trackId} edge={e} d={d} color={highlighted.colors[e.trackId]} onToggle={onToggle} />
      ))}
      {edgePaths.map(({ e, lx, ly }) => (
        lx != null && <text key={`l-${e.trackId}`} x={lx} y={ly - 5} className="topology-graph-label">{e.name ?? ''}</text>
      ))}
      {cluster.nodes.map(n => {
        const p = pos.get(n.id)
        const on = n.switchId && highlighted.switches.has(n.switchId)
        return (
          <g key={n.id}>
            <NodeGlyph node={n} x={X(p.x)} y={Y(p.y)} selected={on}
              onSelect={() => n.switchId && onToggle('switch', n.switchId)} />
            {n.name && (n.kind === 'switch' || n.kind === 'link') && (() => {
              const at = places.get(`n:${n.id}`)
              return <text x={at.x} y={at.y + 3.5} className="topology-graph-label topology-graph-node-label">{n.name}</text>
            })()}
          </g>
        )
      })}
    </svg>
  )
}

/** A track connected to nothing: its two ends and its name, on one row. */
function LooseTrack({ edge, nodes, color, onToggle }) {
  const a = nodes.get(edge.from), b = nodes.get(edge.to)
  return (
    <svg width={320} height={26} className="topology-graph-svg">
      <TrackPath edge={edge} d="M 16 13 L 176 13" color={color} onToggle={onToggle} />
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
      {item({ kind: 'end', state: 'buffer_stop' }, t('buffer_stop_create'))}
      {item({ kind: 'end', state: 'boundary' }, t('topology_mark_boundary'))}
    </div>
  )
}
