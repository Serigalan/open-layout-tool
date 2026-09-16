import { describe, it, expect } from 'vitest'
import { dehydrateProjects, hydrateProjects, parseProjectsPayload, PayloadError, SCHEMA_VERSION } from './persistenceUtils'
import { SWITCH_TYPES, computeSwitchGeometryUtm, switchArcLength, switchStraightLength } from './switchUtils'
import { DEFAULT_SWITCH_KIND, SWITCH_FORM_VERSION } from './switchModel'
import goldenElements from '../../track_optimized.json'

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
      expect(b.startNode).toEqual(a.startNode)
      expect(b.endNode).toEqual(a.endNode)
      expect(b.bearing).toBeCloseTo(a.bearing, 9)
      expect(b.length).toBeCloseTo(a.length, 9)
      if (a.radius != null) expect(b.radius).toBe(a.radius)
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

  it('absLength runs continuously', () => {
    let running = 0
    for (const el of els) {
      running += el.length
      expect(el.absLength).toBeCloseTo(running, 6)
    }
  })
})

// ── A project of the current model ───────────────────────────────────────────

const SWITCH_EPSG = 25832
const FORM = SWITCH_TYPES[1]                       // 300 – 1:9

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
      portA_trackId: null,       portA_endpoint:  null,
      portB1_trackId: 'branch',  portB1_endpoint: 'BEGIN',
      portB2_trackId: 'through', portB2_endpoint: 'BEGIN',
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
    expect(second.switches[0].fillCoords).toEqual(first.switches[0].fillCoords)
    expect(second.tracks[1].elements[0].switchId).toBe('sw-1')
  })
})

// ── The door: what this tool will and will not take ──────────────────────────

const payloadOf = (projects) => ({ version: SCHEMA_VERSION, projects: dehydrateProjects(projects) })

describe('parseProjectsPayload', () => {
  it('takes a payload of the current version and hands the projects back', () => {
    const payload = payloadOf(switchProject())
    expect(parseProjectsPayload(payload).projects).toHaveLength(1)
  })

  it('takes a project with no switches at all', () => {
    expect(parseProjectsPayload(payloadOf(project())).projects).toHaveLength(1)
  })

  it('refuses a file from before the switch model by its version alone', () => {
    // The point of keeping the number monotonic: a version-1 file is turned away
    // as one, not as "some field is missing".
    const payload = { ...payloadOf(switchProject()), version: 1 }
    expect(() => parseProjectsPayload(payload)).toThrow(PayloadError)
    expect(() => parseProjectsPayload(payload)).toThrow('unsupported_version')
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
