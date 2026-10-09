import { LEVELS } from '../../core/utils/pointCloud/tiles'

/**
 * Which tiles the 3D view draws (AP 13.9). The levels of a server cloud form a
 * tree: a tile of L4 (128 m) holds the 4 × 4 tiles of L3 (32 m) under it, and
 * so on down to L1 (2 m) — every coarser level is a selection of the finer
 * one, so a tile is drawn *instead of* its children, never with them.
 *
 * Starting from the coarsest tiles in view, the tile whose points look
 * coarsest on screen (its voxel's projected size) is replaced by its children
 * first, as long as the point budget allows and the children are loaded; what
 * is not loaded yet is asked for, the most needed first. The original (L0) is
 * not drawn — picking reads it (AP 13.11).
 */

/** A max-heap of [priority, item]. */
class Heap {
  constructor() { this.a = [] }
  get size() { return this.a.length }
  push(e) {
    const a = this.a
    a.push(e)
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (a[p][0] >= a[i][0]) break
      ;[a[p], a[i]] = [a[i], a[p]]
      i = p
    }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop()
    if (a.length) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1, r = l + 1
        let m = i
        if (l < a.length && a[l][0] > a[m][0]) m = l
        if (r < a.length && a[r][0] > a[m][0]) m = r
        if (m === i) break
        ;[a[m], a[i]] = [a[i], a[m]]
        i = m
      }
    }
    return top
  }
}

/** The finest level drawn. */
const FINEST_DRAWN = 1
/** Children a tile has along each axis. */
const FANOUT = 4

/**
 * The tree of one cloud: `levels[l]` is the index of level l (1…4). Returns
 * `{ roots, nodes }`, each node `{ id, cloud, level, tx, ty, points, segs,
 * box, voxel, children }` — `box` in the cloud's plane ([minE, minN, minZ,
 * maxE, maxN, maxZ], z from the cloud's bounds).
 */
export function buildTree(cloudKey, levels, nextId = { value: 1 }) {
  const nodes = []
  const byLevel = new Map()
  const coarsest = Math.max(...Object.keys(levels).map(Number))
  for (let l = coarsest; l >= FINEST_DRAWN; l--) {
    const index = levels[l]
    if (!index) continue
    const size = index.tileSize
    const { minZ, maxZ } = index.bounds
    const map = new Map()
    for (const [tx, ty, segs] of index.tiles) {
      const node = {
        id: nextId.value++, cloud: cloudKey, level: l, tx, ty, segs,
        points: segs.reduce((n, s) => n + s[2], 0),
        box: [tx * size, ty * size, minZ, (tx + 1) * size, (ty + 1) * size, maxZ],
        voxel: LEVELS[l].voxel, children: [],
      }
      map.set(`${tx},${ty}`, node)
      nodes.push(node)
      const parent = byLevel.get(l + 1)?.get(`${Math.floor(tx / FANOUT)},${Math.floor(ty / FANOUT)}`)
      if (parent) parent.children.push(node)
    }
    byLevel.set(l, map)
  }
  return { roots: [...(byLevel.get(coarsest)?.values() ?? [])], nodes }
}

/**
 * The tiles to draw and to load. `roots` of every cloud; `visible(node)` and
 * `distance(node)` [m] from the camera; `projScale` the pixels a metre covers
 * at one metre's distance; `isLoaded(node)`. Returns `{ draw, load, points }`:
 * the nodes to draw, the nodes to load next (most needed first), and the
 * points drawn.
 *
 * A node is refined while its voxel looks larger than `threshold` pixels and
 * its children fit the budget.
 */
export function selectNodes(roots, { visible, distance, projScale, isLoaded, budget, threshold = 2, maxLoads = 16 }) {
  const error = (n) => n.voxel * projScale / Math.max(distance(n), 0.5)
  const draw = new Set()
  const want = new Map()        // node → priority
  const queue = new Heap()      // drawn nodes that could be refined, [error, node]
  let points = 0

  const ask = (node, priority) => {
    if (!want.has(node) || want.get(node) < priority) want.set(node, priority)
  }
  const show = (node) => {
    draw.add(node)
    points += node.points
    if (node.level > FINEST_DRAWN && node.children.length) queue.push([error(node), node])
  }

  for (const root of roots) {
    if (!visible(root)) continue
    if (isLoaded(root)) show(root)
    else ask(root, Infinity)
  }

  while (queue.size) {
    const [err, node] = queue.pop()
    if (err <= threshold) continue
    const kids = node.children.filter(c => visible(c))
    if (!kids.length) continue
    const missing = kids.filter(c => !isLoaded(c))
    const extra = kids.reduce((n, c) => n + c.points, 0) - node.points
    if (points + extra > budget) continue
    if (missing.length) {
      for (const c of missing) ask(c, err)
      continue
    }
    draw.delete(node)
    points -= node.points
    for (const c of kids) show(c)
  }

  const load = [...want].sort((a, b) => b[1] - a[1]).slice(0, maxLoads).map(([n]) => n)
  return { draw: [...draw], load, points }
}
