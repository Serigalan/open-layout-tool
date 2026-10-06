import { describe, it, expect } from 'vitest'
import { checkVertical, lineCategoryOf, verticalFindings } from './gradientCheck'
import { ruleById, evaluateRule } from './regelkatalog'

// A straight line track of `length` metres at `speed`, with the given height points.
const line = (heights, { speed = 100, length = 2000, ...rest } = {}) => ({
  id: 't1',
  trackType: 1,
  elements: [{ elementType: 0, length, speed }],
  heights,
  ...rest,
})

// The track `t1` runs from the branch of one turnout into the branch of another.
const switches = [
  { kind: 'turnout', portA_trackId: 'x', portA_endpoint: 'END', portB1_trackId: 't1', portB1_endpoint: 'BEGIN' },
  { kind: 'turnout', portA_trackId: 'y', portA_endpoint: 'BEGIN', portB1_trackId: 't1', portB1_endpoint: 'END' },
]

// A track connection 20 m long between those two turnouts: level to its
// middle, then rising at `ds` ‰.
const connecting = (ds, rv, { length = 20, ...rest } = {}) => line([
  { station: 0, z: 100 }, { station: length / 2, z: 100, ...(rv ? { rv } : {}) },
  { station: length, z: 100 + ds * length / 2000 },
], { length, ...rest })

const sev = (entry, id) => entry.results.find(r => r.id === id)?.severity ?? null

describe('the line category', () => {
  it('is the track\'s own, else the project\'s, else a main line', () => {
    expect(lineCategoryOf({ lineCategory: 's_bahn' }, { lineCategory: 'secondary' })).toBe('s_bahn')
    expect(lineCategoryOf({}, { lineCategory: 'secondary' })).toBe('secondary')
    expect(lineCategoryOf({ lineCategory: 'nonsense' }, null)).toBe('main')
  })
})

describe('HP.LN · gradient of a stretch', () => {
  const twoPoints = (z1) => [{ station: 0, z: 100 }, { station: 1000, z: 100 + z1 }]

  it('holds a main line to 12.5 ‰ and warns above', () => {
    expect(sev(checkVertical(line(twoPoints(12.5))).stretches[0], 'HP.LN.01')).toBe('ok')
    expect(sev(checkVertical(line(twoPoints(-12.6))).stretches[0], 'HP.LN.01')).toBe('warning')
  })

  it('allows 40 ‰ on a secondary line or an S-Bahn, the project deciding where the track does not', () => {
    const steep = line(twoPoints(30))
    expect(sev(checkVertical(steep, { project: { lineCategory: 'secondary' } }).stretches[0], 'HP.LN.01')).toBe('ok')
    expect(sev(checkVertical({ ...steep, lineCategory: 's_bahn' }).stretches[0], 'HP.LN.01')).toBe('ok')
    expect(sev(checkVertical({ ...line(twoPoints(40.1)), lineCategory: 's_bahn' }).stretches[0], 'HP.LN.01')).toBe('warning')
  })

  it('holds a station track to 2.5 ‰ over its whole length, whatever line it is on', () => {
    const station = { ...line(twoPoints(3)), trackType: 2, stationName: 'Halle' }
    const s = checkVertical(station).stretches[0]
    expect(sev(s, 'HP.LN.02')).toBe('warning')
    expect(sev(s, 'HP.LN.01')).toBeNull()
    expect(sev(checkVertical({ ...station, heights: twoPoints(2.5) }).stretches[0], 'HP.LN.02')).toBe('ok')
  })

  it('says nothing about tunnels, which cannot be stated yet', () => {
    const results = checkVertical(line(twoPoints(0))).stretches[0].results
    expect(results.map(r => r.id)).not.toContain('HP.LN.03')
  })

  it('states the tunnel minimum the Ril sets, by tunnel length', () => {
    const rule = ruleById('HP.LN.03')
    const at = (s, l) => evaluateRule(rule, { 'physics.gradient': s, 'model.tunnel_length': l },
      { inContext: id => id === 'tunnel' }).severity
    expect(at(2, 1000)).toBe('ok')
    expect(at(1.9, 1000)).toBe('warning')
    expect(at(3.9, 1001)).toBe('warning')
    expect(at(4, 1001)).toBe('ok')
  })
})

describe('HP.AR · rounding of a gradient change', () => {
  // A crest: up 10 ‰ to the middle, down 10 ‰ after it — Δs 20 ‰.
  const crest = (rv, { speed = 100, ...rest } = {}) => line([
    { station: 0, z: 100 }, { station: 1000, z: 110, ...(rv ? { rv } : {}) }, { station: 2000, z: 100 },
  ], { speed, ...rest })
  const curveOf = (track, opts) => checkVertical(track, opts).curves[0]

  it('wants a curve where the gradient changes by more than 1 ‰', () => {
    expect(sev(curveOf(crest(null)), 'HP.AR.01')).toBe('error')
    expect(sev(curveOf(crest(5000)), 'HP.AR.01')).toBe('ok')
  })

  it('wants none at 1 ‰ or less — 4.5 ‰ on a siding or a connecting track', () => {
    const small = (ds, rv, extra) => line([
      { station: 0, z: 100 }, { station: 1000, z: 100, ...(rv ? { rv } : {}) }, { station: 2000, z: 100 + ds },
    ], extra)
    expect(sev(curveOf(small(1, null)), 'HP.AR.01')).toBe('ok')
    expect(sev(curveOf(small(1, 20000)), 'HP.AR.01')).toBe('hint')
    expect(sev(curveOf(small(4, null)), 'HP.AR.01')).toBe('error')
    expect(sev(curveOf(small(4, null, { trackUse: 'siding' })), 'HP.AR.01')).toBe('ok')
    expect(sev(curveOf(connecting(4.5, null), { switches }), 'HP.AR.01')).toBe('ok')
    expect(sev(curveOf(connecting(4.6, null), { switches }), 'HP.AR.01')).toBe('error')
    // Longer than 20 m between the two switches, it is a track like any other.
    expect(sev(curveOf(connecting(4.5, null, { length: 21 }), { switches }), 'HP.AR.01')).toBe('error')
    // The turnouts' own branches on it do not count: 30 m of track, 10 of them between the switches.
    const crossover = connecting(4.5, null, { length: 30 })
    crossover.elements = [
      { elementType: 0, length: 10, speed: 100, switchId: 'w1' },
      { elementType: 0, length: 10, speed: 100 },
      { elementType: 0, length: 10, speed: 100, switchId: 'w2' },
    ]
    const own = [{ ...switches[0], switchId: 'w1' }, { ...switches[1], switchId: 'w2' }]
    expect(sev(curveOf(crossover, { switches: own }), 'HP.AR.01')).toBe('ok')
  })

  it('grades the radius of a crest by Tabelle 12 at 100 km/h', () => {
    // reg 0.4·v² = 4000, discretion 0.25·v² → 2500, approval 0.16·v² = 1600.
    const r = (rv) => sev(curveOf(crest(rv)), 'HP.AR.03')
    expect(r(4000)).toBe('ok')
    expect(r(3999)).toBe('warning')
    expect(r(2500)).toBe('warning')
    expect(r(2499)).toBe('approval')
    expect(r(1600)).toBe('approval')
    expect(r(1599)).toBe('error')
    expect(r(25001)).toBe('error')
  })

  it('holds a sag to 0.13·v² and the fast range to its fixed values', () => {
    const sag = (rv, speed) => line([
      { station: 0, z: 110 }, { station: 1000, z: 100, rv }, { station: 2000, z: 110 },
    ], { speed })
    expect(sev(curveOf(sag(1300, 100)), 'HP.AR.03')).toBe('approval')
    expect(sev(curveOf(sag(1299, 100)), 'HP.AR.03')).toBe('error')
    expect(sev(curveOf(sag(22500, 250)), 'HP.AR.03')).toBe('ok')
    expect(sev(curveOf(sag(14000, 250)), 'HP.AR.03')).toBe('warning')
    expect(sev(curveOf(sag(13999, 250)), 'HP.AR.03')).toBe('approval')
    expect(sev(curveOf(crest(15999, { speed: 250 })), 'HP.AR.03')).toBe('approval')
  })

  it('keeps the 2000 m floor in the Regelwert and Ermessensgrenze at low speed', () => {
    // 60 km/h: 0.4·v² = 1440, 0.25·v² = 900, 0.16·v² = 576.
    const r = (rv) => sev(curveOf(crest(rv, { speed: 60 })), 'HP.AR.03')
    expect(r(2000)).toBe('ok')
    expect(r(1999)).toBe('approval')
    expect(r(576)).toBe('approval')
    expect(r(575)).toBe('error')
  })

  it('wants the curve 20 m long, 10 m in a connecting track up to 80 km/h and 4.5 ‰', () => {
    const lengthOf = (rv, ds, extra, opts) => {
      const track = line([
        { station: 0, z: 100 }, { station: 500, z: 100, rv }, { station: 1000, z: 100 + ds / 2 },
      ], extra)
      return sev(curveOf(track, opts), 'HP.AR.02')
    }
    expect(lengthOf(10000, 2, {})).toBe('ok')          // la = 20 m
    expect(lengthOf(9000, 2, {})).toBe('warning')      // la = 18 m
    const inConnection = (rv, ds, speed, opts) => sev(curveOf(connecting(ds, rv, { speed }), opts), 'HP.AR.02')
    expect(inConnection(2500, 4, 80, { switches })).toBe('ok')     // la = 10 m
    expect(inConnection(2500, 4, 90, { switches })).toBe('warning')
    expect(inConnection(2500, 4, 80)).toBe('warning')
  })

  it('finds curves that do not fit between their points', () => {
    // Δs 20 ‰ at 30 000 m would need 300 m each side; there are 100.
    const tight = line([
      { station: 0, z: 100 }, { station: 100, z: 101, rv: 30000 }, { station: 200, z: 100 },
    ])
    expect(sev(curveOf(tight), 'HP.AR.04')).toBe('error')
    expect(sev(curveOf(crest(5000)), 'HP.AR.04')).toBe('ok')
  })

  it('wants changes kept out of cant ramps and switches, with the Regelwert where they cannot be', () => {
    // straight 0–900, transition ramping the cant 900–1100, arc after.
    const ramped = (rv) => ({
      id: 't1', trackType: 1,
      elements: [
        { elementType: 0, length: 900, speed: 100 },
        { elementType: 2, length: 200, speed: 100, r1: null, r2: 1000, cantStart: 0, cantEnd: 60 },
        { elementType: 1, length: 900, speed: 100, radius: 1000, cant: 60 },
      ],
      heights: [{ station: 0, z: 100 }, { station: 1000, z: 110, ...(rv ? { rv } : {}) }, { station: 2000, z: 100 }],
    })
    expect(sev(curveOf(ramped(4000)), 'HP.AR.05')).toBe('hint')
    expect(sev(curveOf(ramped(3000)), 'HP.AR.05')).toBe('warning')
    expect(sev(curveOf(crest(3000)), 'HP.AR.05')).toBeNull()
  })

  it('warns of any change between WA and WE where the form states no ldS, curve or not', () => {
    // A switch whose elements run from 900 to 1100 m.
    const inSwitch = (heights) => ({
      id: 't1', trackType: 1,
      elements: [
        { elementType: 0, length: 900, speed: 100 },
        { elementType: 0, length: 200, speed: 100, switchId: 's1' },
        { elementType: 0, length: 900, speed: 100 },
      ],
      heights,
    })
    const at = (station, rv) => [
      { station: 0, z: 100 }, { station, z: 101, ...(rv ? { rv } : {}) }, { station: 2000, z: 100 },
    ]
    expect(sev(curveOf(inSwitch(at(1000, 30000))), 'HP.AR.06')).toBe('warning')
    expect(sev(curveOf(inSwitch(at(1000, 30000))), 'HP.AR.05')).toBeNull()
    // Outside it, but its curve reaching in: T = 30000 · 2 ‰ / 2 = 30 m.
    expect(sev(curveOf(inSwitch(at(880, 30000))), 'HP.AR.06')).toBe('warning')
    expect(sev(curveOf(inSwitch(at(860, 30000))), 'HP.AR.06')).toBeNull()
    // A point on WA itself is not between WA and WE.
    expect(sev(curveOf(inSwitch(at(900, null))), 'HP.AR.06')).toBeNull()
  })

  it('leaves the speed rules out where the design speed is unknown', () => {
    const curve = curveOf(crest(5000, { speed: 0 }))
    expect(curve.unchecked).toBe(true)
    const ids = curve.results.map(r => r.id)
    expect(ids).toContain('HP.AR.01')
    expect(ids).not.toContain('HP.AR.03')
  })

  it('gathers findings per rule', () => {
    const many = line([
      { station: 0, z: 100 }, { station: 500, z: 105 }, { station: 1000, z: 100 }, { station: 1500, z: 105 },
    ])
    const found = verticalFindings(checkVertical(many))
    expect(found).toEqual([expect.objectContaining({ id: 'HP.AR.01', severity: 'error', places: 2 })])
  })
})
