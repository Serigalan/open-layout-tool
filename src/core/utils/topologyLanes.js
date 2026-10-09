/**
 * The layout of the topology diagram (AP 9.8): every line through the network
 * on a row of its own, the way a track plan draws it.
 *
 * A line is what a train runs along without turning off: tracks chained
 * through the straight route of every turnout (A–B2), the main route of every
 * crossing (A–C), every link and every plain joint. The longest line is the
 * main row; every other one is laid on the row next to the line it leaves,
 * on the side it lies in the terrain. What is left over — a single track
 * from one line to another, a crossover — is drawn as a short diagonal
 * between their rows, and a single track that leaves a line and joins it
 * again is a line of its own, beside it.
 *
 * The columns come from the switches, not from the terrain: at a turnout the
 * two tracks of B1 and B2 leave on the one side, A on the other, and at a
 * crossing A and B lie on one side, C and D on the other. So every track runs
 * from left to right, and every node sits two columns at least right of every
 * track's left end that leads into it — and no further than that asks. A
 * track that cannot run so — a reversing loop, a triangle — is drawn as a
 * bend back to where it came from.
 *
 * Nothing here promises no crossing: a line further out than another one it
 * branches past crosses it, as it does in the terrain.
 */

/** Which side of its node each port lies on — 0 the one, 1 the other. */
const PORT_SIDE = {
  turnout: { A: 0, B1: 1, B2: 1 },
  crossing: { A: 0, B: 0, C: 1, D: 1 },
  link: { A: 0, B: 1 },
}
PORT_SIDE.single_slip = PORT_SIDE.crossing
PORT_SIDE.double_slip = PORT_SIDE.crossing

/** The ports a line runs straight through. */
const THROUGH = {
  turnout: [['A', 'B2']],
  crossing: [['A', 'C']],
  link: [['A', 'B']],
}
THROUGH.single_slip = THROUGH.crossing
THROUGH.double_slip = THROUGH.crossing

/** How far along both tracks [m] the side one leaves a switch on is read. */
const SIDE_DISTANCE = 60

/** Columns a track spans at least: room for its name between its nodes. */
const MIN_SPAN = 2

/** Columns a track that climbs rows is given at most. */
const MAX_SPAN = 6

/** Metres east and north of a reference point, flat-earth. */
const local = ([lng, lat], [lng0, lat0]) => [
  (lng - lng0) * 111320 * Math.cos(lat0 * Math.PI / 180),
  (lat - lat0) * 110574,
]

const cross = (a, b) => a[0] * b[1] - a[1] * b[0]
const minus = (a, b) => [a[0] - b[0], a[1] - b[1]]

/**
 * Where each point lies along the main direction of them all — the principal
 * axis, read west to east (or south to north).
 */
function alongAxis(pts) {
  const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length
  const my = pts.reduce((s, p) => s + p[1], 0) / pts.length
  let sxx = 0, syy = 0, sxy = 0
  for (const [x, y] of pts) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my) }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  const ax = [Math.cos(angle), Math.sin(angle)]
  if (ax[0] < -1e-9 || (Math.abs(ax[0]) < 1e-9 && ax[1] < 0)) { ax[0] = -ax[0]; ax[1] = -ax[1] }
  return pts.map(([x, y]) => (x - mx) * ax[0] + (y - my) * ax[1])
}

/** Length of a polyline. */
function lineLength(line) {
  let len = 0
  for (let k = 1; k < line.length; k++) len += Math.hypot(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1])
  return len
}

/** The point `d` along a polyline from its start, or its last one. */
function pointAlong(line, d) {
  for (let k = 1; k < line.length; k++) {
    const step = Math.hypot(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1])
    if (step >= d && step > 0) {
      const t = d / step
      return [line[k - 1][0] + t * (line[k][0] - line[k - 1][0]), line[k - 1][1] + t * (line[k][1] - line[k - 1][1])]
    }
    d -= step
  }
  return line[line.length - 1]
}

/** Distance from a point to a polyline. */
function distanceToLine(p, line) {
  if (line.length === 1) return Math.hypot(p[0] - line[0][0], p[1] - line[0][1])
  let best = Infinity
  for (let k = 1; k < line.length; k++) {
    const a = line[k - 1], b = line[k]
    const ab = minus(b, a), ap = minus(p, a)
    const l2 = ab[0] ** 2 + ab[1] ** 2
    const t = l2 ? Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1]) / l2)) : 0
    best = Math.min(best, Math.hypot(ap[0] - t * ab[0], ap[1] - t * ab[1]))
  }
  return best
}

/**
 * Parity union-find: variables joined by "these two are equal / differ",
 * telling when a new such statement contradicts the ones before.
 */
function paritySets(n) {
  const parent = Int32Array.from({ length: n }, (_, i) => i)
  const parity = new Uint8Array(n)
  const find = (x) => {
    let p = 0, r = x
    while (parent[r] !== r) { p ^= parity[r]; r = parent[r] }
    // Path compression, keeping each one's parity to the root.
    let q = x, pq = p
    while (parent[q] !== r) {
      const next = parent[q], pn = pq ^ parity[q]
      parent[q] = r; parity[q] = pq
      q = next; pq = pn
    }
    return [r, p]
  }
  /** a ⊕ b = d; false if that contradicts what is known. */
  const join = (a, b, d) => {
    const [ra, pa] = find(a), [rb, pb] = find(b)
    if (ra === rb) return (pa ^ pb) === d
    parent[ra] = rb
    parity[ra] = pa ^ pb ^ d
    return true
  }
  return { find, join }
}

/**
 * A layout of one cluster: lines on rows, crossovers between them.
 *
 * Returns { pos: Map(nodeId → {x, y}), routes: Map(trackId → [{x, y}]),
 * labels: Map(trackId → {x, y}) } in grid units, y up, the main line on row
 * 0. A track that runs back to its own node has no route; it is drawn as a
 * loop at that node.
 */
export function layoutClusterLanes(cluster) {
  const nodes = cluster.nodes
  const N = nodes.length
  const index = new Map(nodes.map((n, i) => [n.id, i]))
  const origin = nodes[0].lngLat
  const xy = nodes.map(n => local(n.lngLat, origin))
  const along = alongAxis(xy)

  const edges = cluster.edges.filter(e => e.from !== e.to).map(e => {
    const u = index.get(e.from), v = index.get(e.to)
    const line = (e.coords?.length ?? 0) >= 2 ? e.coords.map(c => local(c, origin)) : [xy[u], xy[v]]
    const len = lineLength(line)
    return { e, u, v, line, len, weight: e.length || len }
  })
  const K = edges.length

  // The ends at every node, and the side of it each lies on.
  const ends = Array.from({ length: N }, () => [])    // { k, end: 0 at BEGIN | 1 at END, port }
  edges.forEach((ed, k) => {
    ends[ed.u].push({ k, end: 0, port: ed.e.fromPort })
    ends[ed.v].push({ k, end: 1, port: ed.e.toPort })
  })
  const sideOf = new Array(2 * K).fill(null)          // by k * 2 + end
  for (let v = 0; v < N; v++) {
    const node = nodes[v]
    const sides = PORT_SIDE[node.switchKind]
    if ((node.kind === 'switch' || node.kind === 'link') && sides) {
      for (const at of ends[v]) sideOf[at.k * 2 + at.end] = sides[at.port] ?? null
    } else if (node.kind === 'joint' && ends[v].length === 2) {
      ends[v].forEach((at, j) => { sideOf[at.k * 2 + at.end] = j })
    }
  }

  // Which way every track runs. Variables: for track k whether it runs from
  // BEGIN to the right (k), for node v whether it is turned over (K + v). An
  // end on side p at its node says: track ⊕ node = p ⊕ end. Long tracks first,
  // so what contradicts them falls to the short ones.
  const sets = paritySets(K + N)
  const bent = new Uint8Array(K)                      // runs back the way it came
  const byWeight = [...Array(K).keys()].sort((a, b) => edges[b].weight - edges[a].weight || a - b)
  for (const k of byWeight) {
    for (const end of [0, 1]) {
      const side = sideOf[k * 2 + end]
      if (side === null) continue
      const v = end ? edges[k].v : edges[k].u
      if (!sets.join(k, K + v, side ^ end)) bent[k] = 1
    }
  }
  // Each set of tracks tied together once more turned so that it runs the way
  // the line does in the terrain, west to east.
  const lean = new Map()
  edges.forEach((ed, k) => {
    if (bent[k]) return
    const [root, p] = sets.find(k)
    lean.set(root, (lean.get(root) ?? 0) + (along[ed.v] - along[ed.u]) * (p ? 1 : -1))
  })
  const value = (x) => {
    const [root, p] = sets.find(x)
    return p ^ ((lean.get(root) ?? 0) < 0 ? 1 : 0)
  }
  const leftOf = new Int32Array(K), rightOf = new Int32Array(K)
  edges.forEach((ed, k) => {
    const forward = value(k) === 1
    leftOf[k] = forward ? ed.u : ed.v
    rightOf[k] = forward ? ed.v : ed.u
  })
  /** Does track k leave node v to the right? */
  const leavesRight = (k, v) => leftOf[k] === v
  // A bent track: the side its ends leave their nodes on, by the node's turn.
  const bentSide = (k, end) => {
    const v = end ? edges[k].v : edges[k].u
    return (sideOf[k * 2 + end] ?? 0) ^ value(K + v)
  }

  // Columns: in order, every node two columns right of what leads into it; a
  // cycle left over, which consistent switches cannot make, is broken by
  // bending a track of it.
  const into = Array.from({ length: N }, () => [])
  const outOf = Array.from({ length: N }, () => [])
  const indeg = new Int32Array(N)
  for (let k = 0; k < K; k++) {
    if (bent[k]) continue
    outOf[leftOf[k]].push(k)
    into[rightOf[k]].push(k)
    indeg[rightOf[k]] += 1
  }
  const order = []
  const done = new Uint8Array(N)
  const ready = [...Array(N).keys()].filter(v => !indeg[v])
  while (order.length < N) {
    if (!ready.length) {
      let v = -1
      for (let w = 0; w < N; w++) if (!done[w] && (v < 0 || along[w] < along[v])) v = w
      for (const k of into[v]) if (!bent[k]) { bent[k] = 1; indeg[v] -= 1 }
      ready.push(v)
      continue
    }
    ready.sort((a, b) => along[b] - along[a])
    const v = ready.pop()
    if (done[v]) continue
    done[v] = 1
    order.push(v)
    for (const k of outOf[v]) {
      if (bent[k]) continue
      if (--indeg[rightOf[k]] === 0) ready.push(rightOf[k])
    }
  }
  /** Columns, every track `spanOf(k)` columns long at least. */
  const columns = (spanOf) => {
    const x = new Float64Array(N)
    for (const v of order) for (const k of into[v]) if (!bent[k]) x[v] = Math.max(x[v], x[leftOf[k]] + spanOf(k))
    // Every track as short as the others let it be: a node with more tracks on
    // its right moves right, one with more on its left moves left, as far as
    // its neighbours allow. Each move shortens the total; it stops when none does.
    for (let pass = 0; pass < 100; pass++) {
      let moved = false
      for (const v of pass % 2 ? [...order].reverse() : order) {
        let lo = -Infinity, hi = Infinity, ins = 0, outs = 0
        for (const k of into[v]) if (!bent[k]) { lo = Math.max(lo, x[leftOf[k]] + spanOf(k)); ins += 1 }
        for (const k of outOf[v]) if (!bent[k]) { hi = Math.min(hi, x[rightOf[k]] - spanOf(k)); outs += 1 }
        const want = ins > outs ? lo : outs > ins ? hi : x[v]
        if (Number.isFinite(want) && want !== x[v]) { x[v] = want; moved = true }
      }
      if (!moved) break
    }
    const x0 = Math.min(...x)
    for (let v = 0; v < N; v++) x[v] -= x0
    return x
  }

  // Lines: the ends a line runs straight through, paired at their node.
  const mate = new Int32Array(2 * K).fill(-1)
  for (let v = 0; v < N; v++) {
    const node = nodes[v]
    const pairs = []
    if (node.kind === 'switch' || node.kind === 'link') {
      // A swapped turnout's line runs on over its branch (switchModel.turnoutLinePort).
      const through = node.linePort ? [['A', node.linePort]] : THROUGH[node.switchKind] ?? []
      for (const [p, q] of through) {
        const a = ends[v].find(at => at.port === p), b = ends[v].find(at => at.port === q)
        if (a && b) pairs.push([a, b])
      }
    } else if (node.kind === 'joint' && ends[v].length === 2) {
      pairs.push(ends[v])
    }
    for (const [a, b] of pairs) {
      if (bent[a.k] || bent[b.k] || a.k === b.k) continue
      mate[a.k * 2 + a.end] = b.k * 2 + b.end
      mate[b.k * 2 + b.end] = a.k * 2 + a.end
    }
  }
  const endAt = (k, v) => (edges[k].u === v ? 0 : 1)
  const lineOfEdge = new Int32Array(K).fill(-1)
  const lines = []    // { edges: [k], nodes: [v], weight }
  for (const k0 of byWeight) {
    if (bent[k0] || lineOfEdge[k0] >= 0) continue
    let k = k0
    const seen = new Set([k])
    for (;;) {
      const m = mate[k * 2 + endAt(k, leftOf[k])]
      if (m < 0 || seen.has(m >> 1)) break
      k = m >> 1
      seen.add(k)
    }
    const line = { edges: [], nodes: [leftOf[k]], weight: 0 }
    for (;;) {
      line.edges.push(k)
      line.nodes.push(rightOf[k])
      line.weight += edges[k].weight
      lineOfEdge[k] = lines.length
      const m = mate[k * 2 + endAt(k, rightOf[k])]
      if (m < 0 || lineOfEdge[m >> 1] >= 0) break
      k = m >> 1
    }
    lines.push(line)
  }
  // Every node on the row of the line through it; where none runs through, of
  // the weightiest one that ends there — and a node only bent tracks reach
  // is a line of its own.
  const owner = new Int32Array(N).fill(-1)
  for (let s = 0; s < lines.length; s++) {
    const ln = lines[s]
    ln.nodes.forEach((v, j) => { if (j > 0 && j < ln.nodes.length - 1) owner[v] = s })
  }
  for (let v = 0; v < N; v++) {
    if (owner[v] >= 0) continue
    let best = -1
    for (const at of ends[v]) {
      const s = lineOfEdge[at.k]
      if (s >= 0 && (best < 0 || lines[s].weight > lines[best].weight)) best = s
    }
    if (best < 0) { best = lines.length; lines.push({ edges: [], nodes: [v], weight: 0 }) }
    owner[v] = best
  }

  // A line that holds no node of its own is a crossover, drawn between the
  // rows of its ends — unless both ends are on one line: then it runs beside
  // that one, on a row of its own.
  const S = lines.length
  const owns = Array.from({ length: S }, () => [])
  for (let v = 0; v < N; v++) owns[owner[v]].push(v)
  const isCrossover = lines.map((ln, s) => !owns[s].length
    && owner[ln.nodes[0]] !== owner[ln.nodes[ln.nodes.length - 1]])
  // Which side of the line at node v a track k leaves on, seen in the diagram:
  // +1 above, −1 below, 0 where the terrain does not tell. Read against the
  // line's own track leaving v on the same side, at the same distance from v
  // on both — a turnout's branch parts from the straight track tangentially.
  const pointFrom = (k, v, d) => {
    const ed = edges[k]
    return pointAlong(ed.u === v ? ed.line : [...ed.line].reverse(), d)
  }
  const sideAt = (v, k, s) => {
    const right = leavesRight(k, v)
    const own = lines[s].edges.filter(j => j !== k && (edges[j].u === v || edges[j].v === v))
    const same = own.find(j => leavesRight(j, v) === right)
    const other = own.find(j => leavesRight(j, v) !== right)
    const j = same ?? other
    if (j === undefined) return 0
    const d = Math.min(SIDE_DISTANCE, edges[k].len, edges[j].len)
    if (!(d > 0)) return 0
    const p = xy[v]
    let dir = minus(pointFrom(j, v, d), p)
    if (same === undefined) dir = [-dir[0], -dir[1]]
    const c = cross(dir, minus(pointFrom(k, v, d), p))
    return Math.sign(c) * (right ? 1 : -1)
  }

  // What the terrain says of two lines: rel[a].get(b) > 0 when a lies above b.
  const rel = Array.from({ length: S }, () => new Map())
  const tell = (a, b, up) => {
    if (a === b || !up) return
    rel[a].set(b, (rel[a].get(b) ?? 0) + up)
    rel[b].set(a, (rel[b].get(a) ?? 0) - up)
  }
  for (let v = 0; v < N; v++) {
    const s = owner[v]
    for (const at of ends[v]) {
      const t = lineOfEdge[at.k]
      if (t < 0 || t === s) continue
      const up = sideAt(v, at.k, s)
      if (!isCrossover[t]) { tell(t, s, up); continue }
      // A crossover: the line at its other end lies the way it leaves this one.
      const ln = lines[t]
      const w = ln.nodes[0] === v ? ln.nodes[ln.nodes.length - 1] : ln.nodes[0]
      tell(owner[w], s, up)
    }
  }
  const relation = (a, b) => rel[a].get(b) ?? 0

  /** How far apart in the terrain: the middle distance of a's nodes from b's tracks. */
  const distances = new Map()
  const distance = (a, b) => {
    const key = a * S + b
    if (!distances.has(key)) distances.set(key, measure(a, b))
    return distances.get(key)
  }
  const measure = (a, b) => {
    const pts = (owns[a].length ? owns[a] : lines[a].nodes).map(v => xy[v])
    const tracks = lines[b].edges.map(k => edges[k].line)
    if (!tracks.length) tracks.push(owns[b].map(v => xy[v]))
    const ds = pts.map(p => Math.min(...tracks.map(l => distanceToLine(p, l)))).sort((p, q) => p - q)
    return ds[Math.floor(ds.length / 2)]
  }

  // Rows, bottom to top, for columns x; the row of every line, the main one 0. The weightiest line first; then, again and again,
  // the weightiest line next to one laid already, on the side the terrain
  // says, on the first row out from there that is free along its stretch —
  // or on a new row before one whose line lies further out than it.
  const placeRows = (x) => {
    // The stretch of its row a line takes: its own nodes, and a column short of
    // the nodes of other lines it starts or ends at.
    const span = lines.map((ln, s) => {
      const first = ln.nodes[0], last = ln.nodes[ln.nodes.length - 1]
      let lo = owner[first] === s ? x[first] : x[first] + 1
      let hi = owner[last] === s ? x[last] : x[last] - 1
      for (const v of owns[s]) { lo = Math.min(lo, x[v]); hi = Math.max(hi, x[v]) }
      return [lo, hi]
    })
    const rows = []
    const rowOf = new Array(S).fill(null)
    const overlaps = (a, b) => span[a][0] <= span[b][1] && span[b][0] <= span[a][1]
    const laneLines = [...Array(S).keys()].filter(s => !isCrossover[s])
      .sort((a, b) => lines[b].weight - lines[a].weight || a - b)
    const put = (s, row) => { row.members.push(s); rowOf[s] = row }
    const waiting = new Set()
    const placeNear = (s) => {
      let anchor = -1, best = 0
      for (const [b, r] of rel[s]) {
        if (!rowOf[b]) continue
        const score = Math.abs(r) * 1e9 + lines[b].weight
        if (anchor < 0 || score > best) { anchor = b; best = score }
      }
      if (anchor < 0) {
        // Tied to nothing laid by what the terrain says: above the rest.
        const row = { members: [] }
        rows.push(row)
        put(s, row)
        return
      }
      const dir = Math.sign(relation(s, anchor)) || 1
      let j = rows.indexOf(rowOf[anchor]) + dir
      for (;;) {
        if (j < 0 || j >= rows.length) {
          const row = { members: [] }
          if (j < 0) rows.unshift(row); else rows.push(row)
          put(s, row)
          return
        }
        const inWay = rows[j].members.filter(q => overlaps(q, s))
        if (!inWay.length) { put(s, rows[j]); return }
        const q = inWay.find(q => relation(s, q)) ?? inWay[0]
        const r = relation(s, q)
        const before = r ? Math.sign(r) === -dir : distance(s, anchor) < distance(q, anchor)
        if (before) {
          const row = { members: [] }
          rows.splice(dir > 0 ? j : j + 1, 0, row)
          put(s, row)
          return
        }
        j += dir
      }
    }
    // A line tied to none laid so far starts afresh, above the rest.
    for (const first of laneLines) {
      if (rowOf[first]) continue
      placeNear(first)
      for (const b of rel[first].keys()) if (!rowOf[b] && !isCrossover[b]) waiting.add(b)
      while (waiting.size) {
        let s = -1
        for (const c of waiting) if (s < 0 || lines[c].weight > lines[s].weight || (lines[c].weight === lines[s].weight && c < s)) s = c
        waiting.delete(s)
        placeNear(s)
        for (const b of rel[s].keys()) if (!rowOf[b] && !isCrossover[b]) waiting.add(b)
      }
    }
    const mainRow = rows.indexOf(rowOf[laneLines[0]])
    const rowIndex = new Map(rows.map((row, i) => [row, i - mainRow]))
    return rowOf.map(row => (row ? rowIndex.get(row) : 0))

  }

  // A track that climbs rows takes as many columns as it climbs, the name
  // still between; where any does, the columns and rows once more with that.
  let x = columns(() => MIN_SPAN)
  let yOf = placeRows(x)
  const climb = (k) => {
    const s = lineOfEdge[k]
    const ya = yOf[owner[leftOf[k]]], yb = yOf[owner[rightOf[k]]]
    if (isCrossover[s]) return Math.abs(ya - yb)
    const d = Math.abs(ya - yOf[s]) + Math.abs(yb - yOf[s])
    return d ? d + 1 : 0
  }
  const spans = edges.map((_, k) => (bent[k] ? MIN_SPAN : Math.min(MAX_SPAN, Math.max(MIN_SPAN, climb(k)))))
  if (spans.some(sp => sp > MIN_SPAN)) {
    x = columns(k => spans[k])
    yOf = placeRows(x)
  }
  const yOfLine = (s) => yOf[s]

  const at = (v) => ({ x: x[v], y: yOfLine(owner[v]) })
  const pos = new Map(nodes.map((n, v) => [n.id, at(v)]))
  const routes = new Map()
  const labels = new Map()
  edges.forEach((ed, k) => {
    const id = ed.e.trackId
    const a = leftOf[k], b = rightOf[k]
    const pa = at(a), pb = at(b)
    if (bent[k]) {
      // Back the way it came: out to one side of both ends and round.
      const right = bentSide(k, endAt(k, a)) === 1
      const turn = right ? Math.max(pa.x, pb.x) + 1.5 : Math.min(pa.x, pb.x) - 1.5
      const mid = { x: turn, y: pa.y === pb.y ? pa.y + 0.5 : (pa.y + pb.y) / 2 }
      routes.set(id, [pa, mid, pb])
      labels.set(id, mid)
      return
    }
    const s = lineOfEdge[k]
    if (isCrossover[s]) {
      if (pa.y === pb.y) {
        // Its two lines happen to share a row: round the stretch between them.
        routes.set(id, [pa, { x: pa.x + 1, y: pa.y + 0.5 }, { x: pb.x - 1, y: pb.y + 0.5 }, pb])
        labels.set(id, { x: (pa.x + pb.x) / 2, y: pa.y + 0.5 })
      } else {
        routes.set(id, [pa, pb])
        labels.set(id, { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 })
      }
      return
    }
    // Along the line's row, in from a node of another line diagonally — over
    // as many columns as rows where the track is long enough, one at least.
    const y = yOfLine(s)
    const dl = Math.abs(pa.y - y), dr = Math.abs(pb.y - y)
    const room = pb.x - pa.x
    const wl = dl && Math.min(dl, Math.max(1, Math.floor(room * dl / (dl + dr))))
    const wr = dr && Math.min(dr, Math.max(1, room - wl))
    const x1 = pa.x + wl
    const x2 = pb.x - wr
    const route = [pa, { x: x1, y }, { x: x2, y }, pb]
      .filter((p, j, all) => !j || p.x !== all[j - 1].x || p.y !== all[j - 1].y)
    routes.set(id, route)
    labels.set(id, { x: (x1 + x2) / 2, y })
  })
  return { pos, routes, labels }
}
