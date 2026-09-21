import { fromArrayBuffer } from 'geotiff'
import proj4 from 'proj4'

/**
 * The BeTA2007 grid (AdV, official DHDN→ETRS89 transition) — the difference
 * between the 7-parameter Helmert approximation `dhdnProj` falls back to
 * (~1 m, p95) and the roughly 5 cm the plan view needs. The file is the one
 * checked into `grids/` (24 kB, converted by the AdV/PROJ project from the
 * original BETA2007.gsb, open licence) and symlinked into `public/data/` the
 * same way the kilometrage tiles are — `npm run dev`/`build` pick it up
 * without a separate step.
 *
 * proj4 loads a GeoTIFF grid asynchronously, but `projStringFor` is not — so
 * this is awaited once at startup **before** `initStorage()` (see main.jsx:
 * hydrating the store converts every DHDN coordinate, so the grid has to be
 * there first), and every proj string decides towgs84-vs-nadgrids off
 * `ntv2Ready()` afterwards. A failed load (offline dev server, blocked asset)
 * leaves `ntv2Ready()` false forever: DHDN keeps working at the 1 m fallback
 * rather than the app refusing to start.
 *
 * ## The regional grids
 *
 * BeTA2007 is nationwide and coarse: 62 × 84 nodes at 600″ × 360″, about
 * 11 km. Some states publish their own, finer transformation, and where one
 * covers the data it is the better answer — measured inside Hesse the two
 * differ by 1.4 cm on average and 5.7 cm at worst.
 *
 * Those are not loaded at startup. proj4 keeps every grid node as its own
 * array of two numbers, some 80 bytes: Hesse is 1.03 M nodes and costs 83 MB
 * of heap and 2.5 s, where BeTA2007 costs 1.4 MB. So a regional grid is loaded
 * only when something asks for the area it covers — today that is the importer
 * that carries a survey alignment into DB_REF (mdbImport, planeTransform),
 * which is the one place where the difference is worth the price.
 *
 * Once loaded a grid stays: proj4 offers no way to drop one. That is why
 * `loadGridsFor` takes the area first and loads nothing that does not overlap.
 *
 * **What is here, and what is not.** Only two German states publish a DHDN
 * grid that this can read. The rest are either not published at all any more —
 * Bavaria's Landesamt withdrew its cadastral transformation at the end of 2024
 * and now offers BeTA2007 itself — or exist only as copies encrypted for one
 * vendor's own software (the `_KS` files in KilletSoft's collection, which
 * proj4 cannot even read the endianness of), or are too large to load in a
 * browser at all (Baden-Württemberg's BWTA2017 is 71 MB as a GeoTIFF, some
 * 4.7 GB of heap by the measure above). Saxony and Thuringia publish grids for
 * RD/83 and PD/83, which are their own datums and not the DHDN this block is
 * about. Everything not listed here therefore runs on BeTA2007, which is what
 * its own state survey recommends.
 */

export const GRID_KEY = 'BETA2007'

const gridUrl = (file) => `data/${file}`
const BETA_URL = import.meta.env.VITE_OLT_NTV2_GRID ?? gridUrl('de_adv_BETA2007.tif')

/**
 * Finer DHDN grids, each over the area it was surveyed for. `bbox` is
 * [west, south, east, north] in degrees, read off the file itself. Adding one
 * is the file in `grids/`, a symlink in `public/data/`, and an entry here.
 */
export const REGIONAL_GRIDS = [
  {
    key: 'HETA2010', name: 'Hessen HeTA2010', file: 'de_hvbg_hessen_HeTA2010.tif',
    bbox: [7.500, 49.331, 10.503, 51.867],
  },
  {
    key: 'SETA2016', name: 'Saarland SeTa2016', file: 'de_lgvl_saarland_SeTa2016.tif',
    bbox: [6.345, 49.099, 7.457, 49.647],
  },
]

let ready = false
const loaded = new Set()
let nadgrids = GRID_KEY

export function ntv2Ready() {
  return ready
}

/**
 * The `+nadgrids=` list a DHDN proj string carries: every regional grid that
 * has been loaded, each optional so a point outside it falls through, and
 * BeTA2007 last and mandatory because it covers the whole country. Held as a
 * finished string rather than built per call — `projStringFor` runs once per
 * converted point.
 */
export function nadgridsList() {
  return nadgrids
}

/** The regional grids loaded so far, in the order proj4 will try them. */
export const loadedRegionalGrids = () => REGIONAL_GRIDS.filter(g => loaded.has(g.key))

const overlaps = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]

/** The regional grids whose area meets `bbox` ([w, s, e, n] in degrees). */
export const gridsCovering = (bbox) =>
  (bbox ? REGIONAL_GRIDS.filter(g => overlaps(g.bbox, bbox)) : [])

async function readGrid(key, url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  const tiff = await fromArrayBuffer(await res.arrayBuffer())
  await proj4.nadgrid(key, tiff).ready
}

export async function loadNtv2Grid() {
  try {
    await readGrid(GRID_KEY, BETA_URL)
    ready = true
  } catch (err) {
    console.error('BeTA2007 grid did not load — DHDN keeps the 1 m fallback', err)
  }
}

/**
 * Load every regional grid covering `bbox`, and return the ones now in force.
 * Does nothing without BeTA2007 underneath: the regional grids are optional
 * entries in front of it, and a list of nothing but optional grids would leave
 * a point outside them all with no transformation at all.
 *
 * One that fails to load is reported and skipped — the area it covers falls
 * through to BeTA2007, which is where it was before.
 */
export async function loadGridsFor(bbox) {
  if (!ready) return []
  for (const grid of gridsCovering(bbox)) {
    if (loaded.has(grid.key)) continue
    try {
      await readGrid(grid.key, gridUrl(grid.file))
      loaded.add(grid.key)
    } catch (err) {
      console.error(`${grid.name} did not load — BeTA2007 covers its area instead`, err)
    }
  }
  nadgrids = [...loadedRegionalGrids().map(g => `@${g.key}`), GRID_KEY].join(',')
  return loadedRegionalGrids()
}
