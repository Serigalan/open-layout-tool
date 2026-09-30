/**
 * Planarity test and planar embedding — the left-right algorithm (de
 * Fraysseix–Rosenstiehl, as set out by Brandes, "The Left-Right Planarity
 * Test", 2009), after the iterative form networkx gives it.
 *
 * The topology diagram needs it to draw a network without a single crossing
 * (topologyGraph.layoutClusterEven): an embedding says, around every node, in
 * which cyclic order its lines leave it so that none crosses another — and a
 * graph that has none cannot be drawn without crossings at all.
 *
 * Nodes are 0 … n−1. The embedding is a rotation system: for every node, each
 * neighbour with the neighbours next to it clockwise (`cw`) and
 * counterclockwise (`ccw`).
 */

class Interval {
  constructor(low = null, high = null) { this.low = low; this.high = high }
  empty() { return this.low === null && this.high === null }
  copy() { return new Interval(this.low, this.high) }
}

class ConflictPair {
  constructor(left = new Interval(), right = new Interval()) { this.left = left; this.right = right }
  swap() { [this.left, this.right] = [this.right, this.left] }
}

const top = (stack) => (stack.length ? stack[stack.length - 1] : null)

/** An embedding under construction: rotation per node, and its leftmost neighbour. */
export class Embedding {
  constructor(n) {
    this.rot = Array.from({ length: n }, () => new Map())
    this.leftmost = new Array(n).fill(null)
  }

  get size() { return this.rot.length }

  /** A node more, connected to nothing yet. Returns its number. */
  addNode() {
    this.rot.push(new Map())
    this.leftmost.push(null)
    return this.rot.length - 1
  }

  /**
   * The half-edge v → w, placed clockwise next to `ccw` or counterclockwise
   * next to `cw` in the rotation of v (neither for v's first one).
   */
  addHalfEdge(v, w, { cw = null, ccw = null } = {}) {
    const s = this.rot[v]
    if (!s.size) {
      s.set(w, { cw: w, ccw: w })
      this.leftmost[v] = w
      return
    }
    if (cw !== null) {
      const refCcw = s.get(cw).ccw
      s.set(w, { cw, ccw: refCcw })
      s.get(refCcw).cw = w
      s.get(cw).ccw = w
      if (cw === this.leftmost[v]) this.leftmost[v] = w
    } else {
      const refCw = s.get(ccw).cw
      s.set(w, { cw: refCw, ccw })
      s.get(refCw).ccw = w
      s.get(ccw).cw = w
    }
  }

  addHalfEdgeFirst(v, w) {
    if (this.rot[v].size) this.addHalfEdge(v, w, { cw: this.leftmost[v] })
    else this.addHalfEdge(v, w)
  }

  /** The half-edge after v → w along the face to its right. */
  nextFaceHalfEdge(v, w) {
    return [w, this.rot[w].get(v).ccw]
  }
}

/**
 * A planar embedding of the simple graph on nodes 0 … n−1 with `edges`
 * ([a, b] pairs; loops and repeated edges are ignored), or null when there is
 * none.
 */
export function planarEmbedding(n, edges) {
  const adjs = Array.from({ length: n }, () => [])
  const seen = new Set()
  let m = 0
  for (const [a, b] of edges) {
    if (a === b) continue
    const k = a < b ? a * n + b : b * n + a
    if (seen.has(k)) continue
    seen.add(k)
    adjs[a].push(b)
    adjs[b].push(a)
    m += 1
  }
  if (n > 2 && m > 3 * n - 6) return null

  // Edges as numbers: v → w is v·n + w.
  const key = (v, w) => v * n + w
  const head = (e) => e % n
  const tail = (e) => Math.floor(e / n)

  const height = new Array(n).fill(null)
  const lowpt = new Map()
  const lowpt2 = new Map()
  const nesting = new Map()
  const parentEdge = new Array(n).fill(null)
  const out = Array.from({ length: n }, () => [])   // the DFS orientation
  const oriented = new Set()
  const roots = []

  // Orientation by DFS, lowpoints and nesting order.
  const orient = (root) => {
    const stack = [root]
    const ind = new Array(n).fill(0)
    const skip = new Set()
    while (stack.length) {
      const v = stack.pop()
      const e = parentEdge[v]
      let i = ind[v]
      for (; i < adjs[v].length; i++) {
        const w = adjs[v][i]
        const vw = key(v, w)
        if (!skip.has(vw)) {
          if (oriented.has(vw) || oriented.has(key(w, v))) continue
          oriented.add(vw)
          out[v].push(w)
          lowpt.set(vw, height[v])
          lowpt2.set(vw, height[v])
          if (height[w] === null) {
            parentEdge[w] = vw
            height[w] = height[v] + 1
            stack.push(v, w)
            skip.add(vw)
            break
          }
          lowpt.set(vw, height[w])
        }
        nesting.set(vw, 2 * lowpt.get(vw) + (lowpt2.get(vw) < height[v] ? 1 : 0))
        if (e !== null) {
          const lv = lowpt.get(vw), le = lowpt.get(e)
          if (lv < le) {
            lowpt2.set(e, Math.min(le, lowpt2.get(vw)))
            lowpt.set(e, lv)
          } else if (lv > le) {
            lowpt2.set(e, Math.min(lowpt2.get(e), lv))
          } else {
            lowpt2.set(e, Math.min(lowpt2.get(e), lowpt2.get(vw)))
          }
        }
      }
      ind[v] = i
    }
  }
  for (let v = 0; v < n; v++) {
    if (height[v] === null) {
      height[v] = 0
      roots.push(v)
      orient(v)
    }
  }

  const ordered = out.map((ws, v) => [...ws].sort((a, b) => nesting.get(key(v, a)) - nesting.get(key(v, b))))

  // Testing: the LR partition.
  const ref = new Map()
  const side = new Map()
  const sideOf = (e) => side.get(e) ?? 1
  const S = []
  const stackBottom = new Map()
  const lowptEdge = new Map()
  const conflicting = (I, b) => !I.empty() && lowpt.get(I.high) > lowpt.get(b)
  const lowest = (P) => {
    if (P.left.empty()) return lowpt.get(P.right.low)
    if (P.right.empty()) return lowpt.get(P.left.low)
    return Math.min(lowpt.get(P.left.low), lowpt.get(P.right.low))
  }

  const addConstraints = (ei, e) => {
    const P = new ConflictPair()
    for (;;) {
      const Q = S.pop()
      if (!Q.left.empty()) Q.swap()
      if (!Q.left.empty()) return false
      if (lowpt.get(Q.right.low) > lowpt.get(e)) {
        if (P.right.empty()) P.right = Q.right.copy()
        else ref.set(P.right.low, Q.right.high)
        P.right.low = Q.right.low
      } else {
        ref.set(Q.right.low, lowptEdge.get(e))
      }
      if (top(S) === stackBottom.get(ei)) break
    }
    while (top(S) && (conflicting(top(S).left, ei) || conflicting(top(S).right, ei))) {
      const Q = S.pop()
      if (conflicting(Q.right, ei)) Q.swap()
      if (conflicting(Q.right, ei)) return false
      ref.set(P.right.low, Q.right.high)
      if (Q.right.low !== null) P.right.low = Q.right.low
      if (P.left.empty()) P.left = Q.left.copy()
      else ref.set(P.left.low, Q.left.high)
      P.left.low = Q.left.low
    }
    if (!(P.left.empty() && P.right.empty())) S.push(P)
    return true
  }

  const removeBackEdges = (e) => {
    const u = tail(e)
    while (S.length && lowest(top(S)) === height[u]) {
      const P = S.pop()
      if (P.left.low !== null) side.set(P.left.low, -1)
    }
    if (S.length) {
      const P = S.pop()
      while (P.left.high !== null && head(P.left.high) === u) P.left.high = ref.get(P.left.high) ?? null
      if (P.left.high === null && P.left.low !== null) {
        ref.set(P.left.low, P.right.low)
        side.set(P.left.low, -1)
        P.left.low = null
      }
      while (P.right.high !== null && head(P.right.high) === u) P.right.high = ref.get(P.right.high) ?? null
      if (P.right.high === null && P.right.low !== null) {
        ref.set(P.right.low, P.left.low)
        side.set(P.right.low, -1)
        P.right.low = null
      }
      S.push(P)
    }
    if (lowpt.get(e) < height[u]) {
      const hl = top(S).left.high, hr = top(S).right.high
      ref.set(e, hl !== null && (hr === null || lowpt.get(hl) > lowpt.get(hr)) ? hl : hr)
    }
  }

  const test = (root) => {
    const stack = [root]
    const ind = new Array(n).fill(0)
    const skip = new Set()
    while (stack.length) {
      const v = stack.pop()
      const e = parentEdge[v]
      let descended = false
      let i = ind[v]
      for (; i < ordered[v].length; i++) {
        const w = ordered[v][i]
        const ei = key(v, w)
        if (!skip.has(ei)) {
          stackBottom.set(ei, top(S))
          if (ei === parentEdge[w]) {
            stack.push(v, w)
            skip.add(ei)
            descended = true
            break
          }
          lowptEdge.set(ei, ei)
          S.push(new ConflictPair(new Interval(), new Interval(ei, ei)))
        }
        if (lowpt.get(ei) < height[v]) {
          if (w === ordered[v][0]) lowptEdge.set(e, lowptEdge.get(ei))
          else if (!addConstraints(ei, e)) return false
        }
      }
      ind[v] = i
      if (!descended && e !== null) removeBackEdges(e)
    }
    return true
  }
  for (const root of roots) if (!test(root)) return null

  // The side of every edge, resolved along its reference chain.
  const sign = (e0) => {
    const stack = [e0]
    const oldRef = new Map()
    while (stack.length) {
      const e = stack.pop()
      const r = ref.get(e) ?? null
      if (r !== null) {
        stack.push(e, r)
        oldRef.set(e, r)
        ref.set(e, null)
      } else {
        const o = oldRef.get(e) ?? null
        side.set(e, sideOf(e) * (o === null ? 1 : sideOf(o)))
      }
    }
    return sideOf(e0)
  }
  for (let v = 0; v < n; v++) {
    for (const w of out[v]) {
      const e = key(v, w)
      nesting.set(e, sign(e) * nesting.get(e))
    }
  }

  const embedding = new Embedding(n)
  for (let v = 0; v < n; v++) {
    const ws = [...out[v]].sort((a, b) => nesting.get(key(v, a)) - nesting.get(key(v, b)))
    ordered[v] = ws
    let previous = null
    for (const w of ws) {
      embedding.addHalfEdge(v, w, previous === null ? {} : { ccw: previous })
      previous = w
    }
  }

  // The complete embedding.
  const leftRef = new Array(n).fill(null)
  const rightRef = new Array(n).fill(null)
  for (const root of roots) {
    const stack = [root]
    const ind = new Array(n).fill(0)
    while (stack.length) {
      const v = stack.pop()
      while (ind[v] < ordered[v].length) {
        const w = ordered[v][ind[v]]
        ind[v] += 1
        const ei = key(v, w)
        if (ei === parentEdge[w]) {
          embedding.addHalfEdgeFirst(w, v)
          leftRef[v] = w
          rightRef[v] = w
          stack.push(v, w)
          break
        }
        if (sideOf(ei) === 1) {
          embedding.addHalfEdge(w, v, { ccw: rightRef[w] })
        } else {
          embedding.addHalfEdge(w, v, { cw: leftRef[w] })
          leftRef[w] = v
        }
      }
    }
  }
  return embedding
}
