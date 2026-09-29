import { describe, it, expect } from 'vitest'
import { buildPlan } from './planModel'
import { TITLE_COLUMN_MM, drawingArea, makeTransform } from './planExport'

const block = (over = {}) => ({
  full: true, title: 'GSH Erfurt - Bebra', subtitle: 'Streckenband',
  rows: [['1:1000', 'Blatt {i} / {n}']],
  parties: ['Bauherr:', 'Projektleitung:', 'Planung:'].map((label, i) => ({
    label, lines: [`Firma ${i}`, 'Strasse 1'],
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

describe('full title block', () => {
  it('draws party labels, addresses and the sheet number', () => {
    const texts = build(block()).filter(i => i.type === 'text').map(i => i.parts[0].t)
    expect(texts).toEqual(expect.arrayContaining(['Bauherr:', 'Projektleitung:', 'Planung:', 'Firma 1', '1:1000  ·  Blatt 1 / 2']))
  })

  it('sets a logo inside its box without distorting it', () => {
    const [img, ...rest] = build(block()).filter(i => i.type === 'image')
    expect(rest).toHaveLength(0)
    expect(img.w / img.h).toBeCloseTo(2)
    expect(img.h).toBeLessThanOrEqual(12)
  })

  it('draws no image for a party without a logo', () => {
    const parties = block().parties.map(p => ({ ...p, logo: null }))
    expect(build(block({ parties })).some(i => i.type === 'image')).toBe(false)
  })

  it('keeps the compact block when `full` is not set', () => {
    const items = build({ title: 'T', rows: [['a', 'b']] })
    expect(items.some(i => i.type === 'text' && i.parts[0].t === 'Bauherr:')).toBe(false)
  })
})

describe('title column', () => {
  it('keeps the drawing clear of the column the full block takes', () => {
    const group = build(block()).find(i => i.type === 'group')
    expect(group.clip.x + group.clip.w).toBeCloseTo(840 - 12 - TITLE_COLUMN_MM)
  })

  it('centres the drawing in what is left', () => {
    const t = makeTransform({ e: 0, n: 0 }, 840, 297, 1000, 0, TITLE_COLUMN_MM)
    const area = drawingArea(840, 297, TITLE_COLUMN_MM)
    expect(t(0, 0)[0]).toBeCloseTo(area.x + area.w / 2)
  })

  it('leaves the compact block over the full width', () => {
    const group = build({ title: 'T', rows: [] }).find(i => i.type === 'group')
    expect(group.clip.w).toBeCloseTo(840 - 24)
  })
})
