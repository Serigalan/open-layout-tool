import { describe, it, expect } from 'vitest'
import {
  findTrackJoints, jointFit, trackEndAt, linkRecord, linkSymbol, claimedEnds,
  existingLinks, linksForJoints, linkAllJoints, JOINT_TOL,
} from './trackLinkUtils'
import { planSwitchDeletion } from './switchDelete'
import { buildInfra } from './exchangeExport'
import { parseOsrdRailJson } from './osrdImport'
import { switchesToPorts } from './alignmentCodec'
import { newSwitchFields, LINK_KIND } from './switchModel'
import { endPointStraightUtm } from './elementUtils'
import { transformPlanePoint, transformGridBearing, utmToWgs84 } from './coordinateUtils'

/**
 * A line does not stop where the coordinate system does. What joins the two
 * chains is a node — a `link` record — and these are the rules by which the app
 * finds where one belongs (trackLinkUtils) and what it becomes on the way out
 * to OSRD.
 */

const UTM = 25832           // ETRS89 / UTM 32N
const GK  = 5683            // DB_REF / GK Zone 3 — the same ground, another plane
const E0 = 500000, N0 = 5600000

/** A straight track of `length` from a point in its own plane, as the store holds one. */
function straight(id, epsg, easting, northing, bearing, length, name = id) {
  const start = { easting, northing, zone: epsg }
  const end   = endPointStraightUtm(start, bearing, length)
  return {
    id, name, epsg,
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

/** The same physical point and heading, stated in another plane. */
function carryOver(easting, northing, bearing, fromCrs, toCrs) {
  const [e, n] = transformPlanePoint(easting, northing, fromCrs, toCrs)
  return { easting: e, northing: n, bearing: transformGridBearing(easting, northing, bearing, fromCrs, toCrs) }
}

/** Track A runs to a point; track B carries on from it in the other plane. */
function acrossThePlanes({ gap = 0, turn = 0 } = {}) {
  const a = straight('a', UTM, E0, N0, 40, 300, 'a')
  const [ae, an] = a.elements[0].endNode
  const carried = carryOver(ae, an, 40, UTM, GK)
  // The joint is pushed apart along the line, and the second track turned, by
  // whatever the case under test wants to see refused.
  const from = endPointStraightUtm({ easting: carried.easting, northing: carried.northing, zone: GK },
    carried.bearing, gap)
  const b = straight('b', GK, from.easting, from.northing, carried.bearing + turn, 250, 'b')
  return [a, b]
}

describe('where a link belongs', () => {
  it('finds the node where one plane hands the line to the next', () => {
    const { joints, fanned } = findTrackJoints(acrossThePlanes(), [])
    expect(fanned).toBe(0)
    expect(joints).toHaveLength(1)
    const [j] = joints
    expect(j.crsChange).toBe(true)
    // Not zero: the node was carried into the other plane and is read back out
    // of it, and a datum transformation is not its own inverse to the last
    // digit. A third of a millimetre is what that costs here.
    expect(j.gap).toBeLessThan(1e-3)
    expect(j.bearingOff).toBeLessThan(1e-6)
    // The end of one and the beginning of the other — read off the tracks, not
    // assumed from the order they were passed in.
    expect([j.a.endpoint, j.b.endpoint].sort()).toEqual(['BEGIN', 'END'])
    expect([j.a.trackId, j.b.trackId].sort()).toEqual(['a', 'b'])
  })

  it('takes a joint the two frames disagree about by a decimetre', () => {
    // What the measured boundaries of the test database look like: the same
    // point, surveyed in two systems, lands 7 mm to 13 cm apart.
    const { joints } = findTrackJoints(acrossThePlanes({ gap: 0.13 }), [])
    expect(joints).toHaveLength(1)
    expect(joints[0].gap).toBeCloseTo(0.13, 3)
  })

  it('refuses one that is further apart than two ends of a line can be', () => {
    expect(findTrackJoints(acrossThePlanes({ gap: JOINT_TOL + 0.5 }), []).joints).toHaveLength(0)
  })

  it('refuses two ends that meet without the line running through', () => {
    // On the node, but leaving it at an angle no joint has.
    expect(findTrackJoints(acrossThePlanes({ turn: 20 }), []).joints).toHaveLength(0)
  })

  it('leaves a joint alone once a switch stands on it', () => {
    const tracks = acrossThePlanes()
    const sw = {
      ...newSwitchFields(), name: 'W 1',
      portA_trackId: 'a', portA_endpoint: 'END',
      portB1_trackId: 'b', portB1_endpoint: 'BEGIN',
      portB2_trackId: null, portB2_endpoint: null,
    }
    expect(claimedEnds([sw])).toEqual(new Set(['a|END', 'b|BEGIN']))
    expect(findTrackJoints(tracks, [sw]).joints).toHaveLength(0)
  })

  it('counts a meeting of three ends as a junction and offers no link', () => {
    const [a, b] = acrossThePlanes()
    // A third track running out of the same node — that is a turnout's toe.
    const [ae, an] = a.elements[0].endNode
    const c = straight('c', UTM, ae, an, 40 + 180, 200, 'c')
    const { joints, fanned } = findTrackJoints([a, b, c], [])
    expect(joints).toHaveLength(0)
    expect(fanned).toBe(1)
  })

  it('never joins a track to itself', () => {
    // A closed loop meets its own beginning; that is not a joint between two
    // tracks and nothing is offered for it.
    const a = straight('a', UTM, E0, N0, 0, 100)
    a.elements.push({
      ...a.elements[0],
      startNode: a.elements[0].endNode,
      endNode: a.elements[0].startNode,
      bearing: 180, endBearing: 180, absLength: 200,
    })
    expect(findTrackJoints([a], []).joints).toHaveLength(0)
  })

  it('finds a joint inside one plane too — OSRD needs the node either way', () => {
    const a = straight('a', UTM, E0, N0, 90, 200)
    const [ae, an] = a.elements[0].endNode
    const b = straight('b', UTM, ae, an, 90, 150)
    const { joints } = findTrackJoints([a, b], [])
    expect(joints).toHaveLength(1)
    expect(joints[0].crsChange).toBe(false)
  })

  it('puts the plane changes first — they are the ones with no alternative', () => {
    const [a, b] = acrossThePlanes()
    const c = straight('c', UTM, E0, N0, 40 + 180, 120, 'c')   // meets a's BEGIN
    const { joints } = findTrackJoints([a, b, c], [])
    expect(joints).toHaveLength(2)
    expect(joints.map(j => j.crsChange)).toEqual([true, false])
  })
})

describe('reading a joint', () => {
  it('measures the gap in the first end’s own plane and carries the bearing over', () => {
    const [a, b] = acrossThePlanes({ gap: 2 })
    const fit = jointFit(trackEndAt(a, 'END'), trackEndAt(b, 'BEGIN'))
    // Measured in UTM, where the two metres laid out in GK are two metres less
    // the difference of the two scale factors — 0.7 mm over this distance.
    expect(fit.gap).toBeCloseTo(2, 2)
    expect(fit.bearingOff).toBeLessThan(1e-6)
  })

  it('describes both ends of a track the same way — outward, into the track', () => {
    const a = straight('a', UTM, E0, N0, 90, 200)
    expect(trackEndAt(a, 'BEGIN').outward).toBeCloseTo(90, 9)
    expect(trackEndAt(a, 'END').outward).toBeCloseTo(270, 9)
  })

  it('has nothing to say about a track with no elements', () => {
    expect(trackEndAt({ id: 'x', elements: [] }, 'END')).toBe(null)
  })
})

describe('the record a joint becomes', () => {
  const [a, b] = acrossThePlanes()
  const joint = findTrackJoints([a, b], []).joints[0]

  it('is a link with the two ends as its ports and no route', () => {
    const rec = linkRecord(joint, 'link.001')
    expect(rec.kind).toBe(LINK_KIND)
    expect(rec.name).toBe('link.001')
    expect(rec.formVersion).not.toBe(undefined)
    expect(rec.portA_trackId).toBe(joint.a.trackId)
    expect(rec.portA_endpoint).toBe(joint.a.endpoint)
    expect(rec.portB_trackId).toBe(joint.b.trackId)
    expect(rec.portB_endpoint).toBe(joint.b.endpoint)
    // It owns no track geometry at all.
    expect(rec.portB1_trackId).toBe(undefined)
  })

  it('draws a closed body on the node so the node can be picked at all', () => {
    const byId = { a, b }
    const rec = linkSymbol(linkRecord(joint, 'link.001'), byId)
    expect(rec.fillCoords[0]).toEqual(rec.fillCoords[rec.fillCoords.length - 1])
    expect(rec.fillCoords).toHaveLength(5)
    const [lng, lat] = rec.bodyCentre
    const end = trackEndAt(byId[rec.portA_trackId], rec.portA_endpoint)
    expect([lng, lat]).toEqual(utmToWgs84(end.easting, end.northing, end.epsg))
    // Every corner is within the symbol's own reach of the node.
    for (const [cLng, cLat] of rec.fillCoords) {
      expect(Math.abs(cLng - lng)).toBeLessThan(1e-4)
      expect(Math.abs(cLat - lat)).toBeLessThan(1e-4)
    }
  })

  it('carries no body where the port names no track', () => {
    expect(linkSymbol(linkRecord(joint, 'x'), {}).fillCoords).toBe(undefined)
  })
})

describe('a link on the way to OSRD and back', () => {
  const [a, b] = acrossThePlanes()
  const joint = findTrackJoints([a, b], []).joints[0]
  const rec = linkRecord(joint, 'link.001')

  it('is written as OSRD’s own link node, with ports A and B', () => {
    const [written] = switchesToPorts([rec], { a, b }, [])
    expect(written.switch_type).toBe('link')
    expect(written.ports).toEqual({
      A: { track: joint.a.trackId, endpoint: joint.a.endpoint },
      B: { track: joint.b.trackId, endpoint: joint.b.endpoint },
    })
    expect(written.extensions.sncf.label).toBe('link.001')
    expect(written.id).toBe(rec.switchId)
  })

  it('comes back as a link and not as a turnout wearing its name', () => {
    const { switches, errors } = parseOsrdRailJson(buildInfra([a, b], [rec], [], {}))
    expect(errors).toEqual([])
    expect(switches).toHaveLength(1)
    const back = switches[0]
    expect(back.kind).toBe(LINK_KIND)
    expect(back.name).toBe('link.001')
    expect(back.portA_trackId).toBe(joint.a.trackId)
    expect(back.portA_endpoint).toBe(joint.a.endpoint)
    expect(back.portB_trackId).toBe(joint.b.trackId)
    expect(back.portB_endpoint).toBe(joint.b.endpoint)
  })

  it('is dropped where the file brings no track for one of its ports', () => {
    const { switches } = parseOsrdRailJson(buildInfra([a], [rec], [], {}))
    expect(switches).toEqual([])
  })
})

describe('deleting a link', () => {
  const [a, b] = acrossThePlanes()
  const rec = linkRecord(findTrackJoints([a, b], []).joints[0], 'link.001')

  it('takes the record and leaves both tracks exactly as they were', () => {
    const plan = planSwitchDeletion(rec, [a, b])
    expect(plan.switchId).toBe(rec.switchId)
    expect(plan.reason).toBe('link')
    expect(plan.removeTrackIds).toEqual([])
    expect(plan.updateTracks).toEqual([])
    expect(plan.removedElements).toBe(0)
    expect(plan.joined).toBe(false)
  })
})

describe('the links a project already has', () => {
  const [a, b] = acrossThePlanes({ gap: 0.4 })
  const joint = findTrackJoints([a, b], []).joints[0]

  it('measures each one the way a candidate is measured', () => {
    const [link] = existingLinks([linkRecord(joint, 'link.001')], [a, b])
    expect(link.sw.name).toBe('link.001')
    expect(link.crsChange).toBe(true)
    expect(link.gap).toBeCloseTo(0.4, 2)
    expect(link.bearingOff).toBeLessThan(1e-6)
    expect([link.a.endpoint, link.b.endpoint].sort()).toEqual(['BEGIN', 'END'])
  })

  it('says nothing about a link whose track is gone, and says it first', () => {
    const wide = linkRecord(joint, 'wide')
    const broken = { ...linkRecord(joint, 'broken'), portA_trackId: 'no-such-track' }
    const links = existingLinks([wide, broken], [a, b])
    expect(links.map(l => l.sw.name)).toEqual(['broken', 'wide'])
    expect(links[0].gap).toBe(null)
    expect(links[0].a).toBe(null)
  })

  it('sorts the widest first — a link is worth looking at where it is wide', () => {
    const near = straight('c', UTM, E0, N0, 220, 100, 'c')
    const tight = findTrackJoints([a, near], []).joints[0]
    const links = existingLinks(
      [linkRecord(tight, 'tight'), linkRecord(joint, 'wide')], [a, b, near])
    expect(links.map(l => l.sw.name)).toEqual(['wide', 'tight'])
  })

  it('leaves everything that is not a link out of the list', () => {
    const turnout = { ...newSwitchFields(), name: 'W 1', portA_trackId: 'a', portA_endpoint: 'END' }
    expect(existingLinks([turnout], [a, b])).toEqual([])
  })
})

describe('writing the links of a whole import', () => {
  it('names them in order and steps over a name already taken', () => {
    const [a, b] = acrossThePlanes()
    const { links, joints, fanned } = linkAllJoints([a, b], [], ['link.001'])
    expect(joints).toHaveLength(1)
    expect(fanned).toBe(0)
    expect(links).toHaveLength(1)
    expect(links[0].name).toBe('link.002')
    expect(links[0].kind).toBe(LINK_KIND)
    // Ready to commit: the body is on it, not left to a later reload.
    expect(links[0].fillCoords).toHaveLength(5)
  })

  it('writes nothing where a switch already holds the ends', () => {
    const [a, b] = acrossThePlanes()
    const sw = {
      ...newSwitchFields(), name: 'W 1',
      portA_trackId: 'a', portA_endpoint: 'END',
      portB1_trackId: 'b', portB1_endpoint: 'BEGIN',
    }
    expect(linkAllJoints([a, b], [sw]).links).toEqual([])
  })

  it('numbers a whole set without collisions', () => {
    const [a, b] = acrossThePlanes()
    const c = straight('c', UTM, E0, N0, 220, 120, 'c')     // meets a's BEGIN
    const { links } = linkAllJoints([a, b, c], [])
    expect(links.map(l => l.name)).toEqual(['link.001', 'link.002'])
    expect(new Set(links.map(l => l.switchId)).size).toBe(2)
  })

  it('takes the joints of linksForJoints without a track index it cannot use', () => {
    const [a, b] = acrossThePlanes()
    const joints = findTrackJoints([a, b], []).joints
    // No tracks handed in: the records are still right, they just carry no body.
    expect(linksForJoints(joints, {})[0].fillCoords).toBe(undefined)
  })
})
