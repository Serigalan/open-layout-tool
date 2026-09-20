import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import { loadNtv2Grid, ntv2Ready } from './ntv2Grid'
import { projStringFor, utmToWgs84 } from './coordinateUtils'

/**
 * The BeTA2007 grid the plan view needs for DHDN accuracy (~5 cm, not the
 * ~1 m the 7-parameter fallback gets to). `fetch` has no relative-URL base in
 * Vitest's node environment, so the one request `loadNtv2Grid` makes is
 * answered from the checked-in file directly — this is the same 24 kB file
 * `public/data/de_adv_BETA2007.tif` symlinks to.
 */

const realFetch = globalThis.fetch

beforeAll(() => {
  globalThis.fetch = async (url) => {
    if (String(url).includes('de_adv_BETA2007.tif')) {
      const buf = fs.readFileSync(new URL('../../grids/de_adv_BETA2007.tif', import.meta.url))
      return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }
    }
    return realFetch(url)
  }
})

afterAll(() => {
  globalThis.fetch = realFetch
})

// A DHDN/GK4 point (EPSG:5678) checked against pyproj's own default,
// highest-accuracy operation for EPSG:5678→EPSG:4326 ("DHDN to WGS 84 (4)",
// which is BeTA2007): (11.99848979491784, 51.4346534646784).
const POINT = { e: 4500000, n: 5700000 }
const PYPROJ_WITH_GRID = [11.99848979491784, 51.4346534646784]
const PYPROJ_HELMERT_ONLY = [11.998495005803541, 51.43465043812007]

describe('DHDN before the grid loads', () => {
  it('is not ready yet', () => {
    expect(ntv2Ready()).toBe(false)
  })

  it('falls back to the 7-parameter Helmert shift', () => {
    expect(projStringFor(5678)).toMatch(/\+towgs84=598\.1,73\.7,418\.2/)
    const [lng, lat] = utmToWgs84(POINT.e, POINT.n, 5678)
    expect(lng).toBeCloseTo(PYPROJ_HELMERT_ONLY[0], 6)
    expect(lat).toBeCloseTo(PYPROJ_HELMERT_ONLY[1], 6)
  })
})

describe('DHDN once the grid has loaded', () => {
  beforeAll(async () => {
    await loadNtv2Grid()
  })

  it('is ready', () => {
    expect(ntv2Ready()).toBe(true)
  })

  it('replaces the Helmert shift with the grid, not just adds to it', () => {
    expect(projStringFor(5678)).toMatch(/\+nadgrids=BETA2007/)
    expect(projStringFor(5678)).not.toMatch(/towgs84/)
  })

  it('matches the grid-based operation PROJ itself picks as most accurate', () => {
    const [lng, lat] = utmToWgs84(POINT.e, POINT.n, 5678)
    expect(lng).toBeCloseTo(PYPROJ_WITH_GRID[0], 9)
    expect(lat).toBeCloseTo(PYPROJ_WITH_GRID[1], 9)
  })

  it('leaves DB_REF alone — its 7-parameter set is already exact', () => {
    expect(projStringFor(5684)).toMatch(/\+towgs84=584\.9636/)
  })
})
