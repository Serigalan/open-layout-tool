import { describe, it, expect } from 'vitest'
import { assembleSchematic, assembleSite, planDate, planFileBase, titleBlockOf } from './planAssemble'
import { normalizeHeader } from './planHeader'
import { tracks, switches, platforms } from '../test/schematicFixture'

// Keys come back as they are, so the test reads what was asked for.
const t = (key) => key
const header = (over = {}) => ({ ...normalizeHeader(null), ...over })
const project = { title: 'Musterstrecke', creator: 'J. Wolf', tracks, switches, platforms, kmLines: [], endMarks: [] }

describe('the title block', () => {
  it('states plane, height system and paper of the project', () => {
    const block = titleBlockOf({ legend: 'L', kind: 'K', scale: '1:1000', lines: ['Blatt'] },
      { project, header: header(), paperKey: '297x840', t, language: 'de' })
    expect(block).toMatchObject({ title: 'Musterstrecke', legend: 'L', kind: 'K', epsg: '25832', heightEpsg: '7837', format: '297 × 840 mm' })
    // Drawn today by whoever made the project, unless the header says otherwise.
    expect(block.staff[0].name).toBe('J. Wolf')
    expect(block.full).toBeUndefined()
  })

  it('fills the detailed block, with the network as its sketch', () => {
    const block = titleBlockOf({ legend: '', kind: 'K', scale: '-', lines: ['Blatt'] },
      { project, header: header({ style: 'full', code: 'MS' }), paperKey: '297x840', t, language: 'de' })
    expect(block).toMatchObject({ full: true, scale: '-', code: 'MS', subtitle: 'K' })
    expect(block.sketch.lines.length).toBe(tracks.length)
    expect(block.systems[0]).toEqual(['plan_system_position', 'EPSG 25832'])
  })

  it('writes a calendar date as the language does', () => {
    expect(planDate('2026-10-02', 'de')).toBe('02.10.2026')
    expect(planDate('2026-10-02', 'en')).toBe('02/10/2026')
    expect(planDate('Okt. 2026', 'de')).toBe('Okt. 2026')
  })
})

describe('assembling a plan', () => {
  const o = {
    kind: 'site', scaleKey: '1000', schematicScaleKey: '10000', corridor: 300, paperKey: '297x840',
    mode: 'auto', rotation: 0, leadTrackId: '', split: true, overlap: 50, background: 'none',
    show: { mainPoints: true, labels: true, switches: true, trackNames: true, kilometrage: false },
    schematicShow: { km: false, switches: true, trackNames: true, platforms: true },
    header: header(),
  }

  it('lays the site plan on sheets along the tracks', async () => {
    const { plan, layout } = await assembleSite(project, o, { t, language: 'de' })
    expect(plan.sheets.length).toBe(layout.sheets.length)
    expect(plan.sheets.length).toBeGreaterThan(0)
  })

  it('draws the overview as a strip', () => {
    const { plan, layout } = assembleSchematic(project, { ...o, kind: 'schematic' }, { t, language: 'de' })
    expect(plan.sheets).toHaveLength(1)
    expect(layout.fits).toBe(true)
  })

  it('names the file after the project, the kind and the scale', () => {
    expect(planFileBase(project, o, t)).toBe('Musterstrecke_1-1000')
    expect(planFileBase({ title: 'A B' }, { ...o, kind: 'schematic' }, t)).toBe('A_B_plan_schematic_file_1-10000')
  })
})
