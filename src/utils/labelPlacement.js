// Labels of a diagram set where they cover nothing (R5.6): the topology
// graph's node and track names, placed among its lines and nodes.

/** Size [px] of a label in the diagram's 9 px type, near enough to keep labels apart. */
export const labelBox = (text) => ({ w: String(text).length * 5.2 + 4, h: 11 })

/** Does the segment (x1, y1)–(x2, y2) touch the box? (Liang–Barsky) */
export function segmentHitsBox([x1, y1, x2, y2], b) {
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
export function placeLabels(items, segments, nodeBoxes) {
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
