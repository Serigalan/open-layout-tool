import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  readProviArchive, parseProviRecords, proviAxisEpsg, buildProviAxis, parseProviGradient,
  gradientStretch, listProviAxes, buildProviTracks, proviPlaceableUnits, proviSwitchCandidates,
  proviProject, proviHeights,
} from './proviImport'
import { placeMdbSwitches } from './mdbSwitchPlacement'
import { trackLength, pointAtStationUtm } from './heightUtils'
import { expectNodesJoin, expectLengthsTrue, expectSwitchRoutesCarved } from '../test/chainInvariants'

/**
 * The fixture is a cut from a delivered ProVI archive: the two main tracks
 * 63402L/R of line 6340, the two tracks 623B/624B branching off them with two
 * switches each, and the buffer stubs 623S/624S branching off those — six
 * switches in all. Beside them what an archive carries and the import leaves
 * alone: a cross section `TR624B` (a T that names no axis) and a switch list
 * `WLI623B`. 624S has no gradient.
 */
const zip = readFileSync(fileURLToPath(new URL('../test/fixtures/provi_ausschnitt.zip', import.meta.url)))
const files = readProviArchive(zip)

const lines = (...rows) => rows.join('\r\n')
const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])

describe('the archive', () => {
  it('lists the axes — only the A files — with their title, system and gradient', () => {
    const axes = listProviAxes(files)
    expect(axes.map(a => a.name)).toEqual(['623B', '623S', '624B', '624S', '63402L', '63402R'])
    const b623 = axes.find(a => a.name === '623B')
    expect(b623).toMatchObject({ title: 'Gleis 623', lsys: 'DR0', switches: 2, gradient: true })
    expect(b623.length).toBeCloseTo(979.362109, 5)
    expect(axes.find(a => a.name === '624S')).toMatchObject({ title: 'Schutzstumpf 624', gradient: false })
  })

  it('reads a record as its type and fields, the first of a repeated key winning', () => {
    const { header, records } = parseProviRecords(lines(
      '\uFEFFEB: Gleis 1', 'VERSION: 6.3',
      'W # WNUM = 0603 # ANUM = 63402L # GROUP = 1 # WNUM = 0611 # ANUM = 63402L',
      'UQ',
    ))
    expect(header).toEqual({ EB: 'Gleis 1', VERSION: '6.3' })
    expect(records).toEqual([
      { type: 'W', fields: { WNUM: '0603', ANUM: '63402L', GROUP: '1' } },
      { type: 'UQ', fields: {} },
    ])
  })
})

describe('proviAxisEpsg — the plane an axis states', () => {
  it('reads the DB ASCII codes as the MDB import does', () => {
    expect(proviAxisEpsg('DR0', 3567648)).toEqual({ epsg: 5683, note: null })
    expect(proviAxisEpsg('ER0', 4418876)).toEqual({ epsg: 5684, note: null })
    expect(proviAxisEpsg('DA1', 3566000).epsg).toBe(5677)
  })

  it('takes a plain DB_REF in the zone the eastings are in', () => {
    expect(proviAxisEpsg('DB_REF', 3567648)).toEqual({ epsg: 5683, note: null })
    expect(proviAxisEpsg('DB_REF', 4418876)).toEqual({ epsg: 5684, note: null })
  })

  it('reads an axis without a system in the chosen frame, and says so', () => {
    const plain = proviAxisEpsg('', 4418876)
    expect(plain.epsg).toBe(5684)
    expect(plain.note).toMatch(/kein Lagesystem/)
    expect(proviAxisEpsg(undefined, 3567648, 'A').epsg).toBe(5677)
    const unknown = proviAxisEpsg('REF_2016', 3567648)
    expect(unknown.epsg).toBe(5683)
    expect(unknown.note).toMatch(/REF_2016/)
  })

  it('reports a code whose strip is not the one the eastings are in', () => {
    const odd = proviAxisEpsg('DR0', 4418876)
    expect(odd.epsg).toBe(5683)
    expect(odd.note).toMatch(/Zone 3.*Zone 4/)
  })
})

describe('buildProviAxis — the elements between the main points', () => {
  const axis = (name) => {
    const { records } = parseProviRecords(files.get(`A${name}`))
    return { records, built: buildProviAxis(name, records, 5683) }
  }
  const lastHp = (records) => {
    const hp = records.filter(r => r.type === 'HP').pop().fields
    return [Number(hp.RW), Number(hp.HW)]
  }

  it('rebuilds a branch track with a switch at either end, the second one facing back', () => {
    const { records, built } = axis('623B')
    expect(built.errors).toEqual([])
    expectNodesJoin(built.elements)
    expectLengthsTrue(built.elements)
    expect(built.elements.reduce((s, e) => s + e.length, 0)).toBeCloseTo(979.362109, 3)
    expect(near(built.elements.at(-1).endNode, lastHp(records))).toBeLessThan(0.001)
    // Both ends are the branch arcs of R 760 — at the far end the axis runs
    // through its switch backwards, from the frog to the toe.
    expect(built.elements.map(e => e.radius ?? 0)).toEqual([-760, 0, 900, 0, 900, 0, -760])
  })

  it('states the switches with their form and Weichenanfang', () => {
    const { built } = axis('623B')
    expect(built.units.map(u => u.name)).toEqual(['0603', '0611'])
    expect(built.units[0]).toMatchObject({
      host: '63402L', branch: '623B', kind: 'turnout', label: '60-760-1:14',
      radius: 760, slope: 14, rail: 'UIC60', epsg: 5683,
    })
    expect(built.units[0].point).toEqual([3567648.852542, 5645254.581658])
  })

  it('puts the cant on the arcs, signed by their curve', () => {
    const { records, built } = axis('63402L')
    expect(built.errors).toEqual([])
    expectNodesJoin(built.elements)
    expect(near(built.elements.at(-1).endNode, lastHp(records))).toBeLessThan(0.001)
    const canted = built.elements.filter(e => e.elementType === 1 && e.cant)
    expect(canted.length).toBeGreaterThan(20)
    for (const el of canted) expect(Math.sign(el.cant)).toBe(Math.sign(el.radius))
    expect(built.elements.filter(e => e.elementType === 2 && e.cant)).toEqual([])
  })

  it('splits a reverse curve at its inflection', () => {
    const records = parseProviRecords(lines(
      'HP # STAT = 309.064502 # RW = 4432441.541135 # HW = 5648916.540251',
      'FE # ID = 4 # METH = 1 # RAD = 1200.000000 # WIN = 272.9099300000 # V = 0 # L = 81.551312',
      'UQ # UQ = 30.000',
      'HP # STAT = 390.615814 # RW = 4432366.176244 # HW = 5648885.424490',
      'UV # ID = 5 # TYP = 2 # VER = 0 # RAD1 = 1200.000000 # RAD2 = -1200.000000 # WIN = 277.2363620000 # V = 0 # L1 = 30.000001 # L2 = 29.999985',
      'UQ # UQ = 30.000',
      'HP # STAT = 450.615800 # RW = 4432309.798606 # HW = 5648864.893777',
    )).records
    const built = buildProviAxis('63401L', records, 5684)
    expect(built.errors).toEqual([])
    expect(built.elements.map(e => (e.elementType === 2 ? [2, e.r1, e.r2] : [e.elementType, e.radius])))
      .toEqual([[1, 1200], [2, 1200, null], [2, null, -1200]])
    expect(built.elements[0].cant).toBe(30)
    expectNodesJoin(built.elements)
    expect(near(built.elements.at(-1).endNode, [4432309.798606, 5648864.893777])).toBeLessThan(0.001)
  })

  it('reads TYP 8 as a Bloss curve', () => {
    const records = parseProviRecords(lines(
      'HP # STAT = 198774.533323 # RW = 3566421.096886 # HW = 5644877.949359',
      'UV # ID = 253 # TYP = 8 # VER = 0 # RAD1 = 0.000000 # RAD2 = 752.000000 # WIN = 280.9187992390 # V = 0 # L1 = 104.137966 # L2 = 0.000000',
      'UQ # TYP = 5',
      'HP # STAT = 198878.671289 # RW = 3566321.006738 # HW = 5644849.281125',
    )).records
    const built = buildProviAxis('6001B', records, 5683)
    expect(built.elements).toHaveLength(1)
    expect(built.elements[0]).toMatchObject({ elementType: 2, transitionType: 'bloss', r1: null, r2: 752 })
    expect(near(built.elements[0].endNode, [3566321.006738, 5644849.281125])).toBeLessThan(0.001)
  })

  it('lays a switch into a transition as clothoids between its points', () => {
    const records = parseProviRecords(lines(
      'HP # STAT = 0.000000 # RW = 3597777.040554 # HW = 5648030.509300',
      'WE # ID = 1 # METH = 1 # WNUM = 2034 # ANUM = 63402L # STAT = 8706.756563',
      'WZ # TYP = WAZ # STAT = 0.000000 # RW = 3597777.040554 # HW = 5648030.509300 # VDIR = 2.6598221975 # DIR = 2.6598221975 # VRAD = -11061.000000',
      'WZ # TYP = BWZ # STAT = 0.000223 # RW = 3597777.040360 # HW = 5648030.509410 # VDIR = 2.6598221975 # DIR = 2.6598221975 # RAD = 1346.183508',
      'WZ # TYP = ZWG # STAT = 62.200229 # RW = 3597722.566867 # HW = 5648060.524386 # VDIR = 2.6174005938 # DIR = 2.6174005938 # VRAD = 1609.793197 # RAD = -4283.961138',
      'WZ # TYP = WEZ # STAT = 64.810242 # RW = 3597720.306928 # HW = 5648061.830083 # VDIR = 2.6179604698 # DIR = 2.6179604698 # VRAD = -5112.664464 # RAD = -3135.387831',
      'WB # NAME = 60-1200-1:18.5',
      'HP # STAT = 64.810242 # RW = 3597720.306928 # HW = 5648061.830083',
    )).records
    const built = buildProviAxis('734735W', records, 5683)
    expect(built.errors).toEqual([])
    // The first part is a fifth of a millimetre and carries no geometry.
    expect(built.elements.map(e => [e.elementType, e.r1, e.r2]))
      .toEqual([[2, 1346.183508, 1609.793197], [2, -4283.961138, -5112.664464]])
    expect(near(built.elements.at(-1).endNode, [3597720.306928, 5648061.830083])).toBeLessThan(0.001)
    expect(built.units[0]).toMatchObject({ name: '2034', host: '63402L', radius: 1200, slope: 18.5 })
  })
})

describe('the gradient', () => {
  it('reads the tangent polygon with its vertical curves', () => {
    const points = parseProviGradient(files.get('T623B'))
    expect(points).toHaveLength(7)
    expect(points[0]).toEqual({ station: 0, z: 271.438091 })
    expect(points.at(-1)).toEqual({ station: 979.362109, z: 281.151443 })
    expect(parseProviGradient(lines(
      'X      532.836478  201.712000     7939.726884     0.000000     0.000000 0 0      0.000    O00',
    ))).toEqual([{ station: 532.836478, z: 201.712, rv: 7939.726884 }])
  })

  const polygon = [{ station: 0, z: 100 }, { station: 100, z: 101, rv: 5000 }, { station: 200, z: 99 }]

  it('cuts the stretch a track covers, interpolating at the cuts', () => {
    expect(gradientStretch(polygon, 50, 150)).toEqual([
      { station: 0, z: 100.5 }, { station: 50, z: 101, rv: 5000 }, { station: 100, z: 100 },
    ])
  })

  it('leaves a stretch without heights where the gradient begins late or ends early', () => {
    expect(gradientStretch(polygon, -50, 150).map(p => p.station)).toEqual([50, 150, 200])
    expect(gradientStretch(polygon, 150, 300)).toEqual([{ station: 0, z: 100 }, { station: 50, z: 99 }])
  })

  it('takes a gradient that falls short of an end by less than half a metre as reaching it', () => {
    expect(gradientStretch(polygon, -0.3, 200.2)).toEqual([
      { station: 0, z: 100 }, { station: 100.3, z: 101, rv: 5000 }, { station: 200.5, z: 99 },
    ])
  })

  it('gives nothing where the gradient does not reach into the stretch', () => {
    expect(gradientStretch(polygon, 300, 400)).toBeNull()
    expect(gradientStretch([], 0, 10)).toBeNull()
  })
})

describe('proviProject — exact, and pruned by the chords', () => {
  it('finds a point beside the track at its station and distance', () => {
    const { records } = parseProviRecords(files.get('A63402L'))
    const track = { epsg: 5683, elements: buildProviAxis('63402L', records, 5683).elements }
    let begin = 0
    track.elements.forEach((el, i) => {
      if (i % 5 === 0 && el.length > 2) {
        // Half a metre off the axis, square to it, in the middle of the element.
        const s = el.length / 2
        const a = pointAtStationUtm(el, s - 0.01, 5683)
        const b = pointAtStationUtm(el, s + 0.01, 5683)
        const m = pointAtStationUtm(el, s, 5683)
        const [dx, dy] = [b.easting - a.easting, b.northing - a.northing]
        const k = 0.5 / Math.hypot(dx, dy)
        const hit = proviProject(track, [m.easting + dy * k, m.northing - dx * k])
        expect(hit.dist, `element ${i}`).toBeCloseTo(0.5, 4)
        expect(hit.station, `element ${i}`).toBeCloseTo(begin + s, 3)
      }
      begin += el.length
    })
  })
})

describe('proviSwitchCandidates — the tracks a switch belongs to', () => {
  const at = (x0, x1) => ({ startNode: [x0, 0], endNode: [x1, 0], length: x1 - x0 })
  const unit = { host: 'H', branch: 'B', point: [100, 0] }
  const host = { proviAxis: 'H', elements: [at(90, 110)] }
  const variant = { proviAxis: 'V', elements: [at(95, 105)] }
  const branch = { proviAxis: 'B', elements: [at(100, 120)] }
  const approach = { proviAxis: 'X', elements: [at(90, 100)] }

  it('keeps to the named axes where the host runs through', () => {
    expect(proviSwitchCandidates(unit, [host, variant, branch, approach])).toEqual([host, branch])
  })

  it('adds the tracks ending at the point where the host begins there', () => {
    const begins = { proviAxis: 'H', elements: [at(100, 110)] }
    expect(proviSwitchCandidates(unit, [begins, variant, branch, approach]))
      .toEqual([begins, branch, approach])
  })
})

describe('the fixture archive, whole', () => {
  const names = listProviAxes(files).map(a => a.name)
  const built = buildProviTracks(files, names)
  const placeable = proviPlaceableUnits(built.units, built.axes)
  let n = 0
  const placed = placeMdbSwitches({ points: [] }, built.tracks, placeable.units, {
    newId: () => `t${++n}`, tracksFor: proviSwitchCandidates, project: proviProject,
  })
  const { tracks, errors } = proviHeights(placed.tracks, built.axes)

  it('builds one track per axis in the stated plane, and names the ones it had to guess', () => {
    expect(built.tracks.map(t => t.name)).toEqual(names)
    expect(built.tracks.every(t => t.epsg === 5683)).toBe(true)
    expect(built.errors).toEqual([expect.stringMatching(/^2 Achsen: kein Lagesystem.*\(623S, 624S\)/)])
  })

  it('sets all six switches on the tracks the file names', () => {
    expect(placeable.errors).toEqual([])
    expect(placed.errors).toEqual([])
    expect(placed.switches.map(sw => sw.name).sort()).toEqual(['0603', '0604', '0611', '0621', '0622', '0623'])
    for (const sw of placed.switches) {
      expect(sw.fillCoords, sw.name).toBeTruthy()
      expectSwitchRoutesCarved(sw, placed.tracks)
    }
    const byId = Object.fromEntries(placed.tracks.map(t => [t.id, t]))
    const sw = placed.switches.find(s => s.name === '0603')
    expect(byId[sw.portA_trackId].name).toMatch(/^63402L/)
    expect(byId[sw.portB1_trackId].name).toMatch(/^623B/)
  })

  it('gives every piece the stretch of its gradient, and leaves the marker behind', () => {
    expect(tracks.some(t => 'proviAxis' in t)).toBe(false)
    for (const t of tracks) expectNodesJoin(t.elements)
    // T63402L begins 506 m behind its axis: the first piece carries heights
    // from there on and is reported.
    const first = tracks.find(t => t.name === '63402L.001')
    expect(first.heights[0].station).toBeCloseTo(506.175812, 3)
    expect(errors).toEqual([expect.stringMatching(/nicht ganz ab \(63402L, 63402R\)/)])
    // Where a switch cut 623B, both halves meet at one height.
    const [a, b] = ['623B.001', '623B.002'].map(name => tracks.find(t => t.name === name))
    expect(a.heights.at(-1).station).toBeCloseTo(trackLength(a), 6)
    expect(b.heights[0]).toMatchObject({ station: 0, z: a.heights.at(-1).z })
    expect(tracks.find(t => t.name === '624S').heights).toBeUndefined()
  })
})
