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
 * An `end` node carries the end's state (open, buffer_stop, boundary).
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

/**
 * Where each node of a cluster lies along its main direction — the principal
 * axis of the node positions, read west to east (or south to north) — and
 * across it, left of the axis positive.
 */
function clusterAxes(nodes) {
  const origin = nodes[0].lngLat
  const pts = nodes.map(n => local(n.lngLat, origin))
  const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length
  const my = pts.reduce((s, p) => s + p[1], 0) / pts.length
  let sxx = 0, syy = 0, sxy = 0
  for (const [x, y] of pts) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my) }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  const ax = [Math.cos(angle), Math.sin(angle)]
  if (ax[0] < -1e-9 || (Math.abs(ax[0]) < 1e-9 && ax[1] < 0)) { ax[0] = -ax[0]; ax[1] = -ax[1] }
  return {
    along:  pts.map(([x, y]) => (x - mx) * ax[0] + (y - my) * ax[1]),
    across: pts.map(([x, y]) => -(x - mx) * ax[1] + (y - my) * ax[0]),
  }
}

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
  const { along, across } = clusterAxes(nodes)

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

/**
 * A layout on an even grid with nothing drawn over anything else (the second
 * way the diagram can be arranged): every step between two columns and two
 * rows is the same, however long the tracks are.
 *
 * It is a layered drawing. The nodes keep the order they come in along the
 * line; every track runs at least two columns, with its name on the grid
 * point halfway along, and a track that has further to go passes through a
 * grid point in every column it crosses. So a track only ever runs from one
 * column to the next: it cannot pass through a node, two tracks between the
 * same two switches take different points in the middle column, and no two
 * lines lie on top of one another — they can at most cross. The order in each
 * column is settled by barycentre sweeps, each followed by swapping
 * neighbours wherever that saves a crossing; the rows by pulling each point level with
 * its neighbours while the order holds.
 *
 * Returns { pos: Map(nodeId → {x, y}), routes: Map(trackId → [{x, y}]),
 * labels: Map(trackId → {x, y}) } in grid units, y up. A track that runs back
 * to its own node has no route; it is drawn as a loop at that node.
 */
export function layoutClusterEven(cluster, { sweeps = 12, restarts = 8, settle = 40 } = {}) {
  const nodes = cluster.nodes
  const { along, across } = clusterAxes(nodes)
  const index = new Map(nodes.map((n, i) => [n.id, i]))
  const rank = new Array(nodes.length)
  nodes.map((_, i) => i).sort((a, b) => along[a] - along[b] || a - b).forEach((i, r) => { rank[i] = r })

  // Columns: each track two columns at least, from the node earlier along the
  // line to the later one; a node is as far left as its tracks let it be, and
  // a node reached by none (the far end of a stub) as close to the next.
  const chains = cluster.edges
    .filter(e => e.from !== e.to)
    .map(e => {
      let [a, b] = [index.get(e.from), index.get(e.to)]
      if (rank[a] > rank[b]) [a, b] = [b, a]
      return { trackId: e.trackId, a, b }
    })
  const layer = new Array(nodes.length).fill(0)
  const into = nodes.map(() => [])
  const outOf = nodes.map(() => [])
  for (const c of chains) { into[c.b].push(c); outOf[c.a].push(c) }
  const byRank = nodes.map((_, i) => i).sort((a, b) => rank[a] - rank[b])
  for (const i of byRank) for (const c of into[i]) layer[i] = Math.max(layer[i], layer[c.a] + 2)
  for (const i of [...byRank].reverse()) {
    if (into[i].length || !outOf[i].length) continue
    layer[i] = Math.max(layer[i], Math.min(...outOf[i].map(c => layer[c.b])) - 2)
  }
  const first = Math.min(...layer)
  for (let i = 0; i < layer.length; i++) layer[i] -= first

  // The points: the nodes, then for every track one point in every column it
  // crosses, the middle one carrying its name.
  const pts = nodes.map((n, i) => ({ layer: layer[i], across: across[i], nbrs: [] }))
  for (const c of chains) {
    const mid = layer[c.a] + Math.floor((layer[c.b] - layer[c.a]) / 2)
    c.points = [c.a]
    for (let l = layer[c.a] + 1; l < layer[c.b]; l++) {
      // Between its two ends in the terrain, as a start for the ordering.
      const t = (l - layer[c.a]) / (layer[c.b] - layer[c.a])
      pts.push({ layer: l, across: across[c.a] + t * (across[c.b] - across[c.a]), nbrs: [] })
      if (l === mid) c.label = pts.length - 1
      c.points.push(pts.length - 1)
    }
    c.points.push(c.b)
    for (let k = 1; k < c.points.length; k++) {
      pts[c.points[k - 1]].nbrs.push(c.points[k])
      pts[c.points[k]].nbrs.push(c.points[k - 1])
    }
  }

  const columns = []
  pts.forEach((p, i) => { (columns[p.layer] ??= []).push(i) })
  for (const col of columns) col?.sort((a, b) => pts[a].across - pts[b].across || a - b)

  // Order in each column: by the mean place of the neighbours in the column
  // just settled, sweeping right and left in turn, and after every sweep
  // neighbours in a column swapped wherever that saves a crossing. The order
  // with the fewest crossings seen is the one kept.
  const place = new Array(pts.length)
  const renumber = (col) => col.forEach((i, k) => { place[i] = k })
  columns.forEach(col => col && renumber(col))
  const crossingsOf = (u, v) => {   // u above v: how many of their lines cross
    let n = 0
    for (const pu of pts[u].nbrs) {
      for (const pv of pts[v].nbrs) {
        if (pts[pu].layer === pts[pv].layer && place[pu] > place[pv]) n += 1
      }
    }
    return n
  }
  const total = () => {
    let n = 0
    for (let l = 0; l + 1 < columns.length; l++) {
      const segs = (columns[l] ?? []).flatMap(i => pts[i].nbrs.filter(j => pts[j].layer === l + 1).map(j => [place[i], place[j]]))
      for (let x = 0; x < segs.length; x++) {
        for (let y = x + 1; y < segs.length; y++) {
          if ((segs[x][0] - segs[y][0]) * (segs[x][1] - segs[y][1]) < 0) n += 1
        }
      }
    }
    return n
  }
  const sweep = (best) => {
    for (let s = 0; s < sweeps && best.crossings > 0; s++) {
      const right = s % 2 === 0
      const from = right ? 1 : columns.length - 2
      for (let l = from; right ? l < columns.length : l >= 0; l += right ? 1 : -1) {
        const col = columns[l]
        if (!col) continue
        const other = l + (right ? -1 : 1)
        const bary = new Map(col.map(i => {
          const ns = pts[i].nbrs.filter(j => pts[j].layer === other)
          return [i, ns.length ? ns.reduce((sum, j) => sum + place[j], 0) / ns.length : place[i]]
        }))
        col.sort((a, b) => bary.get(a) - bary.get(b) || place[a] - place[b])
        renumber(col)
      }
      for (let pass = 0, better = true; better && pass < 20; pass++) {
        better = false
        for (const col of columns) {
          if (!col) continue
          for (let k = 0; k + 1 < col.length; k++) {
            const [u, v] = [col[k], col[k + 1]]
            if (crossingsOf(v, u) < crossingsOf(u, v)) {
              col[k] = v; col[k + 1] = u
              renumber(col)
              better = true
            }
          }
        }
      }
      const n = total()
      if (n < best.crossings) best = { crossings: n, columns: columns.map(col => col && [...col]) }
    }
    return best
  }
  // From the order in the terrain first; where lines still cross, again from
  // a few shuffled starts — a sweep only ever moves one point at a time, and
  // untangling a crossing can take a whole track moving to the other side.
  let best = sweep({ crossings: total(), columns: columns.map(col => col && [...col]) })
  const random = seeded(1)
  for (let r = 0; r < restarts && best.crossings > 0; r++) {
    for (const col of columns) {
      if (!col) continue
      for (let k = col.length - 1; k > 0; k--) {
        const j = Math.floor(random() * (k + 1));
        [col[k], col[j]] = [col[j], col[k]]
      }
      renumber(col)
    }
    best = sweep(best)
  }
  best.columns.forEach((col, l) => { columns[l] = col; if (col) renumber(col) })
  // A shuffled start may have turned the network upside down: turned back
  // over — which crosses nothing new — when that puts it the way up it lies.
  let lean = 0
  for (let i = 0; i < nodes.length; i++) lean += (place[i] - (columns[pts[i].layer].length - 1) / 2) * across[i]
  if (lean < 0) for (const col of columns) if (col) { col.reverse(); renumber(col) }

  // Rows: every point pulled towards the mean row of its neighbours, the
  // order in its column kept with one row at least between two points —
  // rows y_k = z_k + k with z never falling, the closest such fit found by
  // pooling adjacent violators.
  const row = new Array(pts.length)
  for (const col of columns) col?.forEach((i, k) => { row[i] = k - (col.length - 1) / 2 })
  for (let s = 0; s < settle; s++) {
    for (const col of columns) {
      if (!col) continue
      const want = col.map((i, k) => {
        const ns = pts[i].nbrs
        return (ns.length ? ns.reduce((sum, j) => sum + row[j], 0) / ns.length : row[i]) - k
      })
      fitRising(want).forEach((z, k) => { row[col[k]] = z + k })
    }
  }

  // Whole rows, the most used one at 0.
  const rounded = row.map(r => Math.round(r))
  const counts = new Map()
  for (let i = 0; i < nodes.length; i++) counts.set(rounded[i], (counts.get(rounded[i]) ?? 0) + 1)
  const main = [...counts.entries()].sort((a, b) => b[1] - a[1] || Math.abs(a[0]) - Math.abs(b[0]))[0][0]
  const at = (i) => ({ x: pts[i].layer, y: rounded[i] - main })

  return {
    pos: new Map(nodes.map((n, i) => [n.id, at(i)])),
    routes: new Map(chains.map(c => [c.trackId, c.points.map(at)])),
    labels: new Map(chains.map(c => [c.trackId, at(c.label)])),
  }
}

/** A small deterministic random generator (mulberry32): the same layout on every draw. */
function seeded(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The closest non-falling sequence to `values` (least squares, pool adjacent violators). */
function fitRising(values) {
  const blocks = []
  for (const v of values) {
    blocks.push({ sum: v, n: 1 })
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1], a = blocks[blocks.length - 2]
      if (a.sum / a.n <= b.sum / b.n) break
      blocks.pop()
      a.sum += b.sum; a.n += b.n
    }
  }
  return blocks.flatMap(b => new Array(b.n).fill(b.sum / b.n))
}

/**
 * What a selection in the topology view highlights: a switch, the tracks it
 * connects; a track, itself and the switches it runs into.
 *
 *   selection  { kind: 'switch'|'track', id } or null
 *   returns    { trackIds: [], switchIds: [] }
 */
export function selectionHighlight(selection, switches) {
  if (!selection) return { trackIds: [], switchIds: [] }
  if (selection.kind === 'switch') {
    const sw = (switches ?? []).find(s => s.switchId === selection.id)
    return sw ? { trackIds: switchTrackIds(sw), switchIds: [sw.switchId] } : { trackIds: [], switchIds: [] }
  }
  return {
    trackIds: [selection.id],
    switchIds: (switches ?? []).filter(sw => switchTrackIds(sw).includes(selection.id)).map(sw => sw.switchId),
  }
}

/** The tracks a switch's ports name — what clicking the switch highlights. */
export function switchTrackIds(sw) {
  return portsOf(sw).map(p => sw?.[p.trackKey]).filter(Boolean)
}
