import { describe, it, expect } from 'vitest'
import { planarEmbedding } from './planarity'

/** Faces of an embedding, by walking every half-edge once. */
function faceCount(emb) {
  const seen = new Set()
  let faces = 0
  for (let v = 0; v < emb.size; v++) {
    for (const w of emb.rot[v].keys()) {
      if (seen.has(`${v},${w}`)) continue
      faces += 1
      let [a, b] = [v, w]
      do {
        seen.add(`${a},${b}`);
        [a, b] = emb.nextFaceHalfEdge(a, b)
      } while (a !== v || b !== w)
    }
  }
  return faces
}

const complete = (k) => {
  const edges = []
  for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) edges.push([a, b])
  return edges
}

describe('the planarity test', () => {
  it('finds no embedding for K5 and K3,3', () => {
    expect(planarEmbedding(5, complete(5))).toBeNull()
    const k33 = []
    for (let a = 0; a < 3; a++) for (let b = 3; b < 6; b++) k33.push([a, b])
    expect(planarEmbedding(6, k33)).toBeNull()
  })

  it('embeds a planar graph so that Euler\'s formula holds', () => {
    // A triangulated grid, the densest a planar graph gets.
    const W = 12
    const edges = []
    for (let r = 0; r < W; r++) {
      for (let c = 0; c < W; c++) {
        const v = r * W + c
        if (c + 1 < W) edges.push([v, v + 1])
        if (r + 1 < W) edges.push([v, v + W])
        if (c + 1 < W && r + 1 < W) edges.push([v, v + W + 1])
      }
    }
    const emb = planarEmbedding(W * W, edges)
    expect(emb).not.toBeNull()
    expect(W * W - edges.length + faceCount(emb)).toBe(2)
  })

  it('embeds K4 and a tree', () => {
    expect(faceCount(planarEmbedding(4, complete(4)))).toBe(4)
    const tree = planarEmbedding(5, [[0, 1], [0, 2], [2, 3], [2, 4]])
    expect(faceCount(tree)).toBe(1)
  })
})
