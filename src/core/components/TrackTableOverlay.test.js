import { describe, it, expect, beforeAll } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { openProject } from '../storage'
import { inGerman, t } from '../test/i18n'
import TrackTableOverlay from './TrackTableOverlay'

/**
 * What the element table says about a track. The static renderer runs the
 * component body without a DOM — the effects (the map highlight, the fit, the
 * picking a click on the map does) stay out, which is the half no environment
 * here could drive anyway, and everything the table states about an element is
 * in the markup that comes back.
 */

// Outside the browser storage degrades to the localStorage backend.
beforeAll(() => {
  const store = new Map()
  globalThis.localStorage = {
    getItem:    (k) => store.get(k) ?? null,
    setItem:    (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
    key:        (i) => [...store.keys()][i] ?? null,
    get length() { return store.size },
  }
})

const GEOM = { coordinates: [[11.0, 51.0], [11.001, 51.001]] }
const straight = (props) => ({ elementType: 0, bearing: 30.1, endBearing: 30.1, length: 100, speed: 100, geometry: GEOM, ...props })
const arc      = (props) => ({ elementType: 1, bearing: 12.3456, endBearing: 30.1, length: 150, speed: 100, geometry: GEOM, ...props })

const TRACK = {
  id: 't1', name: 'Gleis 1', epsg: 5678,
  elements: [
    arc({ radius: 500, cant: 100 }),
    straight({ switchBranch: true, switchId: 'sw1', switchRoute: 'main', speed: 60, length: 33.2000000004 }),
    arc({ radius: -500, cant: -40, switchBranch: true, switchId: 'sw1', switchRoute: 'branch', speed: 60 }),
    straight({ switchHint: 'EW 190-1:9 nicht gebaut' }),
    // 100 km/h through R 500 with no cant at all: 236 mm, past anything.
    arc({ radius: 500, cant: 0 }),
  ],
}
const SWITCH = { switchId: 'sw1', kind: 'turnout', name: 'W 12', label: '500 – 1:12', formVersion: 1 }


/**
 * The table's columns, and its rows as one { text, editable, note } per cell.
 * Each render gets a project of its own — openProject appends, so a second one
 * under the same id would leave the first standing in front of it.
 */
let projects = 0
function renderTable(track = TRACK) {
  openProject({ id: `p${++projects}`, tracks: [track], switches: [SWITCH] })
  const html = renderToStaticMarkup(inGerman(createElement(TrackTableOverlay, {
    track, onPickTrack: () => {}, onClose: () => {},
  })))
  // Newline-tolerant: a title may hold several lines (the rule column lists one
  // finding per line), and `.` would stop at the first of them.
  const columns = [...html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(m => m[1].replace(/<[^>]+>/g, ''))
  const rows = html.match(/<tr[^>]*>(?:(?!<\/tr>)[\s\S])*<\/tr>/g).slice(1).map(row =>
    [...row.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)].map(([, attrs, inner]) => {
      // An input cell says its value in the attribute; a plain one is its text.
      const value = /value="([^"]*)"/.exec(inner)
      const title = /title="([^"]*)"/.exec(attrs)
      // What is left of the input's class beyond the plain one is the mark the
      // table put on the cell: an error, or a value inside the rules but worth
      // seeing.
      const cls = /class="track-table-input([^"]*)"/.exec(inner)
      return {
        text: value ? value[1] : inner.replace(/<[^>]+>/g, ''),
        editable: !inner.includes('disabled=""'),
        note: title ? title[1] : undefined,
        mark: (cls?.[1] ?? '').replace('track-table-input-wide', '').trim(),
      }
    }))
  const cell = (row, column) => rows[row][columns.findIndex(c => c.startsWith(column))]
  return { columns, rows, cell, html }
}

describe('what an element is called', () => {
  it('names a switch route by its switch, not by the shape of its alignment', () => {
    const { cell } = renderTable()
    expect(cell(1, 'Typ').text).toBe('Weiche 500 – 1:12')
    expect(cell(2, 'Typ').text).toBe('Weiche 500 – 1:12')
    // The geometry has not gone anywhere — it stands in the columns for it.
    expect(cell(2, 'Radius').text).toBe('-500')
  })

  it('tells the two routes apart, and says what each is built over', () => {
    const { cell } = renderTable()
    expect(cell(1, 'Typ').note).toBe('W 12 · Stammgleis · Gerade')
    expect(cell(2, 'Typ').note).toBe('W 12 · Zweiggleis · Bogen')
  })

  it('leaves plain running line as the line it is', () => {
    const { cell } = renderTable()
    expect(cell(0, 'Typ').text).toBe('Bogen')
    expect(cell(3, 'Typ').text).toBe('Gerade')
    // …including the one an import found a switch on but could not build.
    expect(cell(3, 'Typ').note).toContain('EW 190-1:9 nicht gebaut')
  })
})

describe('the bearings', () => {
  it('are shown, not typed — the chain is what sets them', () => {
    const { cell } = renderTable()
    expect(cell(0, 'Richtung').editable).toBe(false)
    expect(cell(0, 'Endrichtung').editable).toBe(false)
    expect(cell(0, 'Richtung').text).toBe('12,35')   // German: the decimal comma (R10.8)
  })

  it('leaves the fields that do shape an element editable on a Folgeelement', () => {
    const { cell } = renderTable({ ...TRACK, id: 't-follow', elements: [{ ...TRACK.elements[0], role: 'follow' }, ...TRACK.elements.slice(1)] })
    expect(cell(0, 'Länge').editable).toBe(true)
    expect(cell(0, 'Radius').editable).toBe(true)
    expect(cell(0, 'Speed').editable).toBe(true)
  })
})

describe('the length of a switch route', () => {
  it('is read, not typed — the form of the turnout states it', () => {
    const { cell } = renderTable()
    expect(cell(1, 'Länge').editable).toBe(false)
    expect(cell(2, 'Länge').editable).toBe(false)
    expect(cell(1, 'Länge').note).toBe('Von der Bauform der Weiche gesetzt – hier nicht änderbar')
  })

  it('is shown to the millimetre, not to the last bit of a float', () => {
    const { cell } = renderTable()
    expect(cell(1, 'Länge').text).toBe('33,2')
  })

  it('leaves plain running line as long as it was editable, on a Folgeelement', () => {
    const { cell } = renderTable({ ...TRACK, id: 't-follow3', elements: TRACK.elements.map((e, i) => (i === 3 ? { ...e, role: 'follow' } : e)) })
    expect(cell(3, 'Länge').editable).toBe(true)
    expect(cell(3, 'Länge').note).toBe(undefined)
  })
})

describe('V_max (Entscheidung 372)', () => {
  const alone = (el) => ({ id: `t-${projects}`, name: 'Gleis 5', epsg: 5678, elements: [el] })

  it('is the fastest speed on the 5 km/h step the rule catalogue finds no error at', () => {
    // R 500, cant 100: u_f 113 mm at 95 km/h, 136 at 100 — past LP.KB.02's 130.
    expect(renderTable(alone(arc({ radius: 500, cant: 100, length: 400 }))).cell(0, 'V_max').text).toBe('95')
  })

  it('reads the joints at both ends — a curvature jump holds the arc to its comparison radius', () => {
    // The same arc running straight into a straight (LP.KS.01, r_w = 500 m): 65 km/h.
    expect(renderTable().cell(0, 'V_max').text).toBe('65')
  })

  it('holds a switch route to the switch’s own, lower deficiency', () => {
    // R −500 with −40 mm of cant following the curve: 93 mm at 75 km/h, 111 at 80 — past LP.KB.06's 110.
    const route = arc({ radius: -500, cant: -40, length: 400, switchBranch: true, switchId: 'sw1', switchRoute: 'branch' })
    expect(renderTable(alone(route)).cell(0, 'V_max').text).toBe('75')
  })

  it('does not let an error no speed removes hold it down, and marks it', () => {
    const { cell } = renderTable({ id: 't-step', name: 'Gleis 5', epsg: 5678, elements: [arc({ radius: 500, cant: 63, length: 400 })] })
    expect(cell(0, 'V_max').mark).toBe('input-error')
    expect(cell(0, 'V_max').note).toContain('LP.KB.03')
    expect(Number(cell(0, 'V_max').text)).toBeGreaterThan(0)
  })
})

describe('the cant: one, or one at each end — never both (Entscheidung 373)', () => {
  const clothoid = (props) => ({ elementType: 2, bearing: 30.1, length: 60, speed: 100, geometry: GEOM, transitionType: 'clothoid', ...props })
  const track = {
    id: 't-cant', name: 'Gleis 6', epsg: 5678,
    elements: [straight({}), clothoid({ r1: null, r2: 500 }), arc({ radius: 500, cant: 60 }), arc({ radius: 800, cant: 40, cantStart: 40, cantEnd: 20 })],
  }

  it('shows an element of one cant in the cant column, and 0 where it has none', () => {
    const { cell } = renderTable(track)
    expect(cell(0, 'Überhöhung')).toMatchObject({ text: '0', editable: true })
    expect(cell(2, 'Überhöhung')).toMatchObject({ text: '60', editable: true })
    for (const column of ['Ü Anfang', 'Ü Ende']) expect(cell(2, column)).toMatchObject({ text: '', editable: false })
  })

  it('shows a transition and an arc with a ramp at their two ends, and the cant column empty', () => {
    const { cell } = renderTable(track)
    expect(cell(1, 'Überhöhung')).toMatchObject({ text: '', editable: false })
    expect(cell(1, 'Ü Anfang')).toMatchObject({ text: '0', editable: true })
    expect(cell(1, 'Ü Ende')).toMatchObject({ text: '60', editable: true })
    expect(cell(3, 'Überhöhung')).toMatchObject({ text: '', editable: false })
    expect([cell(3, 'Ü Anfang').text, cell(3, 'Ü Ende').text]).toEqual(['40', '20'])
  })
})

describe('the element role (Entscheidung 375)', () => {
  // straight · arc · straight · straight
  const track = (roles = {}) => ({
    id: `t-role-${projects}`, name: 'Gleis 9', epsg: 5678,
    elements: [straight({}), arc({ radius: 800, cant: 0 }), straight({}), straight({})].map((e, i) => (roles[i] ? { ...e, role: roles[i] } : e)),
  })

  it('makes every element a Festelement where none states a role: length and radius are locked', () => {
    const { cell } = renderTable(track())
    for (const i of [0, 1, 2, 3]) {
      expect(cell(i, 'Elementtyp').text).toBe('fixed')
      expect(cell(i, 'Länge').editable).toBe(false)
      expect(cell(i, 'Radius').editable).toBe(false)
    }
    expect(cell(1, 'Länge').note).toBe(t('table_locked_fixed'))
  })

  it('makes every element after a Folgeelement one too, its role then not to choose', () => {
    const { cell } = renderTable(track({ 1: 'follow' }))
    expect(cell(0, 'Länge').editable).toBe(false)
    expect([1, 2, 3].map(i => cell(i, 'Länge').editable)).toEqual([true, true, true])
    expect(cell(1, 'Elementtyp').editable).toBe(true)
    expect(cell(2, 'Elementtyp')).toMatchObject({ text: 'follow', editable: false })
  })

  it('gives a Zwischenelement its radius and locks its length and its neighbours\'', () => {
    const { cell } = renderTable(track({ 1: 'intermediate' }))
    expect(cell(1, 'Radius').editable).toBe(true)
    expect(cell(1, 'Länge').editable).toBe(false)
    expect(cell(0, 'Elementtyp')).toMatchObject({ text: 'follow', editable: false })
    expect(cell(2, 'Elementtyp')).toMatchObject({ text: 'follow', editable: false })
    expect(cell(3, 'Elementtyp')).toMatchObject({ text: 'fixed', editable: true })
    expect(cell(0, 'Länge').note).toBe('Wird mit Zwischenelement 2 berechnet.')
  })
})

describe('the CRS column', () => {
  it('states the plane the track’s coordinates are in, and names it in full', () => {
    const { cell } = renderTable()
    expect(cell(0, 'EPSG').text).toBe('5678')
    expect(cell(0, 'EPSG').note).toBe('EPSG 5678 – DHDN / GK Zone 4')
  })

  it('follows the track, which is the one that holds the code', () => {
    const { cell } = renderTable({ ...TRACK, epsg: 25832 })
    expect(cell(0, 'EPSG').text).toBe('25832')
    expect(cell(0, 'EPSG').note).toBe('EPSG 25832 – ETRS89 / UTM Zone 32N')
  })
})

describe('the station column', () => {
  it('runs the elements out from the start of the track', () => {
    const { cell } = renderTable()
    expect([0, 1, 2, 3].map(i => cell(i, 'Station').text)).toEqual(['0', '150', '183,2', '333,2'])
  })

  it('is read-only — it follows the lengths, it does not set them', () => {
    expect(renderTable().cell(1, 'Station').editable).toBe(false)
  })

  it('adds up to the track’s length, which the title carries', () => {
    const { html } = renderTable()
    expect(html).toContain('>583,2 m<')
  })
})

describe('the radius of a switch route', () => {
  it('is read like its length — both are the form’s dimensions', () => {
    const { cell } = renderTable()
    expect(cell(2, 'Radius').editable).toBe(false)
    expect(cell(2, 'Radius').text).toBe('-500')
    expect(cell(2, 'Radius').note).toBe('Von der Bauform der Weiche gesetzt – hier nicht änderbar')
  })

  it('leaves the radius of plain running line editable, on a Folgeelement', () => {
    const track = { ...TRACK, id: 't-follow0', elements: [{ ...TRACK.elements[0], role: 'follow' }, ...TRACK.elements.slice(1)] }
    expect(renderTable(track).cell(0, 'Radius').editable).toBe(true)
  })
})

describe('a deficiency the speed is too high for', () => {
  it('marks the speed and the deficiency it makes, and says what V_max would be', () => {
    const { cell } = renderTable()
    // R 500, u 100, v 100 → 136 mm, past the 130 LP.KB.02 allows below
    // 150 km/h. Before AP R.8 this was the amber "design reserve" mark; there
    // is no reserve any more, so it is the error it always was to the Ril.
    expect(cell(0, 'Fehlbetrag').text).toBe('136')
    expect(cell(0, 'Fehlbetrag').mark).toBe('input-error')
    expect(cell(0, 'Speed').mark).toBe('input-error')
    expect(cell(0, 'Speed').note).toContain('V_max wäre 65 km/h')
  })

  it('lets a deficiency stand above 150 km/h that is an error below it', () => {
    // R 2000 with no cant: 133 mm at 150 km/h — past the 130 the Ril allows
    // there — and 142 mm at 155, inside the 150 it allows once past the step.
    const at = (speed) => ({
      id: `t-${speed}`, name: 'Gleis 4', epsg: 5678,
      elements: [arc({ radius: 2000, cant: 0, speed })],
    })
    const slow = renderTable(at(150))
    expect(slow.cell(0, 'Fehlbetrag').text).toBe('133')
    expect(slow.cell(0, 'Fehlbetrag').mark).toBe('input-error')
    const fast = renderTable(at(155))
    expect(fast.cell(0, 'Fehlbetrag').text).toBe('142')
    expect(fast.cell(0, 'Fehlbetrag').mark).toBe('')
  })

  it('calls a deficiency past the buildable limit an error', () => {
    const { cell } = renderTable()
    expect(cell(4, 'Fehlbetrag').text).toBe('236')
    expect(cell(4, 'Fehlbetrag').mark).toBe('input-error')
    expect(cell(4, 'Speed').mark).toBe('input-error')
  })

  it('says nothing where the design holds', () => {
    const { cell } = renderTable()
    expect(cell(3, 'Fehlbetrag').mark).toBe('')
    expect(cell(3, 'Speed').mark).toBe('')
    expect(cell(3, 'Speed').note).toBe(undefined)
  })
})

describe('saving', () => {
  it('is nothing to press while the table holds no edits', () => {
    const { html } = renderTable()
    expect(/class="track-table-save-btn"[^>]*disabled/.test(html)).toBe(true)
  })
})

describe('the rule column', () => {
  it('states the worst the catalogue found, and names every finding behind it', () => {
    const { cell } = renderTable()
    // 100 km/h through R 500 on 100 mm of cant: 136 mm of deficiency, past the
    // 130 the rulebook allows — and the Regelüberhöhung there is 130, not 100.
    expect(cell(0, 'Regeln').text).toContain('Fehler (')
    expect(cell(0, 'Regeln').text).toContain('Hinweise (')
    expect(cell(0, 'Regeln').note).toContain('LP.KB.02')
    expect(cell(0, 'Regeln').note).toContain('LP.KB.04')
  })

  // R 1000 with 30 mm of cant at 100 km/h: LP.KB.04 says the Regelüberhöhung is 65 — a Hinweis, no error.
  const hinted = (reasons) => ({
    id: `t-hint-${projects}`, name: 'Gleis 7', epsg: 5678,
    elements: [arc({ radius: 1000, cant: 30, length: 400, ...(reasons ? { reasons } : {}) })],
  })
  const buttons = (html) => [...html.matchAll(/<button[^>]*class="track-table-rule-btn ([^"]*)"[^>]*>([^<]*)<\/button>/g)].map(m => [m[2], m[1]])

  it('shows the Hinweise red until each has its reason (Entscheidung 374)', () => {
    const { html } = renderTable(hinted())
    expect(buttons(html)).toEqual([['Hinweise (1)', 'rule-sev-error']])
  })

  it('turns them green with a tick once they are all justified', () => {
    const { html } = renderTable(hinted({ 'LP.KB.04': 'Bestandsüberhöhung, Anpassung erst mit Umbau' }))
    expect(buttons(html)).toEqual([['✓ Hinweise (1)', 'rule-sev-ok']])
  })

  it('lets a switch route open the dialog for its cant exception even where nothing fired', () => {
    const route = arc({ radius: 1000, cant: 65, length: 400, switchBranch: true, switchId: 'sw1', switchRoute: 'branch', speed: 60 })
    const { html } = renderTable({ id: 't-sw', name: 'Gleis 8', epsg: 5678, elements: [route] })
    expect(buttons(html).length).toBe(1)
  })

  it('has no column of its own for the cant exception any more', () => {
    expect(renderTable().columns.some(c => c.startsWith('Ausnahme'))).toBe(false)
  })

  it('ticks a row that keeps every rule it was measured against', () => {
    const clean = {
      id: 't2', name: 'Gleis 2', epsg: 5678,
      elements: [
        straight({ cant: 0 }),
        // A clothoid long enough for the cant ramp it carries (65 mm at 100 km/h).
        { elementType: 2, bearing: 30.1, endBearing: 30.1, length: 65, speed: 100, r1: null, r2: 1000, geometry: GEOM },
        arc({ radius: 1000, cant: 65 }),
      ],
    }
    const { cell } = renderTable(clean)
    expect(cell(2, 'Regeln').text).toBe('✓')
    expect(cell(2, 'Regeln').note).toBe(t('table_rules_ok'))
  })

  it('says outright where there is no design speed to judge by', () => {
    const { cell } = renderTable({ ...TRACK, id: 't3', elements: [straight({ speed: 0 })] })
    expect(cell(0, 'Regeln').text).toBe('–')
    expect(cell(0, 'Regeln').note).toBe(t('table_rules_unchecked'))
  })
})
