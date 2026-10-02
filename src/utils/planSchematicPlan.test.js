import { describe, it, expect } from 'vitest'
import { buildSchematicPlan, switchNumber } from './planSchematicPlan'
import { tracks, switches, platforms, isWedge } from '../test/schematicFixture'

describe('schematic plan', () => {
  const plan = buildSchematicPlan({
    tracks, switches, platforms, paperKey: '297x840', scaleDen: 10000,
    titleBlock: { title: 'Test', rows: [['1:10 000', 'Blatt {i} / {n}']], legend: 'Legende' },
  })
  const items = plan.sheets[0].items
  const inner = items.find(i => i.type === 'group').items
  const texts = inner.filter(i => i.type === 'text').map(i => i.parts[0].t)

  it('fits the 2 km strip on one sheet at 1:10 000', () => {
    expect(plan.sheets).toHaveLength(1)
    expect(plan.fits).toBe(true)
  })

  it('names the station, the switches and the kilometres', () => {
    expect(texts).toEqual(expect.arrayContaining(['Musterstadt', 'MS', '1', '3', 'km 1,0']))
  })

  it('draws the siding and the crossover at 45°', () => {
    const diagonals = inner.filter(i => i.type === 'path' && i.d.length === 2
      && Math.abs(i.d[1][2] - i.d[0][2]) > 0.1 && Math.abs(i.d[1][1] - i.d[0][1]) > 0.1)
    expect(diagonals.length).toBeGreaterThan(0)
    for (const d of diagonals) {
      expect(Math.abs(d.d[1][1] - d.d[0][1])).toBeCloseTo(Math.abs(d.d[1][2] - d.d[0][2]), 3)
    }
  })

  it('keeps every track one spacing from the next', () => {
    const ys = [...new Set(inner.filter(i => i.type === 'path' && i.d.length === 2 && i.width === 0.5
      && i.d[0][2] === i.d[1][2] && Math.abs(i.d[1][1] - i.d[0][1]) > 20).map(i => i.d[0][2]))].sort((a, b) => a - b)
    expect(ys).toHaveLength(3)
    expect(ys[1] - ys[0]).toBeCloseTo(10)
    expect(ys[2] - ys[1]).toBeCloseTo(10)
  })

  it('marks each switch with a filled triangle in the angle of its branch', () => {
    const wedges = inner.filter(isWedge)
    expect(wedges).toHaveLength(3)
    for (const w of wedges) {
      const [[, x0, y0], [, x1, y1], [, x2, y2]] = w.d
      expect(Math.abs(x1 - x0)).toBeCloseTo(3)
      expect(y1).toBeCloseTo(y0)
      expect(x2).toBeCloseTo(x1)
      expect(Math.abs(y2 - y1)).toBeCloseTo(3)
    }
  })

  it('sets each switch number in the sharp angle beyond its triangle, an arrow pointing at it', () => {
    for (const w of inner.filter(isWedge)) {
      const [[, tx, ty], [, bx], [, , cy]] = w.d
      const sx = Math.sign(bx - tx)
      const sy = Math.sign(cy - ty)
      const label = inner.find(i => i.type === 'text' && /^\d+$/.test(i.parts[0].t)
        && Math.abs(i.x - tx) < 8 && Math.abs(i.y - ty) < 3 && Math.sign(i.x - tx) === sx)
      expect(label).toBeDefined()
      // Off the track on the branch side, clear of it by the same margin either way.
      const cap = 0.72 * label.size
      const near = sy > 0 ? label.y - cap - ty : ty - label.y
      expect(near).toBeCloseTo(0.75)
      expect(label.align).toBe(sx > 0 ? 'left' : 'right')
      const arrow = inner.find(i => i.type === 'path' && i.fill && i.d.length === 4 && !isWedge(i)
        && Math.abs(i.d[0][1] - (tx + sx * 3)) < 0.01 && Math.abs(i.d[0][2] - ty) < 3)
      expect(arrow).toBeDefined()
      // The arrow's point is nearest the switch and its colour the switch's.
      expect(Math.sign(arrow.d[1][1] - arrow.d[0][1])).toBe(sx)
      expect(arrow.fill).toBe(label.color)
    }
  })

  it('draws a platform as the DB symbol: a box with its edges along both sides', () => {
    const box = inner.find(i => i.type === 'path' && i.fill === '#ffffff' && i.d.length === 5)
    const [top, bottom] = [box.d[0][2], box.d[2][2]].sort((a, b) => a - b)
    expect(bottom - top).toBeCloseTo(6)
    const edges = inner.filter(i => i.type === 'path' && i.width === 0.25 && i.d.length === 2
      && i.d[0][1] === box.d[0][1] && i.d[0][2] > top && i.d[0][2] < bottom).map(i => i.d[0][2]).sort((a, b) => a - b)
    expect(edges).toEqual([top + 1, bottom - 1].map(v => expect.closeTo(v)))
  })

  it('sets kilometre posts in the gap beside the reference', () => {
    expect(inner.some(i => i.type === 'text' && i.bold && i.parts[0].t === '1,0')).toBe(true)
  })
})

describe('planning status in the schematic plan', () => {
  const withStatus = tracks.map(tr => (tr.id === 'X' ? { ...tr, status: 'new' } : tr.id === 'S' ? { ...tr, status: 'removal' } : tr))
  const inner = buildSchematicPlan({
    tracks: withStatus, switches, platforms, paperKey: '297x840', scaleDen: 10000,
    titleBlock: { title: 'Test', rows: [], legend: '' },
  }).sheets[0].items.find(i => i.type === 'group').items
  const colours = (pred) => inner.filter(pred).map(i => i.fill ?? i.stroke)

  it('draws a new crossover and its switches in red', () => {
    const diag = inner.filter(i => i.type === 'path' && i.d.length === 2
      && Math.abs(i.d[1][2] - i.d[0][2]) > 0.1 && Math.abs(i.d[1][1] - i.d[0][1]) > 0.1)
    expect(diag.map(i => i.stroke)).toEqual(expect.arrayContaining(['#ff0000', '#e6b400']))
    expect(colours(isWedge).sort())
      .toEqual(['#e6b400', '#ff0000', '#ff0000'])
  })

  it('lets a switch state its own status over what its tracks say', () => {
    const own = switches.map(sw => (sw.name === 'W1' ? { ...sw, status: 'existing' } : sw))
    const items = buildSchematicPlan({
      tracks: withStatus, switches: own, platforms, paperKey: '297x840', scaleDen: 10000,
    }).sheets[0].items.find(i => i.type === 'group').items
    expect(items.filter(isWedge).map(i => i.fill).sort())
      .toEqual(['#000000', '#e6b400', '#ff0000'])
  })
})

describe('switch number', () => {
  it('keeps the number of a name alone, without leading zeros', () => {
    expect(switchNumber('switch.003')).toBe('3')
    expect(switchNumber('W 301')).toBe('301')
    expect(switchNumber('W12a')).toBe('12a')
    expect(switchNumber('Weiche Nord')).toBe('Weiche Nord')
    expect(switchNumber(null)).toBe('')
  })
})

describe('sheets and sheet furniture', () => {
  const texts = { next: 'weiter auf Blatt {n}', prev: 'von Blatt {n}', legend: 'Übersicht',
    status: { existing: 'Bestand', new: 'Neubau', removal: 'Rückbau' } }
  const innerTexts = (sheet) => sheet.items.find(i => i.type === 'group').items
    .filter(i => i.type === 'text').map(i => i.parts[0].t)

  it('cuts a strip too long for one sheet into several, each pointing at its neighbours', () => {
    const plan = buildSchematicPlan({ tracks, switches, platforms, paperKey: '297x840', scaleDen: 2000, texts })
    expect(plan.sheets.length).toBeGreaterThan(1)
    const n = plan.sheets.length
    plan.sheets.forEach((sheet, i) => expect(sheet).toMatchObject({ index: i, count: n }))
    expect(innerTexts(plan.sheets[0])).toContain('weiter auf Blatt 2')
    expect(innerTexts(plan.sheets[0])).not.toContain('von Blatt 0')
    expect(innerTexts(plan.sheets[1])).toContain('von Blatt 1')
    expect(innerTexts(plan.sheets[n - 1]).some(t => t.startsWith('weiter auf'))).toBe(false)
  })

  it('heads the title column with the legend and a row per planning status', () => {
    const plan = buildSchematicPlan({
      tracks, switches, paperKey: '297x840', scaleDen: 10000, texts,
      titleBlock: { title: 'Test', rows: [], legend: 'Strecke 6340' },
    })
    const furniture = plan.sheets[0].items.filter(i => i.type === 'text').map(i => i.parts[0].t)
    expect(furniture).toEqual(expect.arrayContaining(['Übersicht · Strecke 6340', 'Bestand', 'Neubau', 'Rückbau']))
  })

  it('draws an empty sheet with its frame when there is nothing to show', () => {
    const plan = buildSchematicPlan({ tracks: [], paperKey: '297x840', scaleDen: 10000 })
    expect(plan.fits).toBe(true)
    expect(plan.sheets).toHaveLength(1)
    expect(plan.sheets[0].items.length).toBeGreaterThan(0)
    expect(plan.sheets[0].items.every(i => i.type === 'path')).toBe(true)
  })

  it('leaves out what `show` turns off', () => {
    const plan = buildSchematicPlan({
      tracks, switches, platforms, paperKey: '297x840', scaleDen: 10000,
      show: { switches: false, platforms: false, km: false },
    })
    const inner = plan.sheets[0].items.find(i => i.type === 'group').items
    expect(inner.filter(isWedge)).toEqual([])
    expect(innerTexts(plan.sheets[0])).not.toContain('Musterstadt')
    expect(innerTexts(plan.sheets[0]).some(t => /^km /.test(t))).toBe(false)
  })
})
