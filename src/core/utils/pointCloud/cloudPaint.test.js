import { describe, it, expect } from 'vitest'
import { drawCloudPoints, INTRUSION_COLOR } from './cloudPaint'

const fakeCtx = () => {
  const rects = []
  const ctx = {
    fillStyle: null,
    setTransform() {}, clearRect() {},
    fillRect(x, y, w, h) { rects.push({ x: x + w / 2, y: y + h / 2, fill: ctx.fillStyle }) },
  }
  return { ctx, rects }
}

const points = (rows) => ({
  count: rows.length,
  y: Float32Array.from(rows.map(r => r[0])), z: Float64Array.from(rows.map(r => r[1])), i: Uint8Array.from(rows.map(r => r[2])),
})

describe('drawCloudPoints', () => {
  it('places points in the drawing transform, z over the reference height', () => {
    const { ctx, rects } = fakeCtx()
    const n = drawCloudPoints(ctx, {
      w: 400, h: 300, k: 0.05, cx: 200, cy: 250, zRef: 100,
      parts: [{ points: points([[1, 101, 0], [-2, 100, 255], [50, 100, 0]]) }],
    })
    expect(n).toBe(2)                           // 50 m to the right is off the canvas
    const at = rects.map(r => [Math.round(r.x), Math.round(r.y)]).sort((a, b) => a[0] - b[0])
    expect(at).toEqual([[100, 250], [250, 200]])
  })

  it('paints points inside the clearance outline in red, over the others', () => {
    const { ctx, rects } = fakeCtx()
    drawCloudPoints(ctx, {
      w: 400, h: 300, k: 0.05, cx: 200, cy: 250, zRef: 100,
      parts: [{ points: points([[0, 101, 10], [0.5, 101, 10]]), flags: Uint8Array.from([1, 0]) }],
    })
    expect(rects[rects.length - 1].fill).toBe(INTRUSION_COLOR)
    expect(rects[0].fill).not.toBe(INTRUSION_COLOR)
  })

  it('paints in the points\' own colour with RGB, a part without colour by intensity', () => {
    const { ctx, rects } = fakeCtx()
    const coloured = { ...points([[0, 101, 10], [1, 101, 10]]), rgb: Uint8Array.from([255, 0, 0, 0, 255, 255]) }
    drawCloudPoints(ctx, {
      w: 400, h: 300, k: 0.05, cx: 200, cy: 250, zRef: 100, coloring: 'rgb',
      parts: [{ points: coloured }, { points: points([[2, 101, 255]]) }],
    })
    expect(rects.map(r => r.fill)).toEqual(['rgb(255,0,0)', 'rgb(0,255,255)', 'rgb(30,30,30)'])
  })

  it('draws nothing without a reference height', () => {
    const { ctx, rects } = fakeCtx()
    expect(drawCloudPoints(ctx, { w: 10, h: 10, k: 1, cx: 0, cy: 0, zRef: null, parts: [{ points: points([[0, 0, 0]]) }] })).toBe(0)
    expect(rects).toHaveLength(0)
  })
})
