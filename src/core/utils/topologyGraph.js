import { classifyTrackEnds } from './topology'
import { portsOf, isLinkSwitch, DEFAULT_SWITCH_KIND, turnoutLinePort } from './switchModel'
import { endKey } from './trackEndMarks'

/**
 * The topology of a project as a graph, for the diagram that shows nothing
 * else (ROADMAP AP 9.6): nodes are where track ends meet — a switch, a link, a
 * plain joint — or where a track just ends; edges are the tracks.
 *
 * The graph falls apart into clusters, the parts of the network connected
 * among themselves. Each is drawn on its own (topologyLanes); the tracks
 * connected to nothing at either end are gathered into one further section.
 */

/**
 * Nodes and edges.
 *
 *   node  { id, kind: 'switch'|'link'|'joint'|'end', switchId?, switchKind?, linePort?, name?, state?, lngLat }
 *         linePort: the port a swapped turnout's line runs on through (switchModel.turnoutLinePort)
 *   edge  { trackId, name, from, to, fromPort, toPort, length, coords }
 *
 * `from` is the node at BEGIN, `to` the one at END; `fromPort` and `toPort`
 * the switch port the end is held by (null at a joint or a free end). An
 * `end` node carries the end's state (open, buffer_stop, boundary). `length`
 * is the track's [m], `coords` its line in WGS84 from BEGIN to END — what the
 * diagram reads the side a track leaves a switch on from (topologyLanes).
 */
export function buildTopologyGraph(tracks, switches, endMarks = []) {
  const ends = classifyTrackEnds(tracks, switches, endMarks)
  const nodes = new Map()
  const nodeOfEnd = new Map()   // endKey → node id
  const portOfEnd = new Map()   // endKey → port

  // Switch and link nodes: one per record, at the mean of its port ends.
  for (const sw of switches ?? []) {
    const id = `sw:${sw.switchId}`
    for (const { trackKey, endKey: ek, port } of portsOf(sw)) {
      if (!sw[trackKey] || !sw[ek]) continue
      nodeOfEnd.set(endKey(sw[trackKey], sw[ek]), id)
      portOfEnd.set(endKey(sw[trackKey], sw[ek]), port)
    }
  }
  const at = new Map()
  for (const e of ends) {
    const key = endKey(e.trackId, e.endpoint)
    const swNode = nodeOfEnd.get(key)
    if (swNode) {
      if (!at.has(swNode)) at.set(swNode, [])
      at.get(swNode).push(e.lngLat)
    }
  }
  for (const sw of switches ?? []) {
    const id = `sw:${sw.switchId}`
    const pts = at.get(id)
    if (!pts?.length) continue
    nodes.set(id, {
      id, kind: isLinkSwitch(sw) ? 'link' : 'switch', switchId: sw.switchId,
      switchKind: sw.kind ?? DEFAULT_SWITCH_KIND, name: sw.name ?? null,
      ...(sw.swapped ? { linePort: turnoutLinePort(sw) } : {}),
      lngLat: [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length],
    })
  }

  // Joints: the free ends that meet on one node, merged by where they are.
  for (const e of ends) {
    const key = endKey(e.trackId, e.endpoint)
    if (nodeOfEnd.has(key)) continue
    if (e.state === 'joint') {
      const id = `j:${e.epsg}:${Math.round(e.easting * 100)}:${Math.round(e.northing * 100)}`
      nodeOfEnd.set(key, id)
      if (!nodes.has(id)) nodes.set(id, { id, kind: 'joint', lngLat: e.lngLat })
    } else {
      const id = `e:${key}`
      nodeOfEnd.set(key, id)
      nodes.set(id, { id, kind: 'end', state: e.state, lngLat: e.lngLat })
    }
  }

  const edges = []
  for (const tr of tracks ?? []) {
    const from = nodeOfEnd.get(endKey(tr.id, 'BEGIN'))
    const to   = nodeOfEnd.get(endKey(tr.id, 'END'))
    if (!from || !to) continue
    edges.push({
      trackId: tr.id, name: tr.name ?? null, from, to,
      fromPort: portOfEnd.get(endKey(tr.id, 'BEGIN')) ?? null,
      toPort: portOfEnd.get(endKey(tr.id, 'END')) ?? null,
      length: (tr.elements ?? []).reduce((sum, el) => sum + (el.length ?? 0), 0),
      coords: tr.coordinates?.length ? tr.coordinates : (tr.elements ?? []).flatMap(el => el.geometry?.coordinates ?? []),
    })
  }
  return { nodes, edges }
}

/**
 * The connected parts of the graph, largest first, and the tracks connected to
 * nothing: an edge whose two nodes are both plain ends and carry no other edge.
 *
 * Returns { clusters: [{ nodes: [node], edges: [edge] }], loose: [edge] }.
 */
export function topologyClusters({ nodes, edges }) {
  const parent = new Map([...nodes.keys()].map(id => [id, id]))
  const find = (x) => {
    while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x) }
    return x
  }
  for (const e of edges) parent.set(find(e.from), find(e.to))

  const groups = new Map()
  for (const e of edges) {
    const root = find(e.from)
    if (!groups.has(root)) groups.set(root, { nodeIds: new Set(), edges: [] })
    const g = groups.get(root)
    g.edges.push(e)
    g.nodeIds.add(e.from)
    g.nodeIds.add(e.to)
  }

  const clusters = []
  const loose = []
  for (const g of groups.values()) {
    const members = [...g.nodeIds].map(id => nodes.get(id))
    if (g.edges.length === 1 && members.every(n => n.kind === 'end')) loose.push(g.edges[0])
    else clusters.push({ nodes: members, edges: g.edges })
  }
  clusters.sort((a, b) => b.edges.length - a.edges.length)
  loose.sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), undefined, { numeric: true }))
  return { clusters, loose }
}

/**
 * The colours the tracks of a selected switch are told apart by, one per port
 * — on the map and in the diagram alike. Neither the red of an open end nor
 * the dark blue of an ordinary track is among them.
 */
export const TOPOLOGY_TRACK_COLORS = ['#ff8c00', '#1f9e3a', '#d0308f', '#0f9fb5', '#7b3fbf', '#a0662b']

/**
 * What a selection in the topology view highlights: a switch, the tracks it
 * connects, each in a colour of its own; a track, itself and the switches it
 * runs into.
 *
 *   selection  { kind: 'switch'|'track', id } or null
 *   returns    { trackIds: [], switchIds: [], colors: { trackId → colour } }
 */
export function selectionHighlight(selection, switches) {
  const none = { trackIds: [], switchIds: [], colors: {} }
  if (!selection) return none
  const colored = (trackIds) => Object.fromEntries(
    trackIds.map((id, k) => [id, TOPOLOGY_TRACK_COLORS[k % TOPOLOGY_TRACK_COLORS.length]]))
  if (selection.kind === 'switch') {
    const sw = (switches ?? []).find(s => s.switchId === selection.id)
    if (!sw) return none
    const trackIds = switchTrackIds(sw)
    return { trackIds, switchIds: [sw.switchId], colors: colored(trackIds) }
  }
  return {
    trackIds: [selection.id],
    switchIds: (switches ?? []).filter(sw => switchTrackIds(sw).includes(selection.id)).map(sw => sw.switchId),
    colors: colored([selection.id]),
  }
}

/** The tracks a switch's ports name — what clicking the switch highlights. */
export function switchTrackIds(sw) {
  return portsOf(sw).map(p => sw?.[p.trackKey]).filter(Boolean)
}
