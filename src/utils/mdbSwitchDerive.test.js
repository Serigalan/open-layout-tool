import { describe, it, expect } from 'vitest'
import { parseMdbPayload, mdbSwitchInventory, buildAllTracksFromMdb } from './mdbImport'
import { placeMdbSwitches } from './mdbSwitchPlacement'
import {
  formFromGeometry, formInCatalogue, offsetOnTrack, deriveMdbTurnouts, AXIS_TOL,
} from './mdbSwitchDerive'
import { endPointStraightUtm, endPointCurvedUtm } from './elementUtils'

/**
 * Checking the switches a file states, and reading the ones it does not.
 *
 * The survey below is laid out the way the interface delivers one: points in a
 * Lagesystem, elements between them, and Satzart 31 saying — or not saying —
 * that a Bauteil stands at a point. Five Trassen meet one straight stem:
 *
 *   Stamm   400 m straight, west to east
 *   Zweig   a 190 – 1:9 turnout's branch, leaving it at 200 m
 *   Fremd   the same shape on R = 400, leaving it at 100 m
 *   Weiter  a straight beginning on it at 300 m and running on
 *   Kreuz   a straight crossing it at 350 m, ending nowhere near it
 *
 * Only `Zweig` and `Fremd` are turnouts. `Weiter` ends on the stem and does not
 * part from it, and `Kreuz` crosses — which in plan is a Kreuzung and an
 * Überwerfungsbauwerk at once, so nothing may be concluded from it.
 */

const SYS = 'ER0'            // DB_REF, 12° strip → EPSG 5684
const EPSG = 5684
const DEG2GON = 1 / 0.9

/** Frog angle of a 1:9 turnout, and the arc a radius turns through it. */
const ALPHA = Math.atan(1 / 9)
const arcLen = (R) => R * ALPHA

const p = (e, n) => ({ easting: e, northing: n, zone: EPSG })
const xy = (u) => [u.easting, u.northing]

const S0 = p(4480000, 5765000)
const S1 = endPointStraightUtm(S0, 90, 400)          // the stem, due east
const TOE = endPointStraightUtm(S0, 90, 200)
const Z1 = endPointCurvedUtm(TOE, 90, arcLen(190), 190)
const Z2 = endPointStraightUtm(Z1, 90 + ALPHA * 180 / Math.PI, 30)
const F0 = endPointStraightUtm(S0, 90, 100)
const F1 = endPointCurvedUtm(F0, 90, arcLen(400), 400)
const W0 = endPointStraightUtm(S0, 90, 300)
const K0 = p(4480350, 5764950)
const K1 = endPointStraightUtm(K0, 0, 100)

/** A Satzart 12 record. */
const pt = (pad, u) => ({ pad, sys: SYS, y: u.easting, x: u.northing })

/** A Satzart 21 record: `typ` 0 = straight, 1 = arc (signed radius in p2). */
const el = (pad1, pad2, trasse, typ, length, bearing, p2 = 0) => ({
  pad1, pad2, sys: SYS, typ, p1: length, p2, p3: 0,
  ariwi: bearing * DEG2GON, text: `Trasse:${trasse}`, err: 0,
})

/** A Satzart 31 node: `KNOTEN` is Betriebsstelle in 0–9 and number in 10–14. */
const node = (pad, nr, form) => ({
  knoten: 'BSTA'.padEnd(10) + String(nr).padStart(5), typ: 1, pad, form,
  nb: [], err: 0,
})

const BRANCH_BEARING = 90 + ALPHA * 180 / Math.PI

const survey = (extra = {}) => parseMdbPayload({
  points: [
    pt('S0', S0), pt('S1', S1), pt('TOE', TOE),
    pt('Z1', Z1), pt('Z2', Z2),
    pt('F0', F0), pt('F1', F1),
    pt('W0', W0), pt('W1', S1),
    pt('K0', K0), pt('K1', K1),
    ...(extra.points ?? []),
  ],
  elements: [
    el('S0', 'S1', 'Stamm', 0, 400, 90),
    el('TOE', 'Z1', 'Zweig', 1, arcLen(190), 90, 190),
    el('Z1', 'Z2', 'Zweig', 0, 30, BRANCH_BEARING),
    el('F0', 'F1', 'Fremd', 1, arcLen(400), 90, 400),
    el('W0', 'W1', 'Weiter', 0, 100, 90),
    el('K0', 'K1', 'Kreuz', 0, 100, 0),
  ],
  nodes: extra.nodes ?? [],
})

const build = (payload, opts = {}) => {
  const { tracks } = buildAllTracksFromMdb(payload)
  const { units } = mdbSwitchInventory(payload)
  let n = 0
  return placeMdbSwitches(payload, tracks, units, { newId: () => `id${++n}`, ...opts })
}

const byName = (tracks) => Object.fromEntries(tracks.map(tr => [tr.name, tr]))

describe('the survey this is read from', () => {
  it('is five Trassen on one stem', () => {
    const { tracks } = buildAllTracksFromMdb(survey())
    expect(tracks.map(tr => tr.name).sort()).toEqual([
      'Fremd.001', 'Kreuz.001', 'Stamm.001', 'Weiter.001', 'Zweig.001',
    ])
    expect(byName(tracks)['Stamm.001'].epsg).toBe(EPSG)
  })
})

describe('a switch the file states', () => {
  const payload = survey({ nodes: [node('TOE', 12, 'EW 54-190-1:9')] })

  it('is placed on the two tracks that meet at its Weichenanfang', () => {
    const { switches } = build(payload)
    expect(switches).toHaveLength(1)
    expect(switches[0].name).toBe('12')            // the designation on site
    expect(switches[0].label).toBe('190 – 1:9')
    expect(switches[0].pad).toBe('TOE')
  })

  it('says nothing about the Weichenanfang when it lies on both', () => {
    const { errors } = build(payload)
    expect(errors.filter(e => e.includes('Weichenanfang'))).toEqual([])
  })
})

describe('a Weichenanfang beside the tracks it belongs to', () => {
  // The same switch, but its point is stated 10 cm north of both — which is
  // 10 cm off the stem's axis and 10 cm from the branch's first point.
  const payload = survey({
    points: [pt('OFF', p(TOE.easting, TOE.northing + 0.10))],
    nodes: [node('OFF', 12, 'EW 54-190-1:9')],
  })

  it('is set, and reported with both distances', () => {
    const { switches, errors } = build(payload)
    expect(switches).toHaveLength(1)
    const note = errors.find(e => e.includes('Weichenanfang'))
    expect(note).toMatch(/10\.0 cm neben dem Stammgleis Stamm\.001/)
    expect(note).toMatch(/10\.0 cm neben dem Anfang des Zweiggleises Zweig\.001/)
  })

  it('leaves a point within the tolerance alone', () => {
    const near = survey({
      points: [pt('OFF', p(TOE.easting, TOE.northing + AXIS_TOL / 2))],
      nodes: [node('OFF', 12, 'EW 54-190-1:9')],
    })
    expect(build(near).errors.filter(e => e.includes('Weichenanfang'))).toEqual([])
  })
})

describe('a switch the file leaves out', () => {
  it('is added where a track ends on another', () => {
    const { switches, errors } = build(survey(), { derive: true })
    expect(switches).toHaveLength(1)
    expect(switches[0].label).toBe('190 – 1:9')
    // No Punktadresse: it was read off the alignment, not out of Satzart 31,
    // and it is named from the project's own numbering like a built one.
    expect(switches[0].pad).toBe(null)
    expect(switches[0].name).toBe('switch.001')
    expect(errors.join(' ')).toMatch(/1 Weichen ergänzt, die in Satzart 31 fehlen/)
  })

  it('is not added a second time where the file does state it', () => {
    const stated = survey({ nodes: [node('TOE', 12, 'EW 54-190-1:9')] })
    const { switches } = build(stated, { derive: true })
    expect(switches).toHaveLength(1)
    expect(switches[0].pad).toBe('TOE')
  })

  it('stays out where the placement was not asked for it', () => {
    expect(build(survey()).switches).toEqual([])
  })

  it('takes the form from the curvature the branch leaves on', () => {
    const { tracks } = buildAllTracksFromMdb(survey())
    const { units } = deriveMdbTurnouts(tracks)
    const found = units.find(u => u.where.includes('Zweig.001'))
    expect(found.label).toBe('190 – 1:9')
    expect(found.radius).toBe(190)
    expect(found.kind).toBe('turnout')
  })
})

describe('what a track ending on another is not', () => {
  const { tracks } = buildAllTracksFromMdb(survey())

  it('is no switch where it crosses instead of ending', () => {
    // Kreuz runs through the stem and ends 50 m clear of it on both sides. A
    // Kreuzung and an Überwerfungsbauwerk are the same picture in plan, so
    // nothing is concluded — and nothing is reported either.
    const { units, errors } = deriveMdbTurnouts(tracks)
    expect(units.some(u => u.where.includes('Kreuz'))).toBe(false)
    expect(errors.join(' ')).not.toMatch(/Kreuz/)
  })

  it('is no switch where it runs on without an angle', () => {
    const { units, running, errors } = deriveMdbTurnouts(tracks)
    expect(units.some(u => u.where.includes('Weiter'))).toBe(false)
    expect(running).toBe(1)
    expect(errors.join(' ')).toMatch(/1 Gleisenden liegen mitten auf einem anderen Gleis/)
  })

  it('is no switch where the two only meet end to end', () => {
    // Weiter ends exactly where the stem ends. Two tracks meeting end to end
    // is how one line arrives in pieces; nothing parts there.
    const { errors } = deriveMdbTurnouts(tracks)
    expect(errors.join(' ')).not.toMatch(/Weiter\.001 \(Ende\)/)
  })
})

describe('a form the catalogue does not have', () => {
  it('is reported with the radius and the frog angle it measured', () => {
    const { errors } = deriveMdbTurnouts(buildAllTracksFromMdb(survey()).tracks)
    const note = errors.find(e => e.includes('Fremd.001'))
    expect(note).toMatch(/Weiche fehlt in Satzart 31, R ≈ 400 m, 1:9\.0/)
    expect(note).toMatch(/steht nicht im Weichenkatalog/)
  })

  it('leaves the place without a switch rather than bending it onto the nearest', () => {
    const { switches } = build(survey(), { derive: true })
    expect(switches.every(sw => sw.label !== '300 – 1:9' && sw.label !== '500 – 1:12')).toBe(true)
  })
})

describe('the form two alignments state where they part', () => {
  it('is the branch itself where the stem is straight', () => {
    const m = formFromGeometry(null, { signedR: 190, length: arcLen(190) })
    expect(m.R).toBeCloseTo(190, 6)
    expect(m.ratio).toBeCloseTo(9, 6)
    expect(m.side).toBe('right')
  })

  it('is the difference of the two curvatures where the stem bends', () => {
    // A 190 – 1:9 laid into a 1000 m right-hand curve: the branch comes out
    // tighter than the form, and the form is what the two differ by.
    const branch = 1 / (1 / 190 + 1 / 1000)
    const m = formFromGeometry(1000, { signedR: branch, length: arcLen(190) })
    expect(m.R).toBeCloseTo(190, 6)
    expect(m.ratio).toBeCloseTo(9, 6)
  })

  it('is nothing where the branch runs on the curvature the stem has', () => {
    expect(formFromGeometry(600, { signedR: 600, length: 50 })).toBe(null)
    expect(formFromGeometry(null, null)).toBe(null)
  })

  it('names the catalogue form it is, and only within a tolerance', () => {
    expect(formInCatalogue({ R: 191, ratio: 9.05 })?.label).toBe('190 – 1:9')
    expect(formInCatalogue({ R: 400, ratio: 9 })).toBe(null)      // no R 400 in the table
    expect(formInCatalogue({ R: 190, ratio: 3 })).toBe(null)      // no 1:3 on R 190
  })
})

describe('how far a point is from a track', () => {
  it('is measured against the curve, not against its chord', () => {
    const { tracks } = buildAllTracksFromMdb(survey())
    const zweig = byName(tracks)['Zweig.001']
    // The middle of the branch's arc lies on the track; its chord is
    // 21 m² / (8 · 190) = 14 cm away, which a chord test would call an offset.
    const mid = endPointCurvedUtm(
      { easting: zweig.elements[0].startNode[0], northing: zweig.elements[0].startNode[1] },
      90, arcLen(190) / 2, 190)
    expect(offsetOnTrack(zweig, xy(mid)).dist).toBeLessThan(1e-6)
    expect(offsetOnTrack(zweig, xy(mid)).station).toBeCloseTo(arcLen(190) / 2, 6)
  })
})
