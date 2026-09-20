import { describe, it, expect, beforeAll } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { saveProject } from '../storage'
import translations from '../locales/de.json'
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
    straight({ switchBranch: true, switchId: 'sw1', switchRoute: 'main', switchLabel: '500 – 1:12', speed: 60 }),
    arc({ radius: -500, cant: -40, switchBranch: true, switchId: 'sw1', switchRoute: 'branch', speed: 60 }),
    straight({ switchHint: 'EW 190-1:9 nicht gebaut' }),
  ],
}
const SWITCH = { switchId: 'sw1', kind: 'turnout', name: 'W 12', label: '500 – 1:12', formVersion: 1 }

const t = (key) => translations[key] ?? key

/**
 * The table's columns, and its rows as one { text, editable, note } per cell.
 * Each render gets a project of its own — saveProject appends, so a second one
 * under the same id would leave the first standing in front of it.
 */
let projects = 0
function renderTable(track = TRACK) {
  const id = `p${++projects}`
  saveProject({ id, tracks: [track], switches: [SWITCH] })
  const html = renderToStaticMarkup(createElement(TrackTableOverlay, {
    track, project: { id }, map: { current: null }, t,
    onPickTrack: () => {}, onClose: () => {}, onSaved: () => {},
  }))
  const columns = [...html.matchAll(/<th[^>]*>(.*?)<\/th>/g)].map(m => m[1].replace(/<[^>]+>/g, ''))
  const rows = html.match(/<tr[^>]*>(?:(?!<\/tr>).)*<\/tr>/g).slice(1).map(row =>
    [...row.matchAll(/<td([^>]*)>(.*?)<\/td>/g)].map(([, attrs, inner]) => {
      // An input cell says its value in the attribute; a plain one is its text.
      const value = /value="([^"]*)"/.exec(inner)
      const title = /title="([^"]*)"/.exec(attrs)
      return {
        text: value ? value[1] : inner.replace(/<[^>]+>/g, ''),
        editable: !inner.includes('disabled=""'),
        note: title ? title[1] : undefined,
      }
    }))
  const cell = (row, column) => rows[row][columns.findIndex(c => c.startsWith(column))]
  return { columns, rows, cell }
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
    expect(cell(0, 'Richtung').text).toBe('12.35')
  })

  it('leaves the fields that do shape an element editable', () => {
    const { cell } = renderTable()
    expect(cell(0, 'Länge').editable).toBe(true)
    expect(cell(0, 'Radius').editable).toBe(true)
    expect(cell(0, 'Speed').editable).toBe(true)
  })
})

describe('V_max', () => {
  it('is designed against u_f = 130 mm, not the 150 an element may reach', () => {
    const { cell } = renderTable()
    // R 500, cant 100: 130 mm admits 98 km/h, the old 150 mm would say 103.
    expect(cell(0, 'V_max').text).toBe('98')
  })

  it('holds a switch route to the switch’s own, lower deficiency', () => {
    const { cell } = renderTable()
    // R −500 with −40 mm of cant following the curve, at the 110 mm of a route.
    expect(cell(2, 'V_max').text).toBe('79')
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
