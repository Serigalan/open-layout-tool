// The MDB import off the main thread (R9.3): building the tracks, placing the
// switches and carrying everything into one plane take seconds on a whole
// database, and the page would stand still for them. The notes come back as
// { key, params } — the translation stays with the page, which has the language.
import { runMdbImport } from './mdbPipeline'
import { loadNtv2Grid, loadRegionalGrids, loadGridsFor, loadedRegionalGrids } from '../ntv2Grid'

self.onmessage = async (e) => {
  const { base, grids, ...args } = e.data
  try {
    // The grids the page converts with: the base ones and whatever regional
    // ones it has loaded, so a coordinate comes out here as it would there.
    await loadNtv2Grid({ base })
    await loadRegionalGrids(grids, { base })
    const result = await runMdbImport({
      ...args,
      fill: (key, params) => ({ key, params }),
      loadGrids: (bbox, datums) => loadGridsFor(bbox, datums, { base }),
    })
    self.postMessage({ ok: true, result, grids: loadedRegionalGrids().map(g => g.key) })
  } catch (err) {
    self.postMessage({ ok: false, message: err?.message ?? String(err) })
  }
}
