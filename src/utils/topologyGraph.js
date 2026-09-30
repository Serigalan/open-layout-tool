import { classifyTrackEnds } from './topology'
import { portsOf, isLinkSwitch } from './switchModel'
import { endKey } from './trackEndMarks'

/**
 * The topology of a project as a graph, for the diagram that shows nothing
 * else (ROADMAP AP 9.6): nodes are where track ends meet — a switch, a link, a
 * plain joint — or where a track just ends; edges are the tracks.
 *
 * The graph falls apart into clusters, the parts of the network connected
 * among themselves. Each is drawn on its own; the tracks connected to nothing
 * at either end are gathered into one further section of their own.
 */

/**
 * Nodes and edges.
 *
 *   node  { id, kind: 'switch'|'link'|'joint'|'end', switchId?, name?, state?, lngLat }
 *   edge  { trackId, name, from, to }   from = the node at BEGIN, to = at END
 *
 * An `end` node carries the end's state (open, near, buffer_stop, boundary).
 */
export function buildTopologyGraph(tracks, switches, endMarks = []) {
  const ends = classifyTrackEnds(tracks, switches, endMarks)
  const nodes = new Map()
  const nodeOfEnd = new Map()   // endKey → node id

  // Switch and link nodes: one per record, at the mean of its port ends.
  for (const sw of switches ?? []) {
    const id = `sw:${sw.switchId}`
    for (const { trackKey, endKey: ek } of portsOf(sw)) {
      if (sw[trackKey] && sw[ek]) nodeOfEnd.set(endKey(sw[trackKey], sw[ek]), id)
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
      id, kind: isLinkSwitch(sw) ? 'link' : 'switch', switchId: sw.switchId, name: sw.name ?? null,
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
    edges.push({ trackId: tr.id, name: tr.name ?? null, from, to })
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

/** Metres east and north of a reference point, flat-earth. */
const local = ([lng, lat], [lng0, lat0]) => [
  (lng - lng0) * 111320 * Math.cos(lat0 * Math.PI / 180),
  (lat - lat0) * 110574,
]

/** Nodes closer than this along the cluster's axis [m] share a column. */
const SAME_COLUMN = 0.5

/**
 * A schematic layout of one cluster, as a track plan draws one: the nodes in
 * columns by the order they come in along the cluster's main direction, evenly
 * spaced whatever the distances; and in rows, the main line at 0 and every
 * node that would sit on top of a neighbour pushed off to the side it lies on
 * in the terrain. Returns Map(nodeId → { x, y }) in grid units.
 *
 * The rows are settled by relaxation: every track pulls its two nodes towards
 * one row, every pair of nodes in neighbouring columns closer than one row
 * pushes apart. Only rows move; the columns are fixed from the start, so this
 * stays cheap for a cluster of thousands of nodes.
 */
export function layoutCluster(cluster, { iterations = 120 } = {}) {
  const nodes = cluster.nodes
  const origin = nodes[0].lngLat
  const pts = nodes.map(n => local(n.lngLat, origin))

  // Main direction: the principal axis of the node positions.
  const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length
  const my = pts.reduce((s, p) => s + p[1], 0) / pts.length
  let sxx = 0, syy = 0, sxy = 0
  for (const [x, y] of pts) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my) }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  const ax = [Math.cos(angle), Math.sin(angle)]
  // Read left to right the way the map does: west to east, or south to north
  // for a cluster that runs north–south.
  if (ax[0] < -1e-9 || (Math.abs(ax[0]) < 1e-9 && ax[1] < 0)) { ax[0] = -ax[0]; ax[1] = -ax[1] }
  const along = pts.map(([x, y]) => (x - mx) * ax[0] + (y - my) * ax[1])
  // Left of the axis (seen along it) is up on the page.
  const across = pts.map(([x, y]) => -(x - mx) * ax[1] + (y - my) * ax[0])

  // Columns by rank.
  const order = nodes.map((_, i) => i).sort((a, b) => along[a] - along[b])
  const col = new Array(nodes.length)
  let c = -1, last = -Infinity
  for (const i of order) {
    if (along[i] - last > SAME_COLUMN) c += 1
    col[i] = c
    last = along[i]
  }

  const index = new Map(nodes.map((n, i) => [n.id, i]))
  const row = new Array(nodes.length).fill(0)
  const byCol = new Map()
  nodes.forEach((_, i) => {
    if (!byCol.has(col[i])) byCol.set(col[i], [])
    byCol.get(col[i]).push(i)
  })
  const links = cluster.edges.map(e => [index.get(e.from), index.get(e.to)]).filter(([a, b]) => a !== b)
  // Two nodes a track runs between may sit side by side on one row — that is
  // what a line looks like. Any other pair in neighbouring columns may not: a
  // track would run through the one to reach the other.
  const joined = new Set(links.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]))

  for (let it = 0; it < iterations; it++) {
    const push = new Array(nodes.length).fill(0)
    for (const [a, b] of links) {
      const d = row[b] - row[a]
      push[a] += 0.25 * d
      push[b] -= 0.25 * d
    }
    for (let i = 0; i < nodes.length; i++) {
      for (let dc = -1; dc <= 1; dc++) {
        for (const j of byCol.get(col[i] + dc) ?? []) {
          if (j <= i || (dc !== 0 && joined.has(`${i}|${j}`))) continue
          const d = row[j] - row[i]
          if (Math.abs(d) >= 1) continue
          // Apart towards the side each lies on in the terrain.
          const side = Math.sign(across[j] - across[i]) || (j > i ? 1 : -1)
          const f = 0.5 * (1 - Math.abs(d)) * (dc === 0 ? 1.5 : 1)
          push[i] -= side * f
          push[j] += side * f
        }
      }
    }
    for (let i = 0; i < nodes.length; i++) row[i] += Math.max(-0.5, Math.min(0.5, push[i]))
  }

  // Rows as whole numbers, the main line on 0 — nearest row, then shifted so
  // the most common row is the middle one.
  const rounded = row.map(r => Math.round(r))
  const counts = new Map()
  for (const r of rounded) counts.set(r, (counts.get(r) ?? 0) + 1)
  const main = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
  return new Map(nodes.map((n, i) => [n.id, { x: col[i], y: rounded[i] - main }]))
}

/** The tracks a switch's ports name — what clicking the switch highlights. */
export function switchTrackIds(sw) {
  return portsOf(sw).map(p => sw?.[p.trackKey]).filter(Boolean)
}
