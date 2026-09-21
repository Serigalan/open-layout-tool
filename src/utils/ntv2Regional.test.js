import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import {
  REGIONAL_GRIDS, gridsCovering, loadGridsFor, loadedRegionalGrids,
  nadgridsList, loadNtv2Grid, GRID_KEY,
} from './ntv2Grid'
import { projStringFor, utmToWgs84, wgs84ToUTM } from './coordinateUtils'

/**
 * The finer grids some states publish. They are not loaded at startup — proj4
 * keeps a grid node as its own array of two numbers, and Hesse's million of
 * them cost 83 MB — so they are asked for by area, once, by the importer that
 * carries a survey alignment into DB_REF.
 *
 * A file of its own: loading a grid changes what every DHDN proj string in the
 * module registry says, and the base grid's own tests read those strings.
 */

const realFetch = globalThis.fetch

beforeAll(() => {
  globalThis.fetch = async (url) => {
    const name = String(url).split('/').pop()
    const file = new URL(`../../grids/${name}`, import.meta.url)
    if (!fs.existsSync(file)) return { ok: false, status: 404, statusText: 'not here' }
    const buf = fs.readFileSync(file)
    return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }
  }
})

afterAll(() => { globalThis.fetch = realFetch })

// Saarland's own grid, and a point in the middle of it.
const SAAR = 'SETA2016'
const SAARBRUECKEN = [6.99, 49.23]
const MUENCHEN = [11.57, 48.14]

describe('the regional grids on offer', () => {
  it('each state its own area, written west, south, east, north', () => {
    expect(REGIONAL_GRIDS.length).toBeGreaterThan(0)
    for (const grid of REGIONAL_GRIDS) {
      const [w, s, e, n] = grid.bbox
      expect(e, grid.key).toBeGreaterThan(w)
      expect(n, grid.key).toBeGreaterThan(s)
      // Inside Germany, which is what BeTA2007 covers.
      expect(w, grid.key).toBeGreaterThanOrEqual(5.5)
      expect(e, grid.key).toBeLessThanOrEqual(15.834)
    }
  })

  it('ships the file each of them names', () => {
    for (const grid of REGIONAL_GRIDS) {
      expect(fs.existsSync(new URL(`../../grids/${grid.file}`, import.meta.url)), grid.file).toBe(true)
    }
  })

  it('finds the one covering a place, and none covering the others', () => {
    const at = ([lng, lat]) => gridsCovering([lng, lat, lng, lat]).map(g => g.key)
    expect(at(SAARBRUECKEN)).toContain(SAAR)
    expect(at([8.68, 50.11])).toContain('HETA2010')       // Frankfurt
    // Bavaria publishes none any more — its own survey offers BeTA2007.
    expect(at(MUENCHEN)).toEqual([])
  })

  it('asks for nothing when there is no area to ask about', () => {
    expect(gridsCovering(null)).toEqual([])
  })
})

describe('loading one for an area', () => {
  beforeAll(async () => {
    await loadNtv2Grid()
  })

  it('starts with the nationwide grid alone', () => {
    expect(nadgridsList()).toBe(GRID_KEY)
    expect(loadedRegionalGrids()).toEqual([])
  })

  it('loads what the area touches and nothing else', async () => {
    const loaded = await loadGridsFor([6.9, 49.2, 7.1, 49.3])
    expect(loaded.map(g => g.key)).toEqual([SAAR])
    expect(loadedRegionalGrids().map(g => g.key)).toEqual([SAAR])
  })

  it('puts it in front of the nationwide grid, and optional', () => {
    // Optional, so a point outside it falls through to the one that covers
    // the whole country; the nationwide grid last and mandatory.
    expect(nadgridsList()).toBe(`@${SAAR},${GRID_KEY}`)
    expect(projStringFor(5676)).toContain(`+nadgrids=@${SAAR},${GRID_KEY}`)
  })

  it('carries a point both ways, inside its area and outside it', () => {
    // The list has to agree with itself in both directions, and it has to keep
    // working where no regional grid reaches: Saarbrücken is inside the one
    // that was just loaded, München is outside every one of them and falls
    // through to the grid that covers the country.
    for (const [name, point, crs] of [
      ['Saarbrücken', SAARBRUECKEN, 5676],
      ['München', MUENCHEN, 5678],
    ]) {
      const { easting, northing } = wgs84ToUTM(point, crs)
      const back = utmToWgs84(easting, northing, crs)
      expect(back[0], name).toBeCloseTo(point[0], 9)
      expect(back[1], name).toBeCloseTo(point[1], 9)
    }
  })

  it('asks twice for the same area without loading twice', async () => {
    const again = await loadGridsFor([6.9, 49.2, 7.1, 49.3])
    expect(again.map(g => g.key)).toEqual([SAAR])
    expect(nadgridsList()).toBe(`@${SAAR},${GRID_KEY}`)
  })
})
