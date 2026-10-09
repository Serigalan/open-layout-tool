import { describe, it, expect } from 'vitest'
import { tracksOnFrom } from './topology'
import { endPointStraightUtm } from './elementUtils'
import { utmToWgs84 } from './coordinateUtils'
import { newSwitchFields, LINK_KIND } from './switchModel'
import { hasPek, loadPekBestand } from '../test/pekFixture'

/**
 * Where the cross section walks on at a track's end (tracksOnFrom): the tracks
 * a train could carry on to there — over a joint, a link or a switch's routes.
 */

const UTM = 25832
const E0 = 500000, N0 = 5600000

function straight(id, easting, northing, bearing, length, epsg = UTM) {
  const start = { easting, northing, zone: epsg }
  const end   = endPointStraightUtm(start, bearing, length)
  return {
    id, name: id, epsg,
    elements: [{
      elementType: 0, length, bearing, endBearing: bearing,
      startNode: [start.easting, start.northing],
      endNode:   [end.easting, end.northing],
      absLength: length,
      geometry: { type: 'LineString', coordinates: [
        utmToWgs84(start.easting, start.northing, epsg),
        utmToWgs84(end.easting, end.northing, epsg),
      ] },
    }],
  }
}

const turnout = (a, b1, b2) => ({
  ...newSwitchFields(), name: 'W1',
  portA_trackId: a[0], portA_endpoint: a[1],
  portB1_trackId: b1[0], portB1_endpoint: b1[1],
  portB2_trackId: b2[0], portB2_endpoint: b2[1],
})

describe('tracksOnFrom', () => {
  it('walks on over a joint to the track laid end to end, and back', () => {
    const a = straight('a', E0, N0, 90, 100)
    const b = straight('b', E0 + 100, N0, 90, 50)
    expect(tracksOnFrom('a', 'END', [a, b], [])).toEqual([{ trackId: 'b', endpoint: 'BEGIN' }])
    expect(tracksOnFrom('b', 'BEGIN', [a, b], [])).toEqual([{ trackId: 'a', endpoint: 'END' }])
    expect(tracksOnFrom('a', 'BEGIN', [a, b], [])).toEqual([])
  })

  it('meets a track that runs the other way at its end', () => {
    const a = straight('a', E0, N0, 90, 100)
    const b = straight('b', E0 + 150, N0, 270, 50)
    expect(tracksOnFrom('a', 'END', [a, b], [])).toEqual([{ trackId: 'b', endpoint: 'END' }])
  })

  it('finds no joint where three ends meet', () => {
    const a = straight('a', E0, N0, 90, 100)
    const b = straight('b', E0 + 100, N0, 90, 50)
    const c = straight('c', E0 + 100, N0, 80, 50)
    expect(tracksOnFrom('a', 'END', [a, b, c], [])).toEqual([])
  })

  it('leads from a turnout toe into both routes (the through route first), and from a branch back to the toe', () => {
    const a = straight('a', E0, N0, 90, 100)
    const b1 = straight('b1', E0 + 100, N0, 85, 50)
    const b2 = straight('b2', E0 + 100, N0, 90, 50)
    const sw = turnout(['a', 'END'], ['b1', 'BEGIN'], ['b2', 'BEGIN'])
    const tracks = [a, b1, b2]
    expect(tracksOnFrom('a', 'END', tracks, [sw])).toEqual([
      { trackId: 'b2', endpoint: 'BEGIN' }, { trackId: 'b1', endpoint: 'BEGIN' },
    ])
    expect(tracksOnFrom('b1', 'BEGIN', tracks, [sw])).toEqual([{ trackId: 'a', endpoint: 'END' }])
    expect(tracksOnFrom('b2', 'BEGIN', tracks, [sw])).toEqual([{ trackId: 'a', endpoint: 'END' }])
  })

  it('crosses a link into the other plane', () => {
    const a = straight('a', E0, N0, 90, 100)
    const b = straight('b', E0 + 100, N0, 90, 50, 25833)
    const link = {
      ...newSwitchFields(LINK_KIND), name: 'L1',
      portA_trackId: 'a', portA_endpoint: 'END', portB_trackId: 'b', portB_endpoint: 'BEGIN',
    }
    expect(tracksOnFrom('a', 'END', [a, b], [link])).toEqual([{ trackId: 'b', endpoint: 'BEGIN' }])
  })

  it.skipIf(!hasPek)('finds every turnout toe of the Bestand leading into two tracks', () => {
    const { tracks, switches } = loadPekBestand()
    const turnouts = switches.filter(sw => sw.kind === 'turnout' && sw.portA_trackId)
    expect(turnouts.length).toBeGreaterThan(0)
    for (const sw of turnouts) {
      const on = tracksOnFrom(sw.portA_trackId, sw.portA_endpoint, tracks, switches)
      expect(on.map(o => o.trackId).sort()).toEqual([sw.portB1_trackId, sw.portB2_trackId].sort())
    }
  })
})
