import { describe, expect, it } from 'vitest'
import { hasPek, loadPek } from '../test/pekFixture'
import { newFindings, overlappingTracks, validateProject } from './validateProject'

// A straight along +x in a metric plane: n elements of `len` metres each.
function straightTrack(id, { x = 0, y = 0, n = 2, len = 50, epsg = 25832 } = {}) {
  const elements = []
  for (let i = 0; i < n; i++) {
    elements.push({
      elementType: 0, bearing: 90, length: len, absLength: len * (i + 1),
      startNode: [x + i * len, y], endNode: [x + (i + 1) * len, y],
    })
  }
  return { id, name: id, epsg, elements }
}

const turnout = (switchId, a, b1, b2) => ({
  switchId, kind: 'turnout', formVersion: 1, name: switchId,
  portA_trackId: a[0], portA_endpoint: a[1],
  portB1_trackId: b1[0], portB1_endpoint: b1[1],
  portB2_trackId: b2[0], portB2_endpoint: b2[1],
})

function project() {
  return {
    id: 'p',
    tracks: [straightTrack('t1'), straightTrack('t2', { y: 100 }), straightTrack('t3', { y: 200 })],
    switches: [turnout('w1', ['t1', 'END'], ['t2', 'BEGIN'], ['t3', 'BEGIN'])],
    platforms: [{ id: 'pf', trackId: 't1', startStation: 10, endStation: 60, side: 'left' }],
    endMarks: [{ id: 'm', kind: 'bufferStop', trackId: 't1', endpoint: 'BEGIN' }],
  }
}

const codes = (r) => r.errors.map(e => e.code)

describe('validateProject', () => {
  it('passes a sound project', () => {
    expect(validateProject(project())).toEqual({ errors: [], warnings: [] })
  })

  it('a port on a track that is not there', () => {
    const p = project()
    p.switches[0].portB1_trackId = 'gone'
    expect(validateProject(p).errors).toEqual([expect.objectContaining({
      code: 'port_track_missing', collection: 'switches', id: 'w1', params: { port: 'B1', trackId: 'gone' },
    })])
  })

  it('a port without a valid end', () => {
    const p = project()
    p.switches[0].portA_endpoint = 'MIDDLE'
    expect(codes(validateProject(p))).toEqual(['port_endpoint_invalid'])
  })

  it('a track end held by two ports', () => {
    const p = project()
    p.tracks.push(straightTrack('t4', { y: 300 }), straightTrack('t5', { y: 400 }))
    p.switches.push(turnout('w2', ['t1', 'END'], ['t4', 'BEGIN'], ['t5', 'BEGIN']))
    expect(codes(validateProject(p))).toEqual(['end_held_twice'])
  })

  it('an element naming a switch there is not', () => {
    const p = project()
    p.tracks[1].elements[0].switchBranch = true
    p.tracks[1].elements[0].switchId = 'nowhere'
    expect(validateProject(p).errors).toEqual([expect.objectContaining({ code: 'element_switch_missing', id: 't2' })])
  })

  it('a platform without its track, or beyond its length', () => {
    const p = project()
    p.platforms[0].trackId = 'gone'
    expect(codes(validateProject(p))).toEqual(['platform_track_missing'])
    p.platforms[0].trackId = 't1'
    p.platforms[0].endStation = 120
    expect(codes(validateProject(p))).toEqual(['platform_out_of_range'])
  })

  it('heights outside the track or not rising', () => {
    const p = project()
    p.tracks[0].heights = [{ station: 0, height: 80 }, { station: 150, height: 81 }]
    expect(codes(validateProject(p))).toEqual(['height_out_of_range'])
    p.tracks[0].heights = [{ station: 0, height: 80 }, { station: 50, height: 81 }, { station: 50, height: 82 }]
    expect(codes(validateProject(p))).toEqual(['height_not_rising'])
  })

  it('an end mark on an end a switch holds, on no track, or twice on one end', () => {
    const p = project()
    p.endMarks[0].endpoint = 'END'
    expect(codes(validateProject(p))).toEqual(['end_mark_not_free'])
    p.endMarks[0] = { id: 'm', kind: 'bufferStop', trackId: 'gone', endpoint: 'END' }
    expect(codes(validateProject(p))).toEqual(['end_mark_track_missing'])
    p.endMarks = [
      { id: 'm1', kind: 'bufferStop', trackId: 't2', endpoint: 'END' },
      { id: 'm2', kind: 'boundary', trackId: 't2', endpoint: 'END' },
    ]
    expect(codes(validateProject(p))).toEqual(['end_mark_twice'])
  })

  it('a broken chain is an error, a gap of survey noise a warning', () => {
    const p = project()
    p.tracks[2].elements[1].startNode = [50, 200.05]
    const r = validateProject(p)
    expect(r.errors).toEqual([])
    // The moved node also makes the straight's stated length untrue.
    expect(r.warnings.map(w => w.code)).toContain('chain_gap')
    p.tracks[2].elements[1].startNode = [50, 201]
    expect(codes(validateProject(p))).toEqual(['chain_gap'])
  })

  it('absLength that is not the running length', () => {
    const p = project()
    p.tracks[0].elements[1].absLength = 90
    expect(codes(validateProject(p))).toEqual(['chain_abs_length'])
  })

  it('an element in another plane than its track', () => {
    const p = project()
    p.tracks[0].elements[0].epsg = 5684
    expect(codes(validateProject(p))).toEqual(['chain_epsg'])
  })

  it('warns of two tracks lying on each other, but not of a turnout\'s routes', () => {
    const p = project()
    p.tracks.push(straightTrack('dup', { y: 200.3, x: 20, n: 1, len: 40 }))
    const r = validateProject(p)
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual([expect.objectContaining({ code: 'tracks_overlap', params: expect.objectContaining({ otherId: 't3' }) })])
    // The same two, once a switch joins them, are a turnout's routes.
    expect(overlappingTracks(p.tracks, [turnout('w', ['t1', 'END'], ['dup', 'BEGIN'], ['t3', 'BEGIN'])])).toEqual([])
  })

  it('newFindings names only what is new', () => {
    const p = project()
    const before = validateProject(p).errors
    p.platforms[0].trackId = 'gone'
    expect(newFindings(validateProject(p).errors, before).map(f => f.code)).toEqual(['platform_track_missing'])
    expect(newFindings(validateProject(p).errors, validateProject(p).errors)).toEqual([])
  })
})

describe.skipIf(!hasPek)('validateProject — PEK Halle–Könnern', () => {
  it('finds no error in the unchanged data set', () => {
    const { errors, warnings } = validateProject(loadPek())
    expect(errors).toEqual([])
    // Survey noise of the import, not a fault: the 9 cm gap and three arcs
    // whose stated length is not their chord's.
    expect(warnings.map(w => w.code).sort()).toEqual(['chain_gap', 'chain_length', 'chain_length', 'chain_length'])
  })
})

describe('overlappingTracks — tracks parting from a common end', () => {
  it('does not take two tracks that leave one node apart for a track drawn twice', () => {
    // Two routes from one node, the second turning away slowly (a turnout whose switch is gone).
    const straightA = straightTrack('a', { n: 4, len: 50 })
    const curve = { id: 'b', name: 'b', epsg: 25832, elements: [] }
    const R = 300, L = 150
    const end = [R * Math.sin(L / R), R - R * Math.cos(L / R)]
    curve.elements.push({ elementType: 1, bearing: 90, radius: -R, length: L, absLength: L, startNode: [0, 0], endNode: [end[0], end[1]] })
    expect(overlappingTracks([straightA, curve], [])).toEqual([])
    // A copy of `a` from the same node is a track drawn twice.
    expect(overlappingTracks([straightA, { ...straightTrack('a2', { n: 4, len: 50 }) }], [])).toHaveLength(1)
  })
})
