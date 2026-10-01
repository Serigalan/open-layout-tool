import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import translations from '../../locales/de.json'
import { mergeProject } from '../../utils/merge'
import ConflictDialog from './ConflictDialog'
import CompareOverlay from './CompareOverlay'

const t = (k) => translations[k] ?? k

const straight = (id, y) => ({
  id, name: id, epsg: 25832,
  elements: [{ elementType: 0, bearing: 90, length: 100, absLength: 100, startNode: [500000, 5700000 + y], endNode: [500100, 5700000 + y] }],
})

const base = { id: 'p', title: 'P', tracks: [straight('t1', 0), straight('t2', 50)], switches: [], platforms: [] }

const render = (el) => renderToStaticMarkup(el)

describe('ConflictDialog', () => {
  it('lists a field conflict with both sides and keeps apply locked until it is decided', () => {
    const mine = structuredClone(base), theirs = structuredClone(base)
    mine.tracks[0].name = 'meins'
    theirs.tracks[0].name = 'deren'
    theirs.tracks[1].speed = 80
    const result = mergeProject({ base, mine, theirs })
    const html = render(createElement(ConflictDialog, {
      result, t, mineLabel: 'Arbeitskopie', theirsLabel: 'Server', onCancel() {}, onApply() {},
    }))
    expect(html).toContain('Gleis t1: Name in beiden Ständen geändert')
    expect(html).toContain('meins')
    expect(html).toContain('deren')
    expect(html).toContain('1 Konflikt(e) offen')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Übernehmen<\/button>/)
    // What is taken over from the other side is listed too.
    expect(html).toContain('Übernommene Änderungen (1)')
  })

  it('without conflicts offers the changes to confirm', () => {
    const theirs = structuredClone(base)
    theirs.tracks.push(straight('t3', 100))
    const result = mergeProject({ base, mine: base, theirs })
    const html = render(createElement(ConflictDialog, {
      result, t, mineLabel: 'Arbeitskopie', theirsLabel: 'Server', onCancel() {}, onApply() {},
    }))
    expect(html).toContain(t('merge_no_conflicts'))
    expect(html).toContain('Alle Konflikte aufgelöst.')
    expect(html).not.toMatch(/disabled=""[^>]*>Übernehmen/)
  })
})

describe('CompareOverlay', () => {
  it('lists what is new, changed and gone', () => {
    const after = structuredClone(base)
    after.tracks[0].name = 'neu benannt'
    after.tracks = after.tracks.filter(tr => tr.id !== 't2')
    after.tracks.push(straight('t9', 200))
    const html = render(createElement(CompareOverlay, { before: base, after, beforeLabel: 'Datei', afterLabel: 'Projekt', t, onClose() {} }))
    expect(html).toContain('neu (1)')
    expect(html).toContain('geändert (1)')
    expect(html).toContain('gelöscht (1)')
    expect(html).toContain('Gleis neu benannt — Name')
  })
})
