"""The Länder's DGM1 as map tiles: terrain-RGB for the map's fine relief.

The map colours and shades the ground from raster-dem tiles — 256 × 256
pixels in Web Mercator, each pixel a height packed into its red, green and
blue. DGM5 (BKG) comes that way ready-made; the Länder's DGM1 does not, it
lies in the kilometre tiles `terrain` reads for single points. So this module
draws the map tile from those: the height of every pixel's centre, read
bilinearly from the DGM1 tile it falls in, exactly as `terrain.sample` reads a
point.

    z 16  ~ 1.5 m a pixel in Germany, a map tile ~ 385 m — the coarsest the
          1 m grid is worth drawing; below it DGM5 (5 m) shows as much
    z 17  ~ 0.75 m a pixel, the finest; the map scales it up beyond

Heights are packed to the centimetre (MapLibre's `custom` encoding):

    h = (R · 65536 + G · 256 + B) · 0.01 − 10000

the 0.1 m of the usual terrain-RGB would draw terraces into the hillshade of
flat ground at under a metre a pixel.

A tile no Land has any of is no tile (None — the service answers 404, the map
keeps showing DGM5 there). Pixels in a tile only partly covered — a Land's
border, a DGM1 tile the portal did not hand out — take DGM5's height, so the
relief runs on without a cliff; where even that is missing, the nearest
pixel's.
"""

import math
import threading
from collections import OrderedDict

import numpy as np

from . import terrain

SIZE = 256
MIN_ZOOM = 16
MAX_ZOOM = 17
BASE_SHIFT = 10000.0
STEP = 0.01
# DGM5's tiles in the usual terrain-RGB (0.1 m), up to zoom 15.
DGM5_URL = "https://sg.geodatenzentrum.de/gdz_basemapde_3d_gelaende/dgm5_rgb_tiles/{z}/{x}/{y}.png"
DGM5_MAX_ZOOM = 15
DGM5_MEMORY = 64
# DGM1 tiles one map tile may need, over all Länder: at zoom 16 four at most
# (a 1 km tile, a map tile not quite 400 m across, a border between two Länder).
MAX_SOURCE_TILES = 16


def pixel_lnglat(z, x, y):
    """WGS84 of the centre of each pixel of map tile z/x/y, as two (256, 256) arrays."""
    n = 2 ** z
    t = (np.arange(SIZE) + 0.5) / SIZE
    lng = (x + t) / n * 360.0 - 180.0
    lat = np.degrees(np.arctan(np.sinh(math.pi * (1 - 2 * (y + t) / n))))
    return np.meshgrid(lng, lat)


def dgm1_heights(lng, lat, store):
    """(heights, failed): the DGM1 height of every point (NaN where no Land has
    one) and whether a tile could not be had for now."""
    heights = np.full(lng.shape, np.nan)
    failed = False
    wanted = 0
    for source in terrain.SOURCES:
        w, s, e, n = source.lnglat_box
        todo = np.isnan(heights) & (lng >= w) & (lng <= e) & (lat >= s) & (lat <= n)
        if not todo.any():
            continue
        east, north = terrain.transformer(4326, source.crs).transform(lng[todo], lat[todo])
        east, north = np.asarray(east), np.asarray(north)
        oe, on = source.offset
        ek = ((oe + source.size * np.floor((east - oe) / source.size)) // 1000).astype(np.int64)
        nk = ((on + source.size * np.floor((north - on) / source.size)) // 1000).astype(np.int64)
        part = np.full(east.shape, np.nan)
        keys = np.unique(np.stack([ek, nk], axis=1), axis=0)
        wanted += len(keys)
        if wanted > MAX_SOURCE_TILES:
            raise ValueError("map tile too large for the DGM1")
        for tek, tnk in keys:
            tile, tile_failed = store.get_status(source, int(tek), int(tnk))
            failed |= tile_failed
            if tile is None:
                continue
            sel = (ek == tek) & (nk == tnk)
            part[sel] = tile.heights(east[sel], north[sel])
        heights[todo] = part
    return heights, failed


class Dgm5:
    """DGM5 tiles, decoded to heights, the last few kept."""

    def __init__(self, fetch=terrain._download):
        self.fetch = fetch
        self._memory = OrderedDict()
        self._lock = threading.Lock()

    def tile(self, z, x, y):
        """The heights of DGM5 tile z/x/y (NaN for no data), or None."""
        key = (z, x, y)
        with self._lock:
            if key in self._memory:
                self._memory.move_to_end(key)
                return self._memory[key]
        try:
            data = self.fetch(DGM5_URL.format(z=z, x=x, y=y))
            grid = decode_mapbox(data) if data else None
        except Exception:                                      # noqa: BLE001
            return None                      # not kept: the BKG may answer next time
        with self._lock:
            self._memory[key] = grid
            while len(self._memory) > DGM5_MEMORY:
                self._memory.popitem(last=False)
        return grid

    def heights(self, z, x, y):
        """DGM5 under map tile z/x/y at its pixel centres — beyond zoom 15 read
        bilinearly from the zoom-15 tile it lies in."""
        dz = max(0, z - DGM5_MAX_ZOOM)
        grid = self.tile(z - dz, x >> dz, y >> dz)
        if grid is None:
            return None
        k = 2 ** dz
        size = grid.shape[0]                  # 512 — finer than a 256 map tile
        t = (np.arange(SIZE) + 0.5) / SIZE
        cols = np.clip(((x - ((x >> dz) << dz)) + t) / k * size - 0.5, 0, size - 1)
        rows = np.clip(((y - ((y >> dz) << dz)) + t) / k * size - 0.5, 0, size - 1)
        c0 = np.floor(cols).astype(np.int64)
        r0 = np.floor(rows).astype(np.int64)
        c1, r1 = np.minimum(c0 + 1, size - 1), np.minimum(r0 + 1, size - 1)
        tc, tr = (cols - c0)[None, :], (rows - r0)[:, None]
        g = grid
        return (g[np.ix_(r0, c0)] * (1 - tc) * (1 - tr) + g[np.ix_(r0, c1)] * tc * (1 - tr)
                + g[np.ix_(r1, c0)] * (1 - tc) * tr + g[np.ix_(r1, c1)] * tc * tr)


def decode_mapbox(data):
    """A terrain-RGB image in the usual encoding as heights; DGM5 marks "no
    data" as exactly 0 m. Its tiles are named .png but are lossless WebP of
    512 × 512 pixels, so the format is taken from the bytes."""
    import imagecodecs                                          # noqa: PLC0415

    img = imagecodecs.imread(data).astype(np.int64)
    raw = img[..., 0] * 65536 + img[..., 1] * 256 + img[..., 2]
    heights = raw * 0.1 - 10000.0
    heights[raw == 100000] = np.nan
    return heights


def encode(heights):
    """Heights (no NaN left) as a terrain-RGB PNG in the centimetre encoding."""
    import imagecodecs                                          # noqa: PLC0415

    v = np.clip(np.rint((heights + BASE_SHIFT) / STEP), 0, 2 ** 24 - 1).astype(np.uint32)
    rgb = np.stack([(v >> 16) & 255, (v >> 8) & 255, v & 255], axis=-1).astype(np.uint8)
    return imagecodecs.png_encode(rgb)


def fill_nearest(heights):
    """Every NaN set to the nearest pixel that has a height."""
    from scipy.ndimage import distance_transform_edt            # noqa: PLC0415

    idx = distance_transform_edt(np.isnan(heights), return_distances=False, return_indices=True)
    return heights[tuple(idx)]


def covers(z, x, y):
    """Whether map tile z/x/y touches any Land's box at all."""
    n = 2 ** z
    west, east = x / n * 360.0 - 180.0, (x + 1) / n * 360.0 - 180.0
    north = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    south = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))
    return any(w <= east and west <= e and s <= north and south <= nb
               for w, s, e, nb in (src.lnglat_box for src in terrain.SOURCES))


_dgm5 = Dgm5()


def render(z, x, y, store=None, dgm5=None):
    """(png, keep) for map tile z/x/y: the PNG, or None where no Land has any
    of it, and whether the answer may be kept — not while a DGM1 tile it needs
    could not be had."""
    if not covers(z, x, y):
        return None, True
    store = store or terrain._store
    dgm5 = dgm5 or _dgm5
    lng, lat = pixel_lnglat(z, x, y)
    heights, failed = dgm1_heights(lng, lat, store)
    gaps = np.isnan(heights)
    if gaps.all():
        return None, not failed
    if gaps.any():
        under = dgm5.heights(z, x, y)
        if under is not None:
            heights[gaps] = under[gaps]
        if np.isnan(heights).any():
            heights = fill_nearest(heights)
    return encode(heights), not failed
