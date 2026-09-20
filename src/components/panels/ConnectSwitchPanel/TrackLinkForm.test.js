import { describe, it, expect, beforeAll } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { saveProject } from '../../../storage'
import { endPointStraightUtm } from '../../../utils/elementUtils'
import {
  transformPlanePoint, transformGridBearing, utmToWgs84,
} from '../../../utils/coordinateUtils'
import { findTrackJoints, linkRecord } from '../../../utils/trackLinkUtils'
import translations from '../../../locales/de.json'
import TrackLinkForm from './TrackLinkForm'

/**
 * What the link form says before it writes anything. The static renderer runs
 * the component body without a DOM, which is all this form needs to be judged
 * on: the scan runs while it renders, and what it found is the markup.
 */

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

const UTM = 25832, GK = 5683
const E0 = 500000, N0 = 5600000

function straight(id, epsg, easting, northing, bearing, length, name) {
  const start = { easting, northing, zone: epsg }
  const end   = endPointStraightUtm(start, bearing, length)
  return {
    id, name, epsg,
    elements: [{
      elementType: 0, length, bearing, endBearing: bearing, absLength: length,
      startNode: [start.easting, start.northing],
      endNode:   [end.easting, end.northing],
      geometry: { type: 'LineString', coordinates: [
        utmToWgs84(start.easting, start.northing, epsg),
        utmToWgs84(end.easting, end.northing, epsg),
      ] },
    }],
  }
}

/** Two tracks, one per plane, meeting where the survey changed system. */
function acrossThePlanes() {
  const a = straight('a', UTM, E0, N0, 40, 300, 'Gleis A')
  const [ae, an] = a.elements[0].endNode
  const [be, bn] = transformPlanePoint(ae, an, UTM, GK)
  const bearing  = transformGridBearing(ae, an, 40, UTM, GK)
  return [a, straight('b', GK, be, bn, bearing, 250, 'Gleis B')]
}

const t = (key) => translations[key] ?? key

let projects = 0
function render(tracks, switches = []) {
  const id = `link-p${++projects}`
  saveProject({ id, tracks, switches })
  const html = renderToStaticMarkup(createElement(TrackLinkForm, {
    t, map: { current: null }, project: { id },
    onTrackSaved: () => {}, onCommitted: () => {},
  }))
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim()
  return { html, text }
}

describe('the link form before it writes anything', () => {
  it('reports what it found and offers to write exactly that', () => {
    const { text } = render(acrossThePlanes())
    expect(text).toContain('Gefunden: 1 (davon 1 mit Systemwechsel)')
    expect(text).toContain('Gleis A END ↔ Gleis B BEGIN')
    expect(text).toContain('Verknüpfen (1)')
  })

  it('names the two planes on the joints that have no alternative', () => {
    const { html } = render(acrossThePlanes())
    expect(html).toContain('Systemwechsel')
    expect(html).toContain('title="ETRS89 / UTM Zone 32N → DB_REF / GK Zone 3"')
  })

  it('says how far apart the two frames put the node', () => {
    // The two statements of this node agree exactly, so the joint is 0 mm wide
    // but for what the transformation costs — under a millimetre either way.
    const { text } = render(acrossThePlanes())
    expect(text).toMatch(/[01] mm auseinander/)
  })

  it('has nothing to offer where every end is already a switch’s', () => {
    const tracks = acrossThePlanes()
    const sw = {
      switchId: 'sw1', kind: 'turnout', formVersion: 1, name: 'W 1',
      portA_trackId: 'a', portA_endpoint: 'END',
      portB1_trackId: 'b', portB1_endpoint: 'BEGIN',
    }
    const { text } = render(tracks, [sw])
    expect(text).toContain('Keine offenen Gleisenden gefunden')
    expect(text).not.toContain('Verknüpfen (')
  })

  it('says when it stepped over a junction rather than linking it', () => {
    const [a, b] = acrossThePlanes()
    const [ae, an] = a.elements[0].endNode
    const c = straight('c', UTM, ae, an, 220, 200, 'Gleis C')
    const { text } = render([a, b, c])
    expect(text).toContain('Übergangen: 1 mit mehr als zwei Gleisenden')
    expect(text).toContain('Keine offenen Gleisenden gefunden')
  })

  it('lists the links the project already has, with the distance of their ends', () => {
    const tracks = acrossThePlanes()
    const joint = findTrackJoints(tracks, []).joints[0]
    const { text } = render(tracks, [linkRecord(joint, 'link.001')])
    expect(text).toContain('Verknüpfungen: 1 (davon 1 mit Systemwechsel)')
    expect(text).toContain('link.001: Gleis A END ↔ Gleis B BEGIN')
    expect(text).toMatch(/link\.001:[^·]+· [01] mm auseinander/)
    // Its ends are taken, so it is not offered a second time.
    expect(text).toContain('Keine offenen Gleisenden gefunden')
  })

  it('says so where a link points at a track that is gone', () => {
    const tracks = acrossThePlanes()
    const joint = findTrackJoints(tracks, []).joints[0]
    const broken = { ...linkRecord(joint, 'link.009'), portA_trackId: 'weg' }
    const { text } = render(tracks, [broken])
    expect(text).toContain('(Gleis fehlt)')
    expect(text).toContain('Abstand unbekannt')
  })
})
