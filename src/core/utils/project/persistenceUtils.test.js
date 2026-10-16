import { describe, it, expect } from 'vitest'
import {
  FORMAT_NAME, dehydrateProjects, hydrateProjects, parseProjectsPayload, parseTracksPayload, PayloadError, projectsPayload,
} from './persistenceUtils'
import { SWITCH_TYPES, switchArcLength, switchStraightLength } from '../switch/catalogue'
import { computeSwitchGeometryUtm } from '../switch/symbol'
import { DEFAULT_SWITCH_KIND, SWITCH_FORM_VERSION } from '../track/switchModel'
import goldenElements from '../../test/fixtures/track_optimized.json'
import { derivedEndBearing } from '../geometry/elementUtils'

const EPSG = goldenElements[0].epsg

function project() {
  return [{
    id: 'p1',
    tracks: [{
      id: goldenElements[0].id,
      epsg: EPSG,
      elements: goldenElements[0].elements.map(el => ({ ...el })),
    }],
  }]
}

describe('hydrateProjects / dehydrateProjects round trip', () => {
  it('reload stability: dehydrate -> hydrate reproduces the same plane data', () => {
    const original = hydrateProjects(project())
    const reloaded = hydrateProjects(dehydrateProjects(structuredClone(original)))

    const origEls = original[0].tracks[0].elements
    const reloadedEls = reloaded[0].tracks[0].elements
    expect(reloadedEls).toHaveLength(origEls.length)
    for (let i = 0; i < origEls.length; i++) {
      const a = origEls[i], b = reloadedEls[i]
      // Kept to 1 µm and 10⁻⁹ ° (oltjson-1.0).
      b.startNode.forEach((v, k) => expect(v).toBeCloseTo(a.startNode[k], 6))
      b.endNode.forEach((v, k) => expect(v).toBeCloseTo(a.endNode[k], 6))
      expect(b.bearing).toBeCloseTo(a.bearing, 9)
      expect(b.length).toBeCloseTo(a.length, 6)
      if (a.radius != null) expect(b.radius).toBeCloseTo(a.radius, 6)
      if (a.endBearing != null) expect(b.endBearing).toBeCloseTo(a.endBearing, 6)
    }
  })

  it('dehydrate strips derived geometry, hydrate rebuilds it', () => {
    const hydrated = hydrateProjects(project())
    const dehydrated = dehydrateProjects(structuredClone(hydrated))
    for (const el of dehydrated[0].tracks[0].elements) {
      expect(el.geometry).toBeUndefined()
      expect(el.renderCoords).toBeUndefined()
    }
    expect(dehydrated[0].tracks[0].coordinates).toBeUndefined()

    const rehydrated = hydrateProjects(dehydrated)
    for (const el of rehydrated[0].tracks[0].elements) {
      expect(el.geometry?.coordinates?.length).toBeGreaterThanOrEqual(2)
    }
    expect(rehydrated[0].tracks[0].coordinates.length).toBeGreaterThan(0)
  })

  it('hydrateProjects is idempotent (same input twice = same output)', () => {
    const once = hydrateProjects(project())
    const twice = hydrateProjects(structuredClone(once))
    expect(twice).toEqual(once)
  })
})

describe('track_optimized.json fixture — chain continuity invariants', () => {
  const els = goldenElements[0].elements

  it('each element end joins the next element start within 1 mm', () => {
    for (let i = 0; i < els.length - 1; i++) {
      const [eE, eN] = els[i].endNode
      const [sE, sN] = els[i + 1].startNode
      expect(Math.hypot(eE - sE, eN - sN)).toBeLessThan(0.001)
    }
  })

  it('an element with a stored endBearing meets the next element tangentially', () => {
    // A straight-to-straight join may be a real kink (no curvature involved,
    // see elementUtils.js "kinked straights") and is not required to be
    // tangential. Only where an element *carries* an endBearing (arcs,
    // transitions) does the next element have to continue it smoothly.
    for (let i = 0; i < els.length - 1; i++) {
      if (els[i].endBearing == null) continue
      const outBearing = els[i].endBearing
      const inBearing = els[i + 1].bearing
      const diff = Math.abs(((outBearing - inBearing + 540) % 360) - 180)
      // track_optimized.json comes out of the (separately rounding) optimizer,
      // so allow for that source's own float noise, not just ours.
      expect(diff).toBeLessThan(1e-4)
    }
  })

})

// ── A project of the current model ───────────────────────────────────────────

const SWITCH_EPSG = 25832
const FORM = SWITCH_TYPES.find(form => form.label === '300 – 1:9')

/** A facing turnout on a straight, written the way the dialogs write one. */
function switchProject(identity = { switchId: 'sw-1', kind: DEFAULT_SWITCH_KIND, formVersion: SWITCH_FORM_VERSION }) {
  const toe = { easting: 500000, northing: 5600000, zone: SWITCH_EPSG }
  const g = computeSwitchGeometryUtm(toe, 30, FORM, 'right', false)
  const mark = (route) => ({
    switchBranch: true, switchRoute: route,
    switchId: identity.switchId, switchName: 'switch.001', switchLabel: FORM.label,
  })
  return [{
    id: 'p1',
    tracks: [
      { id: 'through', epsg: SWITCH_EPSG, elements: [{
        elementType: 0, ...mark('main'),
        startNode: g.portA, endNode: g.portB2,
        bearing: 30, length: switchStraightLength(FORM.R, FORM.ratio),
      }] },
      { id: 'branch', epsg: SWITCH_EPSG, elements: [{
        elementType: 1, ...mark('branch'),
        startNode: g.portA, endNode: g.portB1,
        bearing: 30, endBearing: g.branchEndBearing,
        length: switchArcLength(FORM.R, FORM.ratio), radius: g.signedR,
      }] },
    ],
    switches: [{
      ...identity, name: 'switch.001', label: FORM.label, trailing: false,
      ports: {
        A: { trackId: null, endpoint: null },
        B1: { trackId: 'branch', endpoint: 'BEGIN' },
        B2: { trackId: 'through', endpoint: 'BEGIN' },
      },
    }],
  }]
}

describe('loading a project of the current model', () => {
  it('builds the switch symbol from the tracks', () => {
    const [p] = hydrateProjects(switchProject())
    const [sw] = p.switches
    expect(sw.fillCoords.length).toBeGreaterThan(2)
    expect(sw.lcsCoords).toHaveLength(2)
    expect(sw.bauform).toBe('plain')
    expect(sw.bodyCentre).toHaveLength(2)
  })

  it('a reload leaves the id and the symbol as they were', () => {
    const [first]  = hydrateProjects(switchProject())
    const [second] = hydrateProjects(dehydrateProjects(structuredClone([first])))
    expect(second.switches[0].switchId).toBe('sw-1')
    second.switches[0].fillCoords.flat(2).forEach((v, k) => expect(v).toBeCloseTo(first.switches[0].fillCoords.flat(2)[k], 9))
    expect(second.tracks[1].elements[0].switchId).toBe('sw-1')
  })
})

// ── The door: what this tool will and will not take ──────────────────────────

const payloadOf = (projects) => projectsPayload(dehydrateProjects(projects))

describe('parseProjectsPayload', () => {
  it('takes a payload of the current version and hands the projects back', () => {
    const payload = payloadOf(switchProject())
    expect(parseProjectsPayload(payload).projects).toHaveLength(1)
  })

  it('takes a project with no switches at all', () => {
    expect(parseProjectsPayload(payloadOf(project())).projects).toHaveLength(1)
  })

  it('says what it takes: { format: oltjson, version: 1.0 }', () => {
    expect(payloadOf(project())).toMatchObject({ format: 'oltjson', version: '1.0' })
    expect(FORMAT_NAME).toBe('oltjson-1.0')
  })

  it('refuses another format or another version of it by that alone', () => {
    for (const other of [{ version: 2 }, { version: '1.1' }, { format: 'railjson' }, { format: undefined }]) {
      const payload = { ...payloadOf(switchProject()), ...other }
      expect(() => parseProjectsPayload(payload)).toThrow(PayloadError)
      expect(() => parseProjectsPayload(payload)).toThrow('unsupported_version')
    }
  })

  it('refuses ports that are not { trackId, endpoint } objects', () => {
    const payload = payloadOf(switchProject())
    payload.projects[0].switches[0].ports = { A: 'track-a' }
    expect(() => parseProjectsPayload(payload)).toThrow('invalid_payload')
  })

  it('refuses a payload that is not one at all', () => {
    for (const bad of [null, undefined, 42, {}, { projects: 'nope' }]) {
      expect(() => parseProjectsPayload(bad)).toThrow('invalid_payload')
    }
  })

  it('refuses a switch record missing any of the model’s fields', () => {
    for (const drop of ['switchId', 'kind', 'formVersion']) {
      const payload = payloadOf(switchProject())
      delete payload.projects[0].switches[0][drop]
      expect(() => parseProjectsPayload(payload), drop).toThrow('invalid_payload')
    }
  })

  it('refuses a marked element without its switch id', () => {
    const payload = payloadOf(switchProject())
    delete payload.projects[0].tracks[1].elements[0].switchId
    expect(() => parseProjectsPayload(payload)).toThrow('invalid_payload')
  })

  it('lets an ordinary element through — only marked ones need an id', () => {
    const payload = payloadOf(project())
    expect(payload.projects[0].tracks[0].elements.some(el => el.switchBranch)).toBe(false)
    expect(() => parseProjectsPayload(payload)).not.toThrow()
  })
})

describe('parseTracksPayload (R0.5)', () => {
  const el = (extra = {}) => ({ elementType: 0, startNode: [0, 0], endNode: [10, 0], length: 10, ...extra })
  const track = (extra = {}) => ({ id: 't1', epsg: 25832, elements: [el()], ...extra })
  const code = (fn) => { try { fn() } catch (e) { return e instanceof PayloadError ? e.code : 'other' } return null }

  it('takes one track or an array of them', () => {
    expect(parseTracksPayload(track())).toHaveLength(1)
    expect(parseTracksPayload([track(), track({ id: 't2' })])).toHaveLength(2)
  })

  it('refuses what is not a track file', () => {
    expect(code(() => parseTracksPayload([]))).toBe('tracks_empty')
    expect(code(() => parseTracksPayload({ projects: [] }))).toBe('invalid_payload')
    expect(code(() => parseTracksPayload(track({ id: 3 })))).toBe('invalid_payload')
    expect(code(() => parseTracksPayload(track({ elements: [] })))).toBe('invalid_payload')
    expect(code(() => parseTracksPayload(track({ elements: [el({ elementType: 7 })] })))).toBe('invalid_payload')
    expect(code(() => parseTracksPayload(track({ elements: [el({ endNode: [1, 'x'] })] })))).toBe('invalid_payload')
    expect(code(() => parseTracksPayload(track({ elements: [el({ length: -1 })] })))).toBe('invalid_payload')
    expect(code(() => parseTracksPayload(track({ elements: [el({ switchBranch: 'stem' })] })))).toBe('invalid_payload')
  })

  it('takes a switch branch only into a project that has the switch', () => {
    const t = track({ elements: [el({ switchBranch: 'stem', switchId: 's1' })] })
    expect(code(() => parseTracksPayload(t))).toBe('switch_missing')
    expect(parseTracksPayload(t, { switchIds: new Set(['s1']) })).toHaveLength(1)
  })
})

// ── What a record keeps (oltjson-1.0, decision 333) ──────────────────────────

describe('a record as it is kept', () => {
  const arc = { elementType: 1, startNode: [500000.1234567891, 5600000], endNode: [500100, 5600010], bearing: 84.12345678912345, length: 100.12345678912, radius: 500.0000004 }
  const kept = (el, heights) => dehydrateProjects([{ id: 'p', tracks: [{ id: 't', epsg: 25832, elements: [el], ...(heights ? { heights } : {}) }] }])[0].tracks[0]

  it('leaves out an end bearing its bearing, length and radius give, and the load puts it back', () => {
    const endBearing = derivedEndBearing(arc)
    const [el] = kept({ ...arc, endBearing }).elements
    expect(el).not.toHaveProperty('endBearing')
    const [back] = hydrateProjects([{ id: 'p', tracks: [{ id: 't', epsg: 25832, elements: [el] }] }])[0].tracks[0].elements
    expect(back.endBearing).toBeCloseTo(endBearing, 6)
  })

  it('keeps an end bearing that does not follow — a kinked straight', () => {
    const straight = { elementType: 0, startNode: [0, 0], endNode: [100, 0], bearing: 90, length: 100, endBearing: 90.5 }
    expect(kept(straight).elements[0].endBearing).toBe(90.5)
    expect(kept({ ...straight, endBearing: 90 }).elements[0]).not.toHaveProperty('endBearing')
  })

  it('keeps plane values to 1 µm, heights to 0.1 mm and angles to 10⁻⁹ °', () => {
    const t = kept(arc, [{ station: 12.34567891, z: 101.23456, rv: 2000.0000001 }])
    const [el] = t.elements
    expect(el.startNode).toEqual([500000.123457, 5600000])
    expect(el.length).toBe(100.123457)
    expect(el.radius).toBe(500)
    expect(el.bearing).toBe(84.123456789)
    expect(t.heights[0]).toEqual({ station: 12.345679, z: 101.2346, rv: 2000 })
  })
})
