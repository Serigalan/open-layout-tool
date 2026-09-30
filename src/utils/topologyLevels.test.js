import { describe, it, expect } from 'vitest'
import { planarLevels, planarSubset, insertChains, countCrossings, stNumbering } from './topologyLevels'

/** A small deterministic random generator. */
function random(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A planar network like a station's: a grid of nodes with its horizontal
 * edges, some verticals and some diagonals of one direction, doubled here and
 * there (two tracks between the same two switches), with stubs hanging off.
 */
function planarNetwork(seed, W = 7, R = 4) {
  const rnd = random(seed)
  const chains = []
  const id = (r, c) => r * W + c
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < W; c++) {
      if (c + 1 < W) chains.push({ a: id(r, c), b: id(r, c + 1) })
      if (r + 1 < R && (c === 0 || rnd() < 0.3)) chains.push({ a: id(r, c), b: id(r + 1, c) })
      if (r + 1 < R && c + 1 < W && rnd() < 0.3) chains.push({ a: id(r, c), b: id(r + 1, c + 1) })
      if (c + 1 < W && rnd() < 0.15) chains.push({ a: id(r, c), b: id(r, c + 1) })
    }
  }
  let n = W * R
  for (let k = 0; k < 6; k++) chains.push({ a: Math.floor(rnd() * W * R), b: n++ })
  chains.forEach((c, k) => { c.trackId = `t${k}` })
  // Along the line: the column, a little shaken, so the order is not the grid's.
  const along = [...Array(n).keys()].map(v => (v < W * R ? v % W : rnd() * W) + rnd() * 0.5)
  return { n, chains, along }
}

describe('columns without crossings', () => {
  it('lay out every planar network with no two lines crossing', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { n, chains, along } = planarNetwork(seed)
      const laid = planarLevels(n, chains, along)
      expect(laid).not.toBeNull()
      expect(countCrossings(laid.pts, laid.columns)).toBe(0)
      for (const c of chains) {
        // From one end to the other, one column at a time, through its name point.
        expect([c.points[0], c.points.at(-1)].sort()).toEqual([c.a, c.b].sort())
        for (let k = 1; k < c.points.length; k++) {
          expect(laid.pts[c.points[k]].layer - laid.pts[c.points[k - 1]].layer).toBe(1)
        }
        expect(c.points).toContain(c.label)
        expect(c.points.length).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('gives up on a network that has to cross', () => {
    const chains = []
    for (let a = 0; a < 3; a++) for (let b = 3; b < 6; b++) chains.push({ trackId: `${a}${b}`, a, b })
    expect(planarLevels(6, chains, [0, 1, 2, 3, 4, 5])).toBeNull()
  })

  it('draws K3,3 with the one crossing it cannot do without', () => {
    const chains = []
    for (let a = 0; a < 3; a++) for (let b = 3; b < 6; b++) chains.push({ trackId: `${a}${b}`, a, b })
    const { keep, rest } = planarSubset(6, chains)
    expect(rest).toHaveLength(1)
    const laid = planarLevels(6, keep, [0, 1, 2, 3, 4, 5])
    expect(insertChains(laid, rest)).toBe(1)
  })

  it('numbers a two-connected graph from s to t with every point between neighbours', () => {
    // A wheel: a rim of 8 and a hub.
    const adj = Array.from({ length: 9 }, () => [])
    const link = (a, b) => { adj[a].push(b); adj[b].push(a) }
    for (let k = 0; k < 8; k++) { link(k, (k + 1) % 8); link(k, 8) }
    const st = stNumbering(9, adj, 0, 1)
    expect(st[0]).toBe(0)
    expect(st[1]).toBe(8)
    for (let v = 2; v < 9; v++) {
      expect(adj[v].some(w => st[w] < st[v])).toBe(true)
      expect(adj[v].some(w => st[w] > st[v])).toBe(true)
    }
  })
})
