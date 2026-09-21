import { fromArrayBuffer } from 'geotiff'
import proj4 from 'proj4'

/**
 * The NTv2 grids the historic datums are converted on.
 *
 * A datum shift stated as seven parameters is good to about a metre; a grid is
 * good to a few centimetres, which is what the plan view needs. Each datum
 * therefore has a **base grid** covering its whole area, loaded at startup, and
 * may have finer **regional grids** over parts of it, loaded only when an
 * import asks for that area.
 *
 * proj4 loads a GeoTIFF grid asynchronously, but `projStringFor` is not — so
 * the base grids are awaited once at startup **before** `initStorage()` (see
 * main.jsx: hydrating the store converts every historic coordinate, so the
 * grids have to be there first), and every proj string decides
 * grid-vs-Helmert off `nadgridsList(datum)` afterwards. A failed load leaves
 * that datum on its 7-parameter shift: the app keeps working at metre level
 * rather than refusing to start.
 *
 * The files are the ones checked into `grids/` (converted from the surveys'
 * own NTv2 releases by the PROJ project, https://cdn.proj.org) and symlinked
 * into `public/data/` the same way the kilometrage tiles are — `npm run
 * dev`/`build` pick them up without a separate step.
 *
 * ## What is here, and what is not
 *
 * - **DHDN** (`EA0`, EPSG 5676–5680, and Soldner Berlin 3068) runs on
 *   BeTA2007, the AdV's nationwide transition, 62 × 84 nodes at 600″ × 360″.
 *   Hesse and Saarland publish finer ones over their own territory — measured
 *   inside Hesse the two differ by 1.4 cm on average and 5.7 cm at worst.
 * - **PD/83** (`DB0`, Thüringen, EPSG 3396/3397) has one grid covering the
 *   whole state at 30 438 nodes and 72 kB, so it is a base grid: cheap enough
 *   to load at startup, and the only correct answer for that datum. BeTA2007
 *   is *not* a substitute — measured against it across Thüringen, BeTA2007
 *   differs by 13 cm on average and 74 cm at worst, because its source datum
 *   is DHDN and not PD/83 (EPSG: "consistent with DHDN at the 1-metre level").
 * - **RD/83** (Sachsen, EPSG 3398/3399) publishes one too, and it is not here:
 *   the Lagesystem letter `A` covers the western states and Sachsen alike
 *   (mdbImport), so no import can say that a chain is Saxon rather than DHDN,
 *   and nothing would ever ask for the grid. It is 4.25 MB and some 2.4 M
 *   nodes — 188 MB of heap — so it waits for a dataset that needs it. Until
 *   then RD/83 runs on its own 7-parameter shift, which against the grid is
 *   12 cm typical and 40 cm worst.
 * - **42/83** (Brandenburg, Mecklenburg, Sachsen-Anhalt) has no published
 *   grid; EPSG rates its 7-parameter shift at 0.1 m, which is the best there
 *   is. **DB_REF** needs none — its own parameters are exact by construction.
 *
 * Everything else German is either not published any more (Bayern's Landesamt
 * withdrew its cadastral transformation at the end of 2024 and now offers
 * BeTA2007 itself), published only encrypted for one vendor's software (the
 * `_KS` files in KilletSoft's collection, whose endianness proj4 cannot even
 * read), or too large for a browser (Baden-Württemberg's BWTA2017 is 73 MB as
 * a GeoTIFF, some 4.7 GB of heap by the measure above).
 *
 * Licences: BeTA2007 AdV, open; HeTA2010 HVBG; SeTa2016 LVGL Saarland;
 * NTv2gridTH TLBG Thüringen, CC-BY 4.0.
 *
 * Once loaded a grid stays: proj4 offers no way to drop one. That is why
 * `loadGridsFor` takes the area and the datums first and loads nothing that
 * does not overlap or is not asked for.
 */

/** The DHDN base grid — named because it is the one the app cannot do without. */
export const GRID_KEY = 'BETA2007'

const gridUrl = (file) => `data/${file}`
const BETA_URL = import.meta.env.VITE_OLT_NTV2_GRID ?? gridUrl('de_adv_BETA2007.tif')

/**
 * One per datum, covering all of it, loaded at startup. `bbox` is
 * [west, south, east, north] in degrees, read off the file itself.
 */
export const BASE_GRIDS = [
  {
    key: GRID_KEY, name: 'BeTA2007', datum: 'DHDN', file: 'de_adv_BETA2007.tif',
    url: BETA_URL, bbox: [5.500, 46.900, 15.833, 55.300],
  },
  {
    key: 'NTV2TH', name: 'Thüringen NTv2gridTH', datum: 'PD83',
    file: 'de_tlbg_thueringen_NTv2gridTH.tif', bbox: [9.833, 50.192, 12.683, 51.675],
  },
]

/**
 * Finer, or simply too expensive to carry always. Loaded by area and datum,
 * once, by the importer that carries a survey alignment into DB_REF. Adding
 * one is the file in `grids/`, a symlink in `public/data/`, and an entry here.
 */
export const REGIONAL_GRIDS = [
  {
    key: 'HETA2010', name: 'Hessen HeTA2010', datum: 'DHDN',
    file: 'de_hvbg_hessen_HeTA2010.tif', bbox: [7.500, 49.331, 10.503, 51.867],
  },
  {
    key: 'SETA2016', name: 'Saarland SeTa2016', datum: 'DHDN',
    file: 'de_lgvl_saarland_SeTa2016.tif', bbox: [6.345, 49.099, 7.457, 49.647],
  },
]

const ALL_GRIDS = [...BASE_GRIDS, ...REGIONAL_GRIDS]

const loaded = new Set()
const lists = new Map()

/** Whether the DHDN base grid is there — the one every plan view depends on. */
export function ntv2Ready() {
  return loaded.has(GRID_KEY)
}

/**
 * The `+nadgrids=` list a datum's proj string carries, or null while it has no
 * grid at all and has to fall back to its 7-parameter shift.
 *
 * Every regional grid that has been loaded comes first and optional, so a
 * point outside one falls through to the next; the last entry is never
 * optional, because a list of nothing but optional grids leaves a point
 * outside them all with no shift at all — 600 m out, silently. A point past
 * the last grid's edge comes back as NaN instead, which `coordinateUtils`
 * catches and converts again without the grid.
 *
 * Held as a finished string per datum rather than built per call —
 * `projStringFor` runs once per converted point.
 */
export function nadgridsList(datum = 'DHDN') {
  return lists.get(datum) ?? null
}

/** The regional grids loaded so far, in the order proj4 will try them. */
export const loadedRegionalGrids = () => REGIONAL_GRIDS.filter(g => loaded.has(g.key))

const overlaps = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]

/**
 * The regional grids whose area meets `bbox` ([w, s, e, n] in degrees) and
 * whose datum is one of `datums` (all of them when that is left out).
 */
export const gridsCovering = (bbox, datums = null) => (bbox
  ? REGIONAL_GRIDS.filter(g => overlaps(g.bbox, bbox) && (!datums || datums.includes(g.datum)))
  : [])

function rebuildLists() {
  lists.clear()
  for (const datum of new Set(ALL_GRIDS.map(g => g.datum))) {
    const keys = [
      ...REGIONAL_GRIDS.filter(g => g.datum === datum && loaded.has(g.key)).map(g => g.key),
      ...BASE_GRIDS.filter(g => g.datum === datum && loaded.has(g.key)).map(g => g.key),
    ]
    if (!keys.length) continue
    lists.set(datum, keys.map((k, i) => (i < keys.length - 1 ? `@${k}` : k)).join(','))
  }
}

async function readGrid(grid) {
  const res = await fetch(grid.url ?? gridUrl(grid.file))
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  const tiff = await fromArrayBuffer(await res.arrayBuffer())
  await proj4.nadgrid(grid.key, tiff).ready
  loaded.add(grid.key)
}

/**
 * The base grids, in parallel — they are 24 kB and 72 kB, and the app waits
 * for them before it draws anything. One that fails is reported and left out;
 * its datum keeps the 7-parameter shift.
 */
export async function loadNtv2Grid() {
  await Promise.all(BASE_GRIDS.map(async (grid) => {
    try {
      await readGrid(grid)
    } catch (err) {
      console.error(`${grid.name} did not load — ${grid.datum} keeps its 7-parameter shift`, err)
    }
  }))
  rebuildLists()
}

/**
 * Load every regional grid covering `bbox` in one of `datums`, and return the
 * ones now in force.
 *
 * A DHDN refinement needs BeTA2007 underneath it — it covers one state, and
 * the nationwide grid is what carries every point outside. The others stand on
 * their own: outside their area the point comes back NaN and is converted
 * again on the datum's 7-parameter shift.
 *
 * One that fails to load is reported and skipped — the area it covers falls
 * back to what was converting it before.
 */
export async function loadGridsFor(bbox, datums = null) {
  for (const grid of gridsCovering(bbox, datums)) {
    if (loaded.has(grid.key)) continue
    if (grid.datum === 'DHDN' && !ntv2Ready()) continue
    try {
      await readGrid(grid)
    } catch (err) {
      console.error(`${grid.name} did not load — its area keeps the shift it had`, err)
    }
  }
  rebuildLists()
  return loadedRegionalGrids()
}
