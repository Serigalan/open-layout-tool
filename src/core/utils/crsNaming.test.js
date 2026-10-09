import { describe, it, expect } from 'vitest'
import { crsLabel, crsName, projStringFor, EPSG_OPTIONS, gkZone } from './coordinateUtils'

/**
 * Every EPSG code this tool has a plane for is also named — the picker offers a
 * handful of them, but a track can carry any of them (the MDB import brings
 * every Lagesystem of the DB ASCII interface), and a column or a plan sheet
 * showing a bare number leaves the reader to look the frame up. The naming is
 * therefore tied to projStringFor: what one resolves, the other names.
 */

const SUPPORTED = [
  ...[5676, 5677, 5678, 5679, 5680],                 // DHDN / GK
  ...[5681, 5682, 5683, 5684, 5685],                 // DB_REF / GK
  ...[3396, 3397],                                   // PD/83, Thüringen
  ...[3398, 3399],                                   // RD/83, Sachsen
  ...[2397, 2398, 2399],                             // 42/83, the eastern states
  3068,                                              // DHDN / Soldner Berlin
  ...[25828, 25832, 25838],                          // ETRS89 / UTM
  ...[32601, 32632, 32660],                          // WGS 84 / UTM north
  ...[32701, 32732, 32760],                          // WGS 84 / UTM south
]

describe('crsName', () => {
  it('names every code projStringFor resolves', () => {
    for (const code of SUPPORTED) {
      expect(() => projStringFor(code)).not.toThrow()
      expect(crsName(code), String(code)).toBeTruthy()
    }
  })

  it('names nothing projStringFor refuses', () => {
    for (const code of [0, 2396, 2400, 3067, 3069, 3395, 3400, 4326, 5675, 5686, 25839, 32661, 32700]) {
      expect(() => projStringFor(code)).toThrow()
      expect(crsName(code), String(code)).toBe(null)
    }
  })

  it('names the two Gauss-Krüger blocks apart, by the zone each code means', () => {
    expect(crsName(5678)).toBe('DHDN / GK Zone 4')
    expect(crsName(5684)).toBe('DB_REF / GK Zone 4')
    // The DHDN block is not contiguous by zone — 5680 is zone 1, not zone 6.
    expect(crsName(5680)).toBe('DHDN / GK Zone 1')
    for (const code of SUPPORTED) {
      const zone = gkZone(code)
      if (zone != null) expect(crsName(code).endsWith(` Zone ${zone}`), String(code)).toBe(true)
    }
  })

  it('tells the Bessel frames apart, which share their coordinates', () => {
    // 3 591 048 in the 9° strip is the same number in PD/83 and in DB_REF; the
    // datum is the only thing that says which point on the ground it is.
    expect(crsName(3396)).toBe('PD/83 / GK Zone 3')
    expect(crsName(5683)).toBe('DB_REF / GK Zone 3')
    expect(crsName(5677)).toBe('DHDN / GK Zone 3')
    expect(crsName(3398)).toBe('RD/83 / GK Zone 4')
    expect(crsName(2398)).toBe('42/83 / GK Zone 4')
    expect(projStringFor(2398)).toMatch(/\+ellps=krass/)      // Krassowski, not Bessel
    expect(projStringFor(3396)).toMatch(/\+ellps=bessel/)
  })

  it('names Berlin’s Soldner net, the one plane without a strip', () => {
    expect(crsName(3068)).toBe('DHDN / Soldner Berlin')
    expect(gkZone(3068)).toBe(null)
    expect(projStringFor(3068)).toMatch(/\+proj=cass/)
  })

  it('keeps the hemisphere of a UTM zone', () => {
    expect(crsName(25832)).toBe('ETRS89 / UTM Zone 32N')
    expect(crsName(32632)).toBe('WGS 84 / UTM Zone 32N')
    expect(crsName(32732)).toBe('WGS 84 / UTM Zone 32S')
  })

  // A code given as the string a <select> hands back is the same code.
  it('reads a numeric string like the number', () => {
    expect(crsName('5678')).toBe(crsName(5678))
  })
})

describe('crsLabel', () => {
  it('writes the code out with its name', () => {
    expect(crsLabel(5678)).toBe('EPSG 5678 – DHDN / GK Zone 4')
  })

  it('still states a code it cannot name', () => {
    expect(crsLabel(4326)).toBe('EPSG 4326')
  })

  it('says nothing about a track that names no CRS', () => {
    expect(crsLabel(null)).toBe('')
    expect(crsLabel(undefined)).toBe('')
    expect(crsLabel(0)).toBe('')
  })
})

describe('EPSG_OPTIONS', () => {
  it('offers the current frames a new track is laid out in', () => {
    expect(EPSG_OPTIONS.map(o => o.code)).toEqual([25831, 25832, 25833, 5681, 5682, 5683, 5684, 5685])
  })

  it('labels each option the way everything else names that code', () => {
    for (const { code, label } of EPSG_OPTIONS) expect(label).toBe(crsName(code))
  })
})
