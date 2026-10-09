import { describe, it, expect } from 'vitest'
import { buildPlan } from './planModel'
import { FRAME, TITLE_COLUMN_MM, drawingArea, makeTransform } from './planExport'
import { normalizeHeader, toIsoDate } from './planHeader'

const block = (over = {}) => ({
  full: true, title: 'GSH Erfurt - Bebra', subtitle: 'Streckenband', range: 'km 190,0 bis km 200,0',
  rows: [['1:1000', 'Blatt {i} / {n}']],
  footer: [['Maßstab 1:1000'], ['Blatt {i} / {n}'], []],
  scale: 'M 1:1000',
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

  it('states the scale in the cell above the code', () => {
    const x0 = 840 - FRAME.right - 180
    const y0 = 297 - FRAME.bottom - 134
    const scale = build(block()).find(i => i.type === 'text' && i.parts[0].t === 'M 1:1000')
    expect(scale.x).toBeCloseTo(x0 + 9)
    expect(scale.y).toBeGreaterThan(y0 + 99)
    expect(scale.y).toBeLessThan(y0 + 104)
  })

  it('names the reference systems and the paper in the rows below the planner', () => {
    const x0 = 840 - FRAME.right - 180
    const y0 = 297 - FRAME.bottom - 134
    const systems = [['Lagesystem', 'EPSG 25832'], ['Höhensystem', 'EPSG 7837'], ['Blattformat', '297 × 840 mm']]
    const items = build(block({ systems })).filter(i => i.type === 'text')
    systems.forEach(([caption, value], k) => {
      const [c, v] = [caption, value].map(str => items.find(i => i.parts[0].t === str))
      for (const item of [c, v]) {
        expect(item.x).toBeGreaterThan(x0 + 130)
        expect(item.y).toBeGreaterThan(y0 + 35 + k * 8)
        expect(item.y).toBeLessThan(y0 + 43 + k * 8)
      }
      expect(c.y).toBeLessThan(v.y)
    })
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
    const frame = build(block()).find(i => i.type === 'path' && i.d.length === 5 && i.d[0][1] === 20)
    expect(frame.width).toBe(0.5)
    expect(frame.d[0].slice(1)).toEqual([20, 5])
    expect(frame.d[2].slice(1)).toEqual([840 - 5, 297 - 5])
  })

  it('draws the frame over either title block, so it keeps its width all round', () => {
    for (const tb of [block(), { title: 'T' }]) {
      const items = build(tb)
      const frame = items.findIndex(i => i.type === 'path' && i.d.length === 5 && i.d[0][1] === 20)
      const grounds = items.map((i, k) => (i.fill === '#ffffff' ? k : -1)).filter(k => k >= 0)
      expect(frame).toBeGreaterThan(Math.max(...grounds))
    }
  })

  it('marks the fold 190 mm from the right edge in the bottom margin', () => {
    const fold = build({ title: 'T' }).find(i => i.type === 'path' && i.d[0][1] === 840 - 190)
    expect(fold.d).toEqual([['M', 840 - 190, 292], ['L', 840 - 190, 297]])
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

  it('keeps the same column clear for the simple block', () => {
    const group = build({ title: 'T' }).find(i => i.type === 'group')
    expect(group.clip.x + group.clip.w).toBeCloseTo(840 - FRAME.right - TITLE_COLUMN_MM)
  })
})

describe('simple title block', () => {
  const simple = {
    title: 'EW 500 - 1:12', kind: 'Weichenskizze', scale: '1:50', lines: ['Blatt {i} / {n}'],
    labels: { kind: 'Planart:', scale: 'Maßstab:', content: 'Inhalt:', epsg: 'EPSG:', format: 'Format:' },
    staff: [{ label: 'gez.', date: '15.04.2026', name: 'Wolf' }, { label: 'gepr.', date: '', name: '' }],
    dateHeader: 'Datum', nameHeader: 'Name', epsg: '5684', format: '297 × 840 mm',
  }

  it('sits in the frame corner as wide as the detailed block, 52 mm high', () => {
    const outline = build(simple).find(i => i.type === 'path' && i.width === 0.5 && i.d.length === 3)
    expect(outline.d).toEqual([['M', 840 - 5 - 180, 297 - 5], ['L', 840 - 5 - 180, 297 - 5 - 52], ['L', 840 - 5, 297 - 5 - 52]])
  })

  it('states kind, scale, content, staff, reference system and paper', () => {
    expect(texts(build(simple))).toEqual(expect.arrayContaining([
      'Planart:', 'Weichenskizze', 'Maßstab: 1:50', 'Inhalt:', 'EW 500 - 1:12', 'Blatt 1 / 2',
      'Datum', 'Name', 'gez.', '15.04.2026', 'Wolf', 'gepr.', 'EPSG: 5684', 'Format: 297 × 840 mm',
    ]))
  })

  it('carries the wordmark as filled vector paths inside its top row', () => {
    const marks = build(simple).filter(i => i.type === 'path' && i.fill === '#1f0f96' || i.type === 'path' && i.fill === '#000000' && i.stroke === null && i.d.length > 50)
    expect(marks).toHaveLength(2)
    const y0 = 297 - 5 - 52
    for (const m of marks) {
      for (const c of m.d.filter(c => c[0] !== 'Z')) {
        for (let k = 2; k < c.length; k += 2) {
          expect(c[k]).toBeGreaterThan(y0)
          expect(c[k]).toBeLessThan(y0 + 11)
        }
      }
    }
  })
})


describe('stored title block', () => {
  it('takes the dates typed by earlier versions into the calendar form', () => {
    expect(toIsoDate('01/2026')).toBe('2026-01-01')
    expect(toIsoDate('5.3.2026')).toBe('2026-03-05')
    expect(toIsoDate('2026-04-15')).toBe('2026-04-15')
    expect(normalizeHeader({ staff: { drawn: { date: '04/2026', name: 'J. Wolf' } } }).staff.drawn)
      .toEqual({ date: '2026-04-01', name: 'J. Wolf' })
  })

  it('lets every party sign but the contractor until told otherwise', () => {
    const parties = normalizeHeader({ parties: { lead: { address: 'DB', signs: false } } }).parties
    expect(parties.owner.signs).toBe(true)
    expect(parties.lead).toEqual({ address: 'DB', logo: null, signs: false })
    expect(parties.contractor.signs).toBe(false)
  })

  it('keeps the chosen block style, and falls back to the simple one', () => {
    expect(normalizeHeader({ style: 'full' }).style).toBe('full')
    expect(normalizeHeader({ style: 'odd' }).style).toBe('compact')
    expect(normalizeHeader(null).style).toBe('compact')
  })
})
