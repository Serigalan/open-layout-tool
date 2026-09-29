import { describe, it, expect } from 'vitest'
import { buildPlan } from './planModel'
import { FRAME, TITLE_COLUMN_MM, drawingArea, makeTransform } from './planExport'

const block = (over = {}) => ({
  full: true, title: 'GSH Erfurt - Bebra', subtitle: 'Streckenband', range: 'km 190,0 bis km 200,0',
  rows: [['1:1000', 'Blatt {i} / {n}']],
  footer: [['Maßstab 1:1000'], ['Blatt {i} / {n}'], []],
  code: 'MS',
  parties: ['Bauherr:', 'Projektleitung:', 'Auftragnehmer:', 'Planung:'].map((label, i) => ({
    label, lines: [`Firma ${i}`, 'Strasse 1'], signs: i !== 2,
    logo: i === 0 ? { dataUrl: 'data:image/png;base64,AA==', w: 200, h: 100 } : null,
  })),
  staff: [{ label: 'Gezeichnet', date: '01/2026', name: 'J. Wolf' }],
  dateCaption: 'Ort, Datum', signCaption: 'Unterschrift', dateHeader: 'Datum', nameHeader: 'Name',
  ...over,
})

const build = (titleBlock) => buildPlan({
  tracks: [], sheets: [{ center: { e: 0, n: 0 }, rotDeg: 0, index: 0, count: 2 }],
  paperKey: '297x840', scaleDen: 1000, titleBlock,
}).sheets[0].items

const texts = (items) => items.filter(i => i.type === 'text').map(i => i.parts[0].t)

describe('full title block', () => {
  it('draws party labels, addresses, the title lines and the sheet number', () => {
    expect(texts(build(block()))).toEqual(expect.arrayContaining([
      'Bauherr:', 'Projektleitung:', 'Auftragnehmer:', 'Planung:', 'Firma 1',
      'GSH Erfurt - Bebra', 'km 190,0 bis km 200,0', 'Streckenband', 'MS', 'Blatt 1 / 2',
    ]))
  })

  it('sits in the bottom right corner at the size of the template', () => {
    // The rules of the block are single strokes; the sheet frame is one closed path.
    const rules = build(block()).filter(i => i.type === 'path' && i.width === 0.5 && i.d.length === 2)
    const xs = rules.flatMap(r => r.d.filter(c => c[0] !== 'Z').map(c => c[1]))
    const ys = rules.flatMap(r => r.d.filter(c => c[0] !== 'Z').map(c => c[2]))
    expect(Math.min(...xs)).toBeCloseTo(840 - FRAME.right - 180)
    expect(Math.max(...xs)).toBeCloseTo(840 - FRAME.right)
    expect(Math.min(...ys)).toBeCloseTo(297 - FRAME.bottom - 134)
    expect(Math.max(...ys)).toBeCloseTo(297 - FRAME.bottom)
  })

  it('gives signature lines only to the parties that sign', () => {
    const dotted = build(block()).filter(i => i.type === 'path' && i.dash?.[0] === 0.25)
    expect(dotted).toHaveLength(6)
    const x0 = 840 - FRAME.right - 180
    expect(dotted.some(d => d.d[0][1] > x0 + 90 && d.d[0][1] < x0 + 135)).toBe(false)
  })

  it('takes the kilometrage of the sheet when no section is given', () => {
    const items = buildPlan({
      tracks: [], sheets: [{ center: { e: 0, n: 0 }, rotDeg: 0, index: 0, count: 1, range: 'km 1,0 bis km 2,0' }],
      paperKey: '297x840', scaleDen: 1000, titleBlock: block({ range: '' }),
    }).sheets[0].items
    expect(texts(items)).toContain('km 1,0 bis km 2,0')
  })

  it('outlines the sheet on the location sketch', () => {
    const sketch = { epsg: 25832, lines: [[[-2000, 0], [2000, 0]], [[0, -500], [0, 500]]] }
    const items = build(block({ sketch }))
    const ring = items.find(i => i.type === 'path' && i.stroke === '#ec0016')
    expect(ring.d).toHaveLength(5)
    const x0 = 840 - FRAME.right - 180
    const y0 = 297 - FRAME.bottom - 134
    for (const [, x, y] of ring.d) {
      expect(x).toBeGreaterThanOrEqual(x0 + 2 - 1e-6)
      expect(x).toBeLessThanOrEqual(x0 + 128 + 1e-6)
      expect(y).toBeGreaterThanOrEqual(y0 + 41 - 1e-6)
      expect(y).toBeLessThanOrEqual(y0 + 81.5 + 1e-6)
    }
  })

  it('sets a logo inside its box without distorting it', () => {
    const [img, ...rest] = build(block()).filter(i => i.type === 'image')
    expect(rest).toHaveLength(0)
    expect(img.w / img.h).toBeCloseTo(2)
    expect(img.h).toBeLessThanOrEqual(5.2)
  })

  it('draws no image for a party without a logo', () => {
    const parties = block().parties.map(p => ({ ...p, logo: null }))
    expect(build(block({ parties })).some(i => i.type === 'image')).toBe(false)
  })

  it('keeps the compact block when `full` is not set', () => {
    const items = build({ title: 'T', rows: [['a', 'b']] })
    expect(texts(items)).not.toContain('Bauherr:')
  })
})

describe('sheet frame', () => {
  it('keeps the filing margin on the left and 5 mm elsewhere, drawn 0.5 mm', () => {
    const frame = build(block()).find(i => i.type === 'path' && i.d.length === 5)
    expect(frame.width).toBe(0.5)
    expect(frame.d[0].slice(1)).toEqual([20, 5])
    expect(frame.d[2].slice(1)).toEqual([840 - 5, 297 - 5])
  })

  it('centres the drawing between the frame lines', () => {
    const t = makeTransform({ e: 0, n: 0 }, 1920, 297, 1000, 0)
    expect(t(0, 0)[0]).toBeCloseTo(20 + (1920 - 25) / 2)
    expect(t(0, 0)[1]).toBeCloseTo(5 + 287 / 2)
  })
})

describe('title column', () => {
  it('keeps the drawing clear of the column the full block takes', () => {
    const group = build(block()).find(i => i.type === 'group')
    expect(group.clip.x + group.clip.w).toBeCloseTo(840 - FRAME.right - TITLE_COLUMN_MM)
  })

  it('centres the drawing in what is left', () => {
    const t = makeTransform({ e: 0, n: 0 }, 840, 297, 1000, 0, TITLE_COLUMN_MM)
    const area = drawingArea(840, 297, TITLE_COLUMN_MM)
    expect(t(0, 0)[0]).toBeCloseTo(area.x + area.w / 2)
  })

  it('leaves the compact block over the full width', () => {
    const group = build({ title: 'T', rows: [] }).find(i => i.type === 'group')
    expect(group.clip.w).toBeCloseTo(840 - FRAME.left - FRAME.right)
  })
})
