const TERRAIN_URL =
  'https://api.maptiler.com/tiles/terrain-rgb/tiles.json?key=QojDLOuI2wG4mNbHjzA7'

const DGM5_URL = 'https://sgx.geodatenzentrum.de/gdz_basemapde_3d_gelaende/dgm5_3857_rgb.json'

/**
 * Elevation colours: green for the lowest point in view, through yellow, to red
 * for the highest — ColorBrewer's RdYlGn, reversed. The scale is not tied to
 * fixed heights but stretched over the elevations actually on screen and
 * re-fitted whenever the view changes, so the full range of colours is always
 * in play: a few metres of relief along a flat line read as clearly as a
 * thousand in the Alps.
 */
export const RELIEF_RAMP = [
  [0.000, [ 26, 152,  80]],   // #1a9850  lowest in view
  [0.125, [102, 189,  99]],   // #66bd63
  [0.250, [166, 217, 106]],   // #a6d96a
  [0.375, [217, 239, 139]],   // #d9ef8b
  [0.500, [255, 255, 191]],   // #ffffbf
  [0.625, [254, 224, 139]],   // #fee08b
  [0.750, [253, 174,  97]],   // #fdae61
  [0.875, [244, 109,  67]],   // #f46d43
  [1.000, [215,  48,  39]],   // #d73027  highest in view
]

const MIN_SPAN     = 5     // m — a flatter view would only colour the DEM's noise
const SAMPLE_STEPS = 16    // 17 × 17 probes across the viewport
const REFIT_DELAY  = 250   // ms of quiet before the scale is re-fitted
const REFIT_TOL    = 0.03  // re-fit once an end has drifted 3 % of the span

/** MapLibre color-relief expression spreading the ramp over [minElev, maxElev]. */
function buildColorExpression(minElev, maxElev) {
  const span = Math.max(maxElev - minElev, MIN_SPAN)
  const expr = ['interpolate', ['linear'], ['elevation']]
  RELIEF_RAMP.forEach(([t, [r, g, b]]) => expr.push(minElev + t * span, `rgb(${r},${g},${b})`))
  return expr
}

let _refitTimer   = null
let _lastRange    = null
let _rangeListener = null

/** Register a listener called with [min, max] in metres on every re-fit — the
 *  legend follows the scale that way without polling the map. */
export function onElevationRange(listener) {
  _rangeListener = listener
}

/**
 * Re-fit the colour scale to the elevations in view — debounced, and only when
 * the range has really moved (see refitElevationRange). `force` re-applies it
 * right away: after a style change the layer starts on its default range.
 */
export function updateElevationRange(map, { force = false } = {}) {
  if (force) {
    if (_refitTimer) { clearTimeout(_refitTimer); _refitTimer = null }
    _lastRange = null
    refitElevationRange(map)
    return
  }
  if (_refitTimer) return
  _refitTimer = setTimeout(() => {
    _refitTimer = null
    refitElevationRange(map)
  }, REFIT_DELAY)
}

function refitElevationRange(map) {
  if (!map?.getLayer?.('color-relief')) return
  const terrain = map.getTerrain()
  if (!terrain) return
  // queryTerrainElevation returns the DEM value multiplied by the terrain
  // exaggeration, while the color-relief layer reads the raw one — without
  // dividing it out the scale would sit 50 % too high.
  const exaggeration = terrain.exaggeration || 1

  const bounds = map.getBounds()
  const west = bounds.getWest(), east = bounds.getEast()
  const south = bounds.getSouth(), north = bounds.getNorth()

  let min = Infinity, max = -Infinity, samples = 0
  for (let i = 0; i <= SAMPLE_STEPS; i++) {
    const lng = west + (east - west) * i / SAMPLE_STEPS
    for (let j = 0; j <= SAMPLE_STEPS; j++) {
      const lat = south + (north - south) * j / SAMPLE_STEPS
      const raw = map.queryTerrainElevation([lng, lat])
      // Exactly 0 is what MapLibre hands back where it has no DEM: outside the
      // coverage (DGM5 ends at the border) or while tiles are still loading.
      // Real ground never reads 0.000, so those probes are dropped — otherwise
      // they drag the low end of the scale down to sea level.
      if (raw == null || raw === 0 || !Number.isFinite(raw)) continue
      const elevation = raw / exaggeration
      if (elevation < min) min = elevation
      if (elevation > max) max = elevation
      samples++
    }
  }
  if (samples < 10) return

  let lo = min, hi = max
  if (hi - lo < MIN_SPAN) {          // dead flat: widen around the middle
    const mid = (lo + hi) / 2
    lo = mid - MIN_SPAN / 2
    hi = mid + MIN_SPAN / 2
  }

  // The scale spans exactly what is on screen, end to end. It is only left as it
  // is while panning barely changes that — without this hysteresis the whole map
  // would re-tint on every small movement.
  if (_lastRange) {
    const tolerance = REFIT_TOL * Math.max(_lastRange[1] - _lastRange[0], MIN_SPAN)
    if (Math.abs(lo - _lastRange[0]) < tolerance && Math.abs(hi - _lastRange[1]) < tolerance) return
  }
  _lastRange = [lo, hi]
  map.setPaintProperty('color-relief', 'color-relief-color', buildColorExpression(lo, hi))
  _rangeListener?.([lo, hi])
}

function buildWmsStyle(sourceId, wmsUrl, layer, attribution, wmsVersion = '1.1.1') {
  const base = (wmsUrl.endsWith('?') || wmsUrl.endsWith('&')) ? wmsUrl : wmsUrl + '?'
  const srsParam = wmsVersion === '1.3.0' ? 'CRS' : 'SRS'
  return {
    version: 8,
    sources: {
      [sourceId]: {
        type: 'raster',
        tiles: [
          base +
          `SERVICE=WMS&VERSION=${wmsVersion}&REQUEST=GetMap` +
          // A layer name may carry a comma (Bremen serves the city and
          // Bremerhaven as two sheets) or a space, so it is encoded.
          `&LAYERS=${encodeURIComponent(layer)}&STYLES=` +
          '&FORMAT=image/jpeg' +
          `&${srsParam}=EPSG:3857` +
          '&WIDTH=256&HEIGHT=256' +
          '&BBOX={bbox-epsg-3857}',
        ],
        tileSize: 256,
        // The state surveys publish under dl-de/by-2-0, which requires the
        // source to be named wherever the imagery is shown.
        attribution,
      },
    },
    layers: [{ id: 'wms-layer', type: 'raster', source: sourceId }],
  }
}

/**
 * Digital orthophotos (DOP, 20 cm) from the sixteen state survey authorities.
 * Each state runs its own WMS — there is no national one — so the list is the
 * only place their endpoints are recorded. All of them serve EPSG:3857 with
 * CORS enabled, which is what MapLibre needs to draw them as raster tiles.
 */
export const LANDESVERMESSUNG_STATES = [
  { id: 'lv-bw', name: 'Baden-Württemberg',      wmsUrl: 'https://owsproxy.lgl-bw.de/owsproxy/ows/WMS_LGL-BW_ATKIS_DOP_20_C?', layer: 'IMAGES_DOP_20_RGB', attribution: '© LGL Baden-Württemberg (dl-de/by-2-0)' },
  { id: 'lv-by', name: 'Bayern',                  wmsUrl: 'https://geoservices.bayern.de/od/wms/dop/v1/dop20', layer: 'by_dop20c', attribution: '© Bayerische Vermessungsverwaltung (dl-de/by-2-0)' },
  { id: 'lv-be', name: 'Berlin',                  wmsUrl: 'https://gdi.berlin.de/services/wms/truedop_2024', layer: 'truedop_2024', attribution: '© Geoportal Berlin / TrueDOP 2024 (dl-de/by-2-0)' },
  { id: 'lv-bb', name: 'Brandenburg',             wmsUrl: 'https://isk.geobasis-bb.de/mapproxy/dop20c/service/wms?', layer: 'bebb_dop20c', attribution: '© GeoBasis-DE/LGB (dl-de/by-2-0)' },
  // Bremen serves the city and Bremerhaven as two separate sheets; both are
  // requested at once so the exclave is not missing from the map.
  { id: 'lv-hb', name: 'Bremen',                  wmsUrl: 'https://geodienste.bremen.de/wms_dop10_2023?', layer: 'DOP10_2023_HB,DOP10_2023_BHV', attribution: '© Landesamt GeoInformation Bremen (dl-de/by-2-0)' },
  // Time series; the service's own default is the most recent year.
  { id: 'lv-hh', name: 'Hamburg',                 wmsUrl: 'https://geodienste.hamburg.de/wms_dop_zeitreihe_belaubt?', layer: 'dop_zeitreihe_belaubt', attribution: '© Freie und Hansestadt Hamburg, LGV (dl-de/by-2-0)' },
  { id: 'lv-he', name: 'Hessen',                  wmsUrl: 'https://www.gds-srv.hessen.de/cgi-bin/lika-services/ogc-free-images.ows?', layer: 'he_dop20_rgb', attribution: '© HVBG Hessen (dl-de/by-2-0)' },
  { id: 'lv-mv', name: 'Mecklenburg-Vorpommern',  wmsUrl: 'https://www.geodaten-mv.de/dienste/adv_dop?', layer: 'mv_dop', attribution: '© GeoBasis-DE/M-V (dl-de/by-2-0)' },
  { id: 'lv-ni', name: 'Niedersachsen',           wmsUrl: 'https://opendata.lgln.niedersachsen.de/doorman/noauth/dop_wms?', layer: 'ni_dop20', attribution: '© LGLN Niedersachsen (dl-de/by-2-0)' },
  { id: 'lv-nw', name: 'Nordrhein-Westfalen',     wmsUrl: 'https://www.wms.nrw.de/geobasis/wms_nw_dop?', layer: 'nw_dop_rgb', attribution: '© GeoBasis-DE/NRW (dl-de/by-2-0)' },
  { id: 'lv-rp', name: 'Rheinland-Pfalz',         wmsUrl: 'https://geo4.service24.rlp.de/wms/rp_dop20.fcgi?', layer: 'rp_dop20', attribution: '© GeoBasis-DE/LVermGeoRP (dl-de/by-2-0)' },
  { id: 'lv-sl', name: 'Saarland',                wmsUrl: 'https://geoportal.saarland.de/freewms/dop2021?', layer: 'sl_dop2021', attribution: '© LVGL Saarland (dl-de/by-2-0)' },
  { id: 'lv-sn', name: 'Sachsen',                 wmsUrl: 'https://geodienste.sachsen.de/wms_geosn_dop-rgb/guest?', layer: 'sn_dop_020', attribution: '© GeoSN (dl-de/by-2-0)' },
  { id: 'lv-st', name: 'Sachsen-Anhalt',          wmsUrl: 'https://www.geodatenportal.sachsen-anhalt.de/wss/service/ST_LVermGeo_DOP_WMS_OpenData/guest?', layer: 'lsa_lvermgeo_dop20_2', attribution: '© LVermGeo Sachsen-Anhalt (dl-de/by-2-0)' },
  { id: 'lv-sh', name: 'Schleswig-Holstein',      wmsUrl: 'https://dienste.gdi-sh.de/WMS_SH_DOP20col_OpenGBD?', layer: 'sh_dop20_rgb', attribution: '© LVermGeo Schleswig-Holstein (dl-de/by-2-0)' },
  { id: 'lv-th', name: 'Thüringen',               wmsUrl: 'https://www.geoproxy.geoportal-th.de/geoproxy/services/DOP20', layer: 'th_dop', attribution: '© GDI-Th, TLBG (dl-de/by-2-0)' },
]

const IGN_ORTHO_STYLE = {
  version: 8,
  sources: {
    'bd-ortho-ign': {
      type: 'raster',
      tiles: [
        'https://data.geopf.fr/wmts?' +
        'SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
        '&LAYER=HR.ORTHOIMAGERY.ORTHOPHOTOS' +
        '&STYLE=normal' +
        '&FORMAT=image/jpeg' +
        '&TILEMATRIXSET=PM' +
        '&TILEMATRIX={z}' +
        '&TILEROW={y}' +
        '&TILECOL={x}',
      ],
      tileSize: 256,
      attribution: '© IGN - BD ORTHO®',
    },
  },
  layers: [{ id: 'bd-ortho-layer', type: 'raster', source: 'bd-ortho-ign' }],
}

const DGM5_STYLE = {
  version: 8,
  sources: {
    dgm5Source: {
      type: 'raster-dem',
      url: DGM5_URL,
      tileSize: 256,
    },
  },
  terrain: { source: 'dgm5Source', exaggeration: 1.5 },
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#70b2e0' },
    },
    {
      id: 'color-relief',
      type: 'color-relief',
      source: 'dgm5Source',
      paint: { 'color-relief-color': buildColorExpression(0, 100) },
    },
    {
      id: 'hillshade',
      type: 'hillshade',
      source: 'dgm5Source',
      // Igor's method: soft, aspect-based shading that shows the shape of the
      // ground without laying black over the colour scale.
      paint: { 'hillshade-method': 'igor', 'hillshade-exaggeration': 0.4 },
    },
  ],
}

const ELEVATION_STYLE = {
  version: 8,
  sources: {
    terrainSource: {
      type: 'raster-dem',
      url: TERRAIN_URL,
      tileSize: 256,
    },
  },
  terrain: { source: 'terrainSource', exaggeration: 1.5 },
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#70b2e0' },
    },
    {
      id: 'color-relief',
      type: 'color-relief',
      source: 'terrainSource',
      paint: { 'color-relief-color': buildColorExpression(0, 100) },
    },
    {
      id: 'hillshade',
      type: 'hillshade',
      source: 'terrainSource',
      // Igor's method: soft, aspect-based shading that shows the shape of the
      // ground without laying black over the colour scale.
      paint: { 'hillshade-method': 'igor', 'hillshade-exaggeration': 0.4 },
    },
  ],
}

export const BASEMAPS = [
  {
    id: 'liberty',
    labelKey: 'basemap_liberty',
    group: 'worldwide',
    style: 'https://tiles.openfreemap.org/styles/liberty',
  },
  {
    id: 'elevation',
    labelKey: 'basemap_elevation',
    group: 'worldwide',
    get style() { return JSON.parse(JSON.stringify(ELEVATION_STYLE)) },
  },
  {
    id: 'positron',
    labelKey: 'basemap_positron',
    group: 'worldwide',
    style: 'https://tiles.openfreemap.org/styles/positron',
  },
  {
    id: 'satellite',
    labelKey: 'basemap_satellite',
    group: 'worldwide',
    style: 'https://api.maptiler.com/maps/satellite/style.json?key=QojDLOuI2wG4mNbHjzA7',
  },
  {
    id: 'ign-ortho',
    labelKey: 'basemap_ign_ortho',
    group: 'france',
    get style() { return JSON.parse(JSON.stringify(IGN_ORTHO_STYLE)) },
  },
  {
    id: 'basemapde',
    labelKey: 'basemap_basemapde',
    group: 'germany',
    style: 'https://basemap.de/data/produkte/web_vektor/styles/bm_web_bin.json',
  },
  {
    id: 'dgm5',
    labelKey: 'basemap_dgm5',
    group: 'germany',
    get style() { return JSON.parse(JSON.stringify(DGM5_STYLE)) },
  },
  // Rendered by LayersPanel from LANDESVERMESSUNG_STATES, not from the group
  // grid, so these carry the state's own name instead of a translation key.
  ...LANDESVERMESSUNG_STATES
    .filter((s) => s.wmsUrl)
    .map((s) => {
      const entry = { id: s.id, name: s.name, group: 'landesvermessung' }
      Object.defineProperty(entry, 'style', {
        get: () => buildWmsStyle(s.id, s.wmsUrl, s.layer, s.attribution, s.version),
        enumerable: true,
      })
      return entry
    }),
]
