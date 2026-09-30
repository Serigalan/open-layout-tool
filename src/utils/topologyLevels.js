import { planarEmbedding } from './planarity'

/**
 * Columns for the topology diagram without a single crossing
 * (topologyGraph.layoutClusterEven), for every network that can be drawn so.
 *
 * The drawing is layered: every node in a column, every track running from
 * column to column through a point in each. Which column and which place in
 * it come from a planar embedding of the network, by way of a visibility
 * representation (Tamassia–Tollis):
 *
 *   1. Every track is cut in two by the point that carries its name, so the
 *      graph is simple; a planar embedding of it is found (planarity.js).
 *   2. The embedding is made two-connected by extra points in its faces, and a
 *      closing edge s–t is laid in the outer face, s the node first along the
 *      line and t the last one on that face.
 *   3. An st-numbering orders the points from s to t; every track runs forward
 *      in it. The faces between the tracks, ordered from left to right along
 *      the dual graph, give every track a place across — and in any column,
 *      the points ordered by those places cross nothing.
 *
 * That holds for columns counted along every edge, the extra ones included,
 * and still when every point is then moved as far left as the points above
 * and below it allow (the compaction). The columns along the tracks alone,
 * fewer yet, are tried first and kept when they cross nothing either.
 *
 * Nodes are 0 … n−1; `chains` are the tracks { trackId, a, b } between them.
 * Returns { pts, columns } — pts[0 … n−1] the nodes, then one per track its
 * name point, then the points the tracks pass through — with every chain
 * given its `points` from left to right and its `label`; or null for a
 * network that cannot be drawn without crossings.
 */
export function planarLevels(n, chains, along) {
  const K = chains.length
  const H = n + K
  const hEdges = []
  chains.forEach((c, k) => { hEdges.push([c.a, n + k], [n + k, c.b]) })
  const emb = planarEmbedding(H, hEdges)
  if (!emb) return null
  if (H < 3) return null

  const isMid = (v) => v >= n && v < H
  const hk = (v, w) => v * 1048576 + w   // far more points than a network has

  // The closing edge s–t, laid in the face around s that reaches furthest
  // along the line.
  let s = 0
  for (let v = 1; v < n; v++) if (along[v] < along[s]) s = v
  let close = null
  for (const w of [...emb.rot[s].keys()]) {
    for (const [a, b] of faceWalk(emb, s, w)) {
      if (b < n && b !== s && (!close || along[b] > along[close.t])) close = { t: b, sOut: w, tIn: a }
    }
  }
  if (!close) return null
  const t = close.t
  emb.addHalfEdge(s, t, { ccw: close.sOut })
  emb.addHalfEdge(t, s, { cw: close.tIn })

  biconnect(emb, isMid, hk)

  const N = emb.size
  const adj = emb.rot.map(r => [...r.keys()])
  const st = stNumbering(N, adj, s, t)
  if (!st) return null

  // Faces, and the dual: every edge but s–t leads from the face on its left to
  // the one on its right; the longest way there is a face's place across.
  const face = new Map()
  let F = 0
  for (let v = 0; v < N; v++) {
    for (const w of adj[v]) {
      if (face.has(hk(v, w))) continue
      for (const [a, b] of faceWalk(emb, v, w)) face.set(hk(a, b), F)
      F += 1
    }
  }
  const dualOut = Array.from({ length: F }, () => [])
  const dualIn = new Int32Array(F)
  for (let v = 0; v < N; v++) {
    for (const w of adj[v]) {
      if (st[v] >= st[w] || (v === s && w === t)) continue
      const left = face.get(hk(w, v)), right = face.get(hk(v, w))
      dualOut[left].push(right)
      dualIn[right] += 1
    }
  }
  const X = new Int32Array(F)
  const queue = []
  for (let f = 0; f < F; f++) if (!dualIn[f]) queue.push(f)
  for (let q = 0; q < queue.length; q++) {
    const f = queue[q]
    for (const g of dualOut[f]) {
      X[g] = Math.max(X[g], X[f] + 1)
      if (--dualIn[g] === 0) queue.push(g)
    }
  }
  if (queue.length !== F) return null

  /** Place across of the edge u–v: its left face's. */
  const across = (u, v) => (st[u] < st[v] ? X[face.get(hk(v, u))] : X[face.get(hk(u, v))])
  const key = new Array(H).fill(Infinity)
  const hNbrs = Array.from({ length: H }, () => [])
  for (const [a, b] of hEdges) {
    const x = across(a, b)
    key[a] = Math.min(key[a], x)
    key[b] = Math.min(key[b], x)
    hNbrs[a].push(b)
    hNbrs[b].push(a)
  }
  const isTrack = new Set(hEdges.flatMap(([a, b]) => [hk(a, b), hk(b, a)]))

  const byST = [...Array(N).keys()].sort((a, b) => st[a] - st[b])
  const levelsFor = (mode) => {
    const lev = new Int32Array(N)
    for (const v of byST) {
      for (const w of adj[v]) {
        if (st[w] > st[v]) continue
        const track = isTrack.has(hk(w, v))
        if (!track && mode === 'tracks') continue
        lev[v] = Math.max(lev[v], lev[w] + (track || mode === 'all' ? 1 : 0))
      }
    }
    if (mode === 'tracks') {
      // A node no track reaches from the left (the far end of a stub) sits
      // next to where it leads rather than at the very start.
      for (let k = byST.length - 1; k >= 0; k--) {
        const v = byST[k]
        if (v >= H) continue
        const outs = hNbrs[v].filter(w => st[w] > st[v])
        if (outs.length === hNbrs[v].length && outs.length) lev[v] = Math.max(lev[v], Math.min(...outs.map(w => lev[w])) - 1)
      }
    }
    let first = Infinity
    for (let v = 0; v < H; v++) first = Math.min(first, lev[v])
    for (let v = 0; v < H; v++) lev[v] -= first
    return lev
  }

  const build = (lev) => {
    const pts = []
    for (let v = 0; v < H; v++) pts.push({ layer: lev[v], key: key[v], nbrs: [] })
    const between = (u, v) => {
      const x = across(u, v)
      const step = lev[v] > lev[u] ? 1 : -1
      const seq = []
      for (let l = lev[u] + step; l !== lev[v]; l += step) {
        pts.push({ layer: l, key: x, nbrs: [] })
        seq.push(pts.length - 1)
      }
      return seq
    }
    chains.forEach((c, k) => {
      const mid = n + k
      c.points = [c.a, ...between(c.a, mid), mid, ...between(mid, c.b), c.b]
      if (lev[c.a] > lev[c.b]) c.points.reverse()
      c.label = mid
      for (let j = 1; j < c.points.length; j++) {
        pts[c.points[j - 1]].nbrs.push(c.points[j])
        pts[c.points[j]].nbrs.push(c.points[j - 1])
      }
    })
    const columns = []
    pts.forEach((p, i) => { (columns[p.layer] ??= []).push(i) })
    for (const col of columns) col?.sort((a, b) => pts[a].key - pts[b].key || a - b)
    return { pts, columns }
  }

  // The columns along every edge, drawn closer: what matters is only which
  // points sit across the same place, one above the other — each of those
  // pairs keeps its order and one column between them, and every point moves
  // as far left as that lets it.
  const compacted = () => {
    const all = levelsFor('all')
    const lo = new Array(H).fill(Infinity), hi = new Array(H).fill(-Infinity)
    for (const [a, b] of hEdges) {
      const x = across(a, b)
      for (const v of [a, b]) { lo[v] = Math.min(lo[v], x); hi[v] = Math.max(hi[v], x) }
    }
    const at = new Map()
    for (let v = 0; v < H; v++) {
      for (let x = lo[v]; x <= hi[v]; x++) {
        if (!at.has(x)) at.set(x, [])
        at.get(x).push(v)
      }
    }
    const after = Array.from({ length: H }, () => [])
    for (const list of at.values()) {
      list.sort((a, b) => all[a] - all[b])
      for (let k = 1; k < list.length; k++) after[list[k - 1]].push(list[k])
    }
    const lev = new Int32Array(N)
    const order = [...Array(H).keys()].sort((a, b) => all[a] - all[b])
    for (const v of order) for (const w of after[v]) lev[w] = Math.max(lev[w], lev[v] + 1)
    return lev
  }

  let fallback = null
  for (const mode of ['tracks', 'compact', 'free', 'all']) {
    const built = build(mode === 'compact' ? compacted() : levelsFor(mode))
    const crossings = countCrossings(built.pts, built.columns) && transposeColumns(built.pts, built.columns)
    if (!crossings) return Object.assign(compact(built, H, chains), { mode })
    if (!fallback || crossings < fallback.crossings) fallback = { mode, crossings }
  }
  // Cannot happen for a valid embedding; the least crossed one all the same.
  const kept = build(fallback.mode === 'compact' ? compacted() : levelsFor(fallback.mode))
  transposeColumns(kept.pts, kept.columns)
  return kept
}

/**
 * Columns through which lines only pass, taken out: a column holding no node
 * and no name point, only points of tracks on their way, is dropped and the
 * columns after it close up. That crosses nothing new — two tracks through
 * such a column keep their order on either side of it, since neither crosses
 * the other there. Points below `fixed` are nodes and name points; the
 * chains lose the dropped points from theirs.
 */
function compact(laid, fixed, chains) {
  const { pts, columns } = laid
  const keep = columns.map(col => (col ?? []).some(i => i < fixed))
  const shift = []
  let dropped = 0
  columns.forEach((_, l) => { if (!keep[l]) dropped += 1; shift[l] = dropped })
  if (!dropped) return laid
  // A dropped point's two neighbours become each other's.
  for (let l = 0; l < columns.length; l++) {
    if (keep[l]) continue
    for (const i of columns[l] ?? []) {
      const [u, v] = pts[i].nbrs
      pts[u].nbrs = pts[u].nbrs.map(j => (j === i ? v : j))
      pts[v].nbrs = pts[v].nbrs.map(j => (j === i ? u : j))
      pts[i].dropped = true
    }
  }
  const out = []
  columns.forEach((col, l) => { if (keep[l]) out.push(col) })
  for (const p of pts) if (!p.dropped) p.layer -= shift[p.layer]
  for (const c of chains) c.points = c.points.filter(i => !pts[i].dropped)
  return { pts, columns: out }
}

/** The half-edges of the face right of v → w, starting there. */
function faceWalk(emb, v, w) {
  const walk = []
  let a = v, b = w
  do {
    walk.push([a, b]);
    [a, b] = emb.nextFaceHalfEdge(a, b)
  } while (a !== v || b !== w)
  return walk
}

/**
 * Make the embedding two-connected: wherever a face passes a point twice, a
 * new point in that face joins the points before and after it. Never to a
 * track's name point where it can be helped — that one keeps its two track
 * edges only, so the track runs straight through it in the st-order.
 */
function biconnect(emb, isMid, hk) {
  const counted = new Set()
  const walkFace = (s0, t0) => {
    const visited = new Set([s0])
    const walk = [s0]
    let a = s0, b = t0
    counted.add(hk(a, b))
    for (let guard = 0; guard < 1e7; guard++) {
      const c = emb.rot[b].get(a).ccw
      if (b === s0 && c === t0) return
      if (!visited.has(b)) {
        visited.add(b)
        walk.push(b)
        a = b; b = c
        counted.add(hk(a, b))
        continue
      }
      // b again: the face leaves it through c after coming in from a.
      let A = a, oa = b, C = c, ic = b
      if (isMid(a) && walk.length >= 2) { A = walk[walk.length - 2]; oa = a }
      if (isMid(c)) { ic = c; C = emb.rot[c].get(b).ccw }
      if (A === C) { A = a; oa = b; C = c; ic = b }
      if (A === C) {
        visited.add(b)
        a = b; b = c
        counted.add(hk(a, b))
        continue
      }
      const x = emb.addNode()
      emb.addHalfEdge(A, x, { ccw: oa })
      emb.addHalfEdge(C, x, { cw: ic })
      emb.addHalfEdge(x, A)
      emb.addHalfEdge(x, C, { cw: A })
      // What lies between A and C now bounds a face of its own.
      counted.add(hk(b, c))
      if (ic !== b) counted.add(hk(c, C))
      counted.add(hk(C, x))
      counted.add(hk(x, A))
      if (A !== a) { walk.pop(); visited.delete(a) }
      counted.add(hk(A, x))
      walk.push(x)
      visited.add(x)
      a = x; b = C
      counted.add(hk(a, b))
    }
  }
  const size = emb.size
  for (let v = 0; v < size; v++) {
    if (isMid(v)) continue
    for (const w of [...emb.rot[v].keys()]) if (!counted.has(hk(v, w))) walkFace(v, w)
  }
}

/**
 * An st-numbering of a two-connected graph that has the edge s–t: s first,
 * t last, every other point with a neighbour before and one after it (Tarjan,
 * "Two streamlined depth-first search algorithms", 1986). Null if the graph
 * is not what it has to be.
 */
export function stNumbering(N, adj, s, t) {
  const pre = new Int32Array(N).fill(-1)
  const parent = new Int32Array(N).fill(-1)
  const low = new Int32Array(N)
  const order = []
  const visit = (v, p) => { pre[v] = order.length; order.push(v); parent[v] = p; low[v] = v }
  visit(s, -1)
  const stack = [{ v: s, list: [t, ...adj[s].filter(w => w !== t)], i: 0 }]
  while (stack.length) {
    const f = stack[stack.length - 1]
    if (f.i < f.list.length) {
      const w = f.list[f.i++]
      if (pre[w] < 0) {
        visit(w, f.v)
        stack.push({ v: w, list: adj[w], i: 0 })
      } else if (w !== parent[f.v] && pre[w] < pre[low[f.v]]) {
        low[f.v] = w
      }
    } else {
      stack.pop()
      const p = parent[f.v]
      if (p >= 0 && pre[low[f.v]] < pre[low[p]]) low[p] = low[f.v]
    }
  }
  if (order.length !== N) return null

  const next = new Int32Array(N).fill(-1)
  const prev = new Int32Array(N).fill(-1)
  next[s] = t
  prev[t] = s
  const sign = new Int8Array(N)
  sign[s] = -1
  for (const v of order) {
    if (v === s || v === t) continue
    const p = parent[v]
    if (sign[low[v]] === -1) {
      const q = prev[p]
      prev[v] = q; next[v] = p; prev[p] = v
      if (q >= 0) next[q] = v
      sign[p] = 1
    } else {
      const q = next[p]
      next[v] = q; prev[v] = p; next[p] = v
      if (q >= 0) prev[q] = v
      sign[p] = -1
    }
  }
  let head = s
  while (prev[head] >= 0) head = prev[head]
  const st = new Int32Array(N)
  let k = 0
  for (let v = head; v >= 0; v = next[v]) st[v] = k++
  if (k !== N || st[s] !== 0 || st[t] !== N - 1) return null
  for (let v = 0; v < N; v++) {
    if (v === s || v === t) continue
    if (!adj[v].some(w => st[w] < st[v]) || !adj[v].some(w => st[w] > st[v])) return null
  }
  return st
}

/** How many pairs of lines cross between neighbouring columns, in their present order. */
export function countCrossings(pts, columns) {
  const place = new Array(pts.length)
  for (const col of columns) col?.forEach((i, k) => { place[i] = k })
  let total = 0
  for (let l = 0; l + 1 < columns.length; l++) {
    const segs = []
    for (const i of columns[l] ?? []) {
      for (const j of pts[i].nbrs) if (pts[j].layer === l + 1) segs.push([place[i], place[j]])
    }
    segs.sort((p, q) => p[0] - q[0] || p[1] - q[1])
    total += inversions(segs.map(sg => sg[1]))
  }
  return total
}

/** Pairs i < j with values[i] > values[j], by merge sort. */
function inversions(values) {
  let count = 0
  const sort = (a) => {
    if (a.length < 2) return a
    const m = a.length >> 1
    const l = sort(a.slice(0, m)), r = sort(a.slice(m))
    const out = []
    let i = 0, j = 0
    while (i < l.length && j < r.length) {
      if (r[j] < l[i]) { out.push(r[j++]); count += l.length - i } else out.push(l[i++])
    }
    return out.concat(l.slice(i), r.slice(j))
  }
  sort(values)
  return count
}

/**
 * Neighbours in a column swapped wherever that saves a crossing, until no
 * swap does. Returns the crossings left.
 */
export function transposeColumns(pts, columns, maxPasses = 20) {
  const place = new Array(pts.length)
  const renumber = (col) => col.forEach((i, k) => { place[i] = k })
  columns.forEach(col => col && renumber(col))
  const crossingsOf = (u, v) => {   // u above v: how many of their lines cross
    let c = 0
    for (const pu of pts[u].nbrs) {
      for (const pv of pts[v].nbrs) {
        if (pts[pu].layer === pts[pv].layer && place[pu] > place[pv]) c += 1
      }
    }
    return c
  }
  for (let pass = 0, better = true; better && pass < maxPasses; pass++) {
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
  return countCrossings(pts, columns)
}

/**
 * A planar part of a network that has none as a whole: tracks taken in turn,
 * each kept while the tracks kept so far still embed — tried in batches that
 * are halved on failure, so the few that cannot be kept cost a planarity test
 * each rather than every track one. Returns { keep, rest } of `chains`.
 */
export function planarSubset(n, chains) {
  const keep = []
  const rest = []
  const embeds = (list) => {
    const edges = []
    list.forEach((c, k) => { edges.push([c.a, n + k], [n + k, c.b]) })
    return planarEmbedding(n + list.length, edges) !== null
  }
  const add = (batch) => {
    if (!batch.length) return
    if (embeds([...keep, ...batch])) { keep.push(...batch); return }
    if (batch.length === 1) { rest.push(batch[0]); return }
    const m = batch.length >> 1
    add(batch.slice(0, m))
    add(batch.slice(m))
  }
  add(chains)
  return { keep, rest }
}

/**
 * The tracks a planar part left out, laid into its columns: each through a
 * point in every column between its ends — out one column past both and back
 * where its ends stand too close for a name point between them — on the way
 * through the gaps between the points there that crosses the fewest lines
 * (found column by column, as a shortest path over the gaps). They cross what
 * they must and nothing else they can avoid. Returns the crossings left.
 */
export function insertChains(laid, extra) {
  const { pts, columns } = laid
  for (const c of extra) {
    const la = pts[c.a].layer, lb = pts[c.b].layer
    const levels = []
    if (Math.abs(lb - la) >= 2) {
      const step = lb > la ? 1 : -1
      for (let l = la + step; l !== lb; l += step) levels.push(l)
    } else {
      const turn = Math.max(la, lb) + 1
      for (let l = la + 1; l <= turn; l++) levels.push(l)
      for (let l = turn - 1; l > lb; l--) levels.push(l)
    }
    for (const l of levels) columns[l] ??= []

    const placeIn = (l) => {
      const m = new Map()
      columns[l].forEach((i, k) => m.set(i, k))
      return m
    }
    // Steps: the end a (a point), a gap in each column on the way, the end b.
    const path = [la, ...levels, lb]
    const places = path.map(placeIn)
    const fixedA = places[0].get(c.a), fixedB = places[path.length - 1].get(c.b)
    let cost = [0]                      // per position in the current step
    const back = []
    for (let k = 1; k < path.length; k++) {
      const [l1, l2] = [path[k - 1], path[k]]
      const [p1, p2] = [places[k - 1], places[k]]
      const fromPoint = k === 1, toPoint = k === path.length - 1
      const G1 = fromPoint ? 1 : columns[l1].length + 1
      const G2 = toPoint ? 1 : columns[l2].length + 1
      // Lines between the two columns, by their places; the ones from or to
      // the chain's own end cross nothing of it.
      const segs = []
      for (const i of columns[l1]) {
        for (const j of pts[i].nbrs) {
          if (pts[j].layer !== l2 || !p2.has(j)) continue
          if (fromPoint && i === c.a) continue
          if (toPoint && j === c.b) continue
          segs.push([p1.get(i), p2.get(j)])
        }
      }
      // Gap g lies above the points before place g; an end point splits at its own place.
      const gapOf1 = (g) => (fromPoint ? fixedA : g)
      const gapOf2 = (g) => (toPoint ? fixedB : g)
      // below[x][y]: lines from above place x to above place y, as prefix sums.
      const n1 = columns[l1].length + 1, n2 = columns[l2].length + 1
      const below = Array.from({ length: n1 }, () => new Int32Array(n2))
      for (const [p, q] of segs) below[p + 1][q + 1] += 1
      for (let x = 0; x < n1; x++) {
        for (let y = 0; y < n2; y++) {
          below[x][y] += (x ? below[x - 1][y] : 0) + (y ? below[x][y - 1] : 0) - (x && y ? below[x - 1][y - 1] : 0)
        }
      }
      const C = (g, h) => below[gapOf1(g)][gapOf2(h)]
      const P = Int32Array.from({ length: G1 }, (_, g) => below[gapOf1(g)][n2 - 1])
      const Q = Int32Array.from({ length: G2 }, (_, h) => below[n1 - 1][gapOf2(h)])
      const next = new Array(G2).fill(Infinity)
      const from = new Int32Array(G2)
      for (let g = 0; g < G1; g++) {
        if (cost[g] === Infinity) continue
        for (let h = 0; h < G2; h++) {
          const v = cost[g] + P[g] + Q[h] - 2 * C(g, h)
          if (v < next[h]) { next[h] = v; from[h] = g }
        }
      }
      back.push(from)
      cost = next
    }
    // The gaps chosen, back from b.
    const gaps = new Array(path.length).fill(0)
    for (let k = path.length - 1, g = 0; k >= 1; k--) {
      g = back[k - 1][g]
      gaps[k - 1] = g
    }
    c.points = [c.a]
    const inserted = []
    levels.forEach((l, k) => {
      pts.push({ layer: l, key: 0, nbrs: [] })
      inserted.push({ l, i: pts.length - 1, at: columns[l][gaps[k + 1]] ?? null })
      c.points.push(pts.length - 1)
    })
    // Into the columns before the point that stood after the gap.
    for (const { l, i, at } of inserted) {
      const col = columns[l]
      const k = at === null ? col.length : col.indexOf(at)
      col.splice(k, 0, i)
    }
    c.points.push(c.b)
    c.label = c.points[1 + Math.floor((levels.length - 1) / 2)]
    for (let j = 1; j < c.points.length; j++) {
      pts[c.points[j - 1]].nbrs.push(c.points[j])
      pts[c.points[j]].nbrs.push(c.points[j - 1])
    }
  }
  for (let l = 0; l < columns.length; l++) columns[l] ??= []
  return transposeColumns(pts, columns)
}
