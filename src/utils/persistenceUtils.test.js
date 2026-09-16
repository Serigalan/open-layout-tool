import { describe, it, expect } from 'vitest'
import { dehydrateProjects, hydrateProjects, SCHEMA_VERSION } from './persistenceUtils'
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

// ── A project from before the switch id, loaded by the current app ───────────

const SWITCH_EPSG = 25832
const FORM = SWITCH_TYPES[1]                       // 300 – 1:9

/**
 * A facing turnout on a straight, written the way records were written before
 * switchId existed: the record names itself and its elements name it back.
 */
function legacySwitchProject() {
  const toe = { easting: 500000, northing: 5600000, zone: SWITCH_EPSG }
  const g = computeSwitchGeometryUtm(toe, 30, FORM, 'right', false)
  const mark = (route) => ({
    switchBranch: true, switchRoute: route, switchName: 'switch.001', switchLabel: FORM.label,
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
      name: 'switch.001', label: FORM.label, trailing: false,
      portA_trackId: null,       portA_endpoint:  null,
      portB1_trackId: 'branch',  portB1_endpoint: 'BEGIN',
      portB2_trackId: 'through', portB2_endpoint: 'BEGIN',
    }],
  }]
}

describe('loading a project written before the switch id', () => {
  it('the store declares the version that introduced it', () => {
    expect(SCHEMA_VERSION).toBe(2)
  })

  it('gives the record an id, a kind and the form version it was built against', () => {
    const [p] = hydrateProjects(legacySwitchProject())
    const [sw] = p.switches
    expect(sw.switchId).toMatch(/^[0-9a-f-]{36}$/)
    expect(sw.kind).toBe(DEFAULT_SWITCH_KIND)
    expect(sw.formVersion).toBe(SWITCH_FORM_VERSION)
  })

  it('writes that id onto the elements of both routes', () => {
    const [p] = hydrateProjects(legacySwitchProject())
    const id = p.switches[0].switchId
    for (const track of p.tracks) {
      expect(track.elements[0].switchId).toBe(id)
    }
  })

  it('still rebuilds the symbol — the migration runs before the routes are read back', () => {
    const [p] = hydrateProjects(legacySwitchProject())
    const [sw] = p.switches
    expect(sw.fillCoords.length).toBeGreaterThan(2)
    expect(sw.lcsCoords).toHaveLength(2)
    expect(sw.bauform).toBe('plain')
    expect(sw.bodyCentre).toHaveLength(2)
  })

  it('a reload after the migration is stable — same id, same symbol', () => {
    const [first]  = hydrateProjects(legacySwitchProject())
    const [second] = hydrateProjects(dehydrateProjects(structuredClone([first])))
    expect(second.switches[0].switchId).toBe(first.switches[0].switchId)
    expect(second.switches[0].fillCoords).toEqual(first.switches[0].fillCoords)
    expect(second.tracks[1].elements[0].switchId).toBe(first.switches[0].switchId)
  })
})
