import { describe, it, expect, beforeAll } from 'vitest'
import { loadTracks, openProject, undo, updateTrack } from '../storage'
import { trackOf } from '../utils/commands/tracks'
import { buildSwitchOnTrack, switchOnTrackPlacement } from '../utils/commands/switches'
import { straightFrom } from '../utils/geometry/elementFactory'
import { cantEnds, withCantEdit } from '../utils/geometry/clothoidUtils'
import { SWITCH_TYPES, switchStraightLength } from '../utils/switch/catalogue'
import { coupleSwitchCants } from '../utils/switch/switchCants'

// A turnout's two routes carry one cant, whichever is edited (Entscheidung 376).

const EPSG = 25832
const START = { easting: 500000, northing: 5600000, zone: EPSG }
const FORM = SWITCH_TYPES.find(f => f.label === '760 – 1:14')

/** A straight host track of 400 m with a 760 – 1:14 laid at station 150: { tracks, switches }. */
function laid({ reversed = false } = {}) {
  const host = trackOf([{ ...straightFrom(START, 30, 400), speed: 100 }], EPSG, { name: 'line.001' }, 'host')
  const straightLen = switchStraightLength(FORM)
  const placement = switchOnTrackPlacement({ track: host, toeStation: 150, reversed, sw: FORM, side: 'right', straightLen })
  expect(placement.error).toBeNull()
  const commit = buildSwitchOnTrack({
    track: host, tracks: [host], place: placement.place, g: placement.geom, plain: placement.plain,
    sw: FORM, straightLen, cant: 0, cantReason: '', speed: 100,
    switchName: 'W 1', switchNumber: 1, name: 'branch.001', fields: { owner: 'DB', type: 'station_track' },
  })
  return { tracks: commit.addTracks, switches: commit.addSwitches }
}

const routeOf = (tracks, route) => {
  for (const tr of tracks) {
    const idx = tr.elements.map((el, i) => (el.switchRoute === route ? i : -1)).filter(i => i >= 0)
    if (idx.length) return { track: tr, idx }
  }
  return null
}
const endsOf = (track) => track.elements.map((el, i) => { const e = cantEnds(track.elements, i); return [e.start, e.end] })
const withTrack = (tracks, track) => tracks.map(t => (t.id === track.id ? track : t))
const flat = (pairs) => pairs.flat()

describe('the cant of a turnout\'s two routes', () => {
  it('follows the main route on the branch, and on the track up to the toe', () => {
    const { tracks, switches } = laid()
    const main = routeOf(tracks, 'main')
    const edited = { ...main.track, elements: withCantEdit(main.track.elements, main.idx[0], 'cant', 30) }
    const after = coupleSwitchCants(tracks, withTrack(tracks, edited), switches)
    const branch = routeOf(after, 'branch')
    expect(flat(branch.idx.map(i => endsOf(branch.track)[i]))).toEqual(branch.idx.flatMap(() => [30, 30]))
    const approach = after.find(t => t.id !== main.track.id && t.id !== branch.track.id)
    expect(endsOf(approach).at(-1)[1]).toBe(30)
  })

  it('follows the branch on the main route, carried on along its track', () => {
    const { tracks, switches } = laid()
    const branch = routeOf(tracks, 'branch')
    const edited = { ...branch.track, elements: withCantEdit(branch.track.elements, branch.idx[0], 'cant', 20) }
    const after = coupleSwitchCants(tracks, withTrack(tracks, edited), switches)
    const main = routeOf(after, 'main')
    expect(flat(endsOf(main.track))).toEqual(main.track.elements.flatMap(() => [20, 20]))
  })

  it('turns the sign where a track runs the other way from the toe', () => {
    const { tracks, switches } = laid({ reversed: true })
    const main = routeOf(tracks, 'main')
    const branch = routeOf(tracks, 'branch')
    const edited = { ...main.track, elements: withCantEdit(main.track.elements, main.idx[0], 'cant', 30) }
    const after = coupleSwitchCants(tracks, withTrack(tracks, edited), switches)
    // Opened against the host track, the branch runs the other way: the same
    // raised rail is the other sign on it. The track behind the toe runs on
    // as the host does, so it keeps the sign.
    const b = after.find(t => t.id === branch.track.id)
    expect(Math.abs(b.elements[0].bearing - main.track.elements[main.idx[0]].bearing)).toBeCloseTo(180, 0)
    expect(flat(endsOf(b))).toEqual(b.elements.flatMap(() => [-30, -30]))
    const approach = after.find(t => t.id !== main.track.id && t.id !== branch.track.id)
    expect(endsOf(approach)[0][0]).toBe(30)
  })

  it('leaves the tracks as they are where the write changed no cant on either route', () => {
    const { tracks, switches } = laid()
    const main = routeOf(tracks, 'main')
    const sped = { ...main.track, elements: main.track.elements.map(el => ({ ...el, speed: 80 })) }
    const after = withTrack(tracks, sped)
    expect(coupleSwitchCants(tracks, after, switches)).toBe(after)
  })
})

describe('the store', () => {
  beforeAll(() => {
    const store = new Map()
    globalThis.localStorage = {
      getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k),
      key: (i) => [...store.keys()][i] ?? null, get length() { return store.size },
    }
  })

  it('couples the other route in the same write, and one undo takes back both', () => {
    const { tracks, switches } = laid()
    openProject({ id: 'cants-1', tracks, switches })
    const main = routeOf(loadTracks(), 'main')
    updateTrack({ ...main.track, elements: withCantEdit(main.track.elements, main.idx[0], 'cant', 25) })
    const branch = routeOf(loadTracks(), 'branch')
    expect(cantEnds(branch.track.elements, branch.idx[0])).toEqual({ start: 25, end: 25 })
    undo()
    const back = routeOf(loadTracks(), 'branch')
    expect(cantEnds(back.track.elements, back.idx[0])).toEqual({ start: 0, end: 0 })
  })
})
