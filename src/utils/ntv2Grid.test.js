import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import { loadNtv2Grid, ntv2Ready } from './ntv2Grid'
import { projStringFor, utmToWgs84, wgs84ToUTM } from './coordinateUtils'

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

  it('moves the point by a good half metre — what the order at startup buys', () => {
    // Both readings of the same DHDN point, measured against each other in a
    // metric frame. This is the error a track carries for the rest of the
    // session if its geometry was built before the grid arrived, and the whole
    // reason main.jsx loads the grid before it hydrates the store.
    //
    // How large it is depends on where: 0.49 m at this point, and 0.94 m over
    // the München data the MDB import brings. The bound is wide because the
    // figure is the Helmert set's error field, not a constant.
    const before = wgs84ToUTM(PYPROJ_HELMERT_ONLY, 25832)
    const after  = wgs84ToUTM(PYPROJ_WITH_GRID, 25832)
    const apart  = Math.hypot(after.easting - before.easting, after.northing - before.northing)
    expect(apart).toBeGreaterThan(0.3)
    expect(apart).toBeLessThan(1.5)
  })
})

describe('the order the app starts in', () => {
  // The dependency runs one way — hydrating the store converts DHDN
  // coordinates, the grid needs nothing from the store — so the two may not be
  // started side by side. Read off the source because that is where the
  // ordering lives; there is no seam in a three-line bootstrap to test through.
  const main = fs.readFileSync(new URL('../main.jsx', import.meta.url), 'utf8')

  it('waits for the grid before it hydrates the store', () => {
    expect(main).toMatch(/loadNtv2Grid\(\)\s*\.then\(\s*initStorage\s*\)/)
  })

  it('does not start the two side by side', () => {
    const together = /Promise\.all\(\[[^\]]*initStorage[^\]]*loadNtv2Grid[^\]]*\]\)/
    expect(main).not.toMatch(together)
  })
})
