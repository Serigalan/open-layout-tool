"""Ground heights from the DGM1 of the Länder, sampled on the server.

The Länder publish their 1 m terrain models as tiles of one or two kilometres,
not as a service a page could ask for a height: zipped XYZ lists or GeoTIFFs of
several megabytes each, and without the CORS header that would let a browser
read them at all. So the page sends the points it wants a height for and this
module answers them — it fetches the tile a point lies in once, keeps it as an
array, and reads every later point from there.

Only the Länder whose tiles can be had as simply as Thüringen's are here: a
fixed URL per tile, no portal, no login, no index to look a file name up in.

    Thüringen            1 km XYZ in a ZIP     EPSG:25832, two vintages
    Sachsen              2 km GeoTIFF in a ZIP EPSG:25833
    Berlin               2 km XYZ in a ZIP     EPSG:25833
    Brandenburg          1 km GeoTIFF in a ZIP EPSG:25833
    Bayern               1 km GeoTIFF          EPSG:25832
    Baden-Württemberg    2 km ZIP of four 1 km XYZ, EPSG:25832
    Nordrhein-Westfalen  WCS, read as 1 km GeoTIFF cells, EPSG:25832

The others need more than that (Schleswig-Holstein names its files after the
flight year, so an index would have to be read first; Sachsen-Anhalt,
Niedersachsen and Hessen hand theirs out through portal applications only;
Mecklenburg-Vorpommern's fixed URL returns a coloured picture, not heights)
and are left to DGM5.

Heights are NHN — DHHN2016 mostly, DHHN92 in older Thüringen tiles. The
difference is a few centimetres, below what a terrain line in a cross section
shows, and the app treats all of them as the height system of its tracks.

A point outside every source, or in a tile no source has, answers None; the
page then asks the next source it knows (DGM5, then the worldwide tiles).
"""

import io
import math
import os
import threading
import time
import urllib.error
import urllib.request
import zipfile
from collections import OrderedDict

import numpy as np

MEMORY_TILES = int(os.environ.get("OLT_TERRAIN_MEMORY_TILES", "24"))
DISK_TILES = int(os.environ.get("OLT_TERRAIN_DISK_TILES", "400"))
CACHE_DIR = os.environ.get("OLT_TERRAIN_CACHE",
                           os.path.join(os.path.expanduser("~"), ".cache", "olt-terrain"))
FETCH_TIMEOUT = float(os.environ.get("OLT_TERRAIN_FETCH_TIMEOUT", "90"))
# A tile no source has is asked for again after this long, not on every point.
MISSING_TTL = 24 * 3600
# Heights below this are the files' "no data", not ground.
NO_DATA_BELOW = -1000.0


class Source:
    """One Land's DGM1: where its tiles lie, how they are named and read.

    `size` is the tile edge in metres and `offset` where the tile grid starts
    (Baden-Württemberg's 2 km tiles begin on odd kilometres east); `vintages`
    are (label, url(e_km, n_km)) with the kilometre of the tile's lower-left
    corner, newest first. `lnglat_box` is a coarse box around the Land, so a
    point far away is not even transformed.
    """

    def __init__(self, source_id, name, crs, lnglat_box, size, fmt, vintages, offset=(0, 0)):
        self.id = source_id
        self.name = name
        self.crs = crs
        self.lnglat_box = lnglat_box
        self.size = size
        self.fmt = fmt                # 'xyz-zip', 'tif-zip' or 'tif'
        self.vintages = vintages
        self.offset = offset

    def covers(self, lng, lat):
        w, s, e, n = self.lnglat_box
        return w <= lng <= e and s <= lat <= n

    def tile_of(self, e, n):
        """Lower-left corner of the tile holding (e, n), in whole kilometres."""
        oe, on = self.offset
        return (int((oe + self.size * math.floor((e - oe) / self.size)) // 1000),
                int((on + self.size * math.floor((n - on) / self.size)) // 1000))


_TH = "https://geoportal.geoportal-th.de/hoehendaten/DGM"
_SN = "https://geocloud.landesvermessung.sachsen.de/public.php/dav/files/JCcXyifaNdLDnxZ"
_NW = "https://www.wcs.nrw.de/geobasis/wcs_nw_dgm"


def _nw_cell(ek, nk):
    return (f"{_NW}?SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage&COVERAGEID=nw_dgm"
            f"&FORMAT=image/tiff&SUBSET=x({ek * 1000},{ek * 1000 + 1000})"
            f"&SUBSET=y({nk * 1000},{nk * 1000 + 1000})")


# Order matters only where boxes overlap: a Land's tiles end at its border (the
# cells beyond hold "no data"), so the next source answers there. Berlin comes
# before Brandenburg, which surrounds it.
SOURCES = [
    Source("dgm1-th", "Thüringen", 25832, (9.85, 50.17, 12.68, 51.68), 1000, "xyz-zip", [
        ("2020-2025", lambda ek, nk: f"{_TH}/dgm_2020-2025/dgm1_32_{ek}_{nk}_1_th_2020-2025.zip"),
        ("2014-2019", lambda ek, nk: f"{_TH}/dgm_2014-2019/dgm1_{ek}_{nk}_1_th_2014-2019.zip"),
    ]),
    Source("dgm1-sn", "Sachsen", 25833, (11.85, 50.15, 15.05, 51.70), 2000, "tif-zip", [
        (None, lambda ek, nk: f"{_SN}/dgm1_33{ek}_{nk}_2_sn_tiff.zip"),
    ]),
    Source("dgm1-be", "Berlin", 25833, (13.07, 52.33, 13.78, 52.68), 2000, "xyz-zip", [
        (None, lambda ek, nk: f"https://gdi.berlin.de/data/dgm1/atom/DGM1_{ek}_{nk}.zip"),
    ]),
    Source("dgm1-bb", "Brandenburg", 25833, (11.25, 51.35, 14.78, 53.57), 1000, "tif-zip", [
        (None, lambda ek, nk: f"https://data.geobasis-bb.de/geobasis/daten/dgm/tif/dgm_33{ek}-{nk}.zip"),
    ]),
    Source("dgm1-by", "Bayern", 25832, (8.95, 47.26, 13.85, 50.57), 1000, "tif", [
        (None, lambda ek, nk: f"https://download1.bayernwolke.de/a/dgm/dgm1/{ek}_{nk}.tif"),
    ]),
    Source("dgm1-bw", "Baden-Württemberg", 25832, (7.50, 47.53, 10.50, 49.80), 2000, "xyz-zip", [
        (None, lambda ek, nk: f"https://opengeodata.lgl-bw.de/data/dgm/dgm1_32_{ek}_{nk}_2_bw.zip"),
    ], offset=(1000, 0)),
    Source("dgm1-nw", "Nordrhein-Westfalen", 25832, (5.85, 50.32, 9.47, 52.54), 1000, "tif", [
        (None, _nw_cell),
    ]),
]
SOURCES_BY_ID = {s.id: s for s in SOURCES}


class Tile:
    """A 1 m grid: row 0 the northernmost, `x0`/`y0` the centre of its first cell."""

    def __init__(self, grid, x0, y0, label):
        self.grid = grid
        self.x0 = x0
        self.y0 = y0
        self.label = label

    def height(self, e, n):
        """Bilinear between the four nearest cells, clamped at the tile edge."""
        rows, cols = self.grid.shape
        c = min(max(e - self.x0, 0.0), cols - 1.0)
        r = min(max(self.y0 - n, 0.0), rows - 1.0)
        c0, r0 = int(math.floor(c)), int(math.floor(r))
        c1, r1 = min(c0 + 1, cols - 1), min(r0 + 1, rows - 1)
        tc, tr = c - c0, r - r0
        g = self.grid
        weighted = ((g[r0, c0], (1 - tc) * (1 - tr)), (g[r0, c1], tc * (1 - tr)),
                    (g[r1, c0], (1 - tc) * tr), (g[r1, c1], tc * tr))
        # A cell without data only spoils the height where it has a say in it.
        if any(w > 0 and not math.isfinite(v) for v, w in weighted):
            return None
        return float(sum(v * w for v, w in weighted if w > 0))


def parse_xyz(raw, label):
    """An XYZ list as a Tile.

    The grid is placed by the coordinates in the file, not by the order of its
    lines or a fixed half-metre offset: the sources differ in both (Thüringen's
    2014–2019 puts its cells on whole metres, the rest on half metres; Berlin
    lists from the south, Thüringen from the north). Several lists — the four
    kilometres of a Baden-Württemberg tile — are one grid once joined.
    """
    values = np.fromstring(raw, dtype=np.float64, sep=" ")
    if values.size < 3 or values.size % 3:
        raise ValueError("not an XYZ list")
    xyz = values.reshape(-1, 3)
    x0 = float(xyz[:, 0].min())
    y0 = float(xyz[:, 1].max())
    cols = np.rint(xyz[:, 0] - x0).astype(np.int64)
    rows = np.rint(y0 - xyz[:, 1]).astype(np.int64)
    grid = np.full((int(rows.max()) + 1, int(cols.max()) + 1), np.nan, dtype=np.float32)
    z = xyz[:, 2]
    grid[rows, cols] = np.where(z < NO_DATA_BELOW, np.nan, z)
    return Tile(grid, x0, y0, label)


def parse_tif(data, label):
    """A single-band GeoTIFF as a Tile, placed by its tie point and pixel size.

    A tie point names the corner of the first pixel (PixelIsArea, the GeoTIFF
    default) or its centre (PixelIsPoint); the grid is kept by cell centres.
    """
    import tifffile                                             # noqa: PLC0415

    with tifffile.TiffFile(io.BytesIO(data)) as tf:
        page = tf.pages[0]
        grid = page.asarray()
        tags = {t.name: t.value for t in page.tags.values()}
    if grid.ndim != 2:
        raise ValueError("not a single band of heights")
    tie = tags.get("ModelTiepointTag")
    scale = tags.get("ModelPixelScaleTag")
    if not tie or not scale:
        raise ValueError("not georeferenced")
    sx, sy = float(scale[0]), float(scale[1])
    if abs(sx - 1) > 1e-6 or abs(sy - 1) > 1e-6:
        raise ValueError("not a 1 m grid")
    keys = tags.get("GeoKeyDirectoryTag") or ()
    is_point = any(keys[i] == 1025 and keys[i + 3] == 2 for i in range(4, len(keys) - 3, 4))
    half = 0.0 if is_point else 0.5
    x0 = float(tie[3]) - float(tie[0]) * sx + half * sx
    y0 = float(tie[4]) + float(tie[1]) * sy - half * sy
    grid = grid.astype(np.float32)
    nodata = tags.get("GDAL_NODATA")
    if nodata is not None:
        try:
            grid[grid == np.float32(float(str(nodata).strip("\x00 ")))] = np.nan
        except ValueError:
            pass
    grid[grid < NO_DATA_BELOW] = np.nan
    return Tile(grid, x0, y0, label)


def read_tile(data, fmt, label):
    """The bytes of one download as a Tile, by the source's format."""
    if fmt == "tif":
        return parse_tif(data, label)
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        names = zf.namelist()
        if fmt == "tif-zip":
            name = next((n for n in names if n.lower().endswith((".tif", ".tiff"))), None)
            if name is None:
                raise ValueError("no GeoTIFF in the archive")
            return parse_tif(zf.read(name), label)
        lists = [n for n in names if n.lower().endswith(".xyz")]
        if not lists:
            raise ValueError("no XYZ in the archive")
        return parse_xyz(b"\n".join(zf.read(n) for n in lists), label)


def _download(url):
    """The bytes at `url`, or None where there is no such file."""
    req = urllib.request.Request(url, headers={"User-Agent": "olt-optimizer terrain"})
    try:
        with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as res:
            return res.read()
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        raise


class TileStore:
    """Tiles by key: in memory (the last few used), on disk, or fetched."""

    def __init__(self, cache_dir=CACHE_DIR, fetch=_download):
        self.cache_dir = cache_dir
        self.fetch = fetch
        self._memory = OrderedDict()
        self._missing = {}
        self._lock = threading.Lock()
        self._loading = {}

    def _disk_path(self, key):
        return os.path.join(self.cache_dir, key.replace("/", "_") + ".npz")

    def _from_disk(self, key):
        path = self._disk_path(key)
        try:
            with np.load(path) as f:
                tile = Tile(f["grid"], float(f["x0"]), float(f["y0"]), str(f["label"]))
            os.utime(path)
            return tile
        except (OSError, KeyError, ValueError):
            return None

    def _to_disk(self, key, tile):
        try:
            os.makedirs(self.cache_dir, exist_ok=True)
            tmp = self._disk_path(key) + ".tmp.npz"
            np.savez(tmp, grid=tile.grid, x0=tile.x0, y0=tile.y0, label=tile.label)
            os.replace(tmp, self._disk_path(key))
            files = sorted(
                (os.path.join(self.cache_dir, n) for n in os.listdir(self.cache_dir)
                 if n.endswith(".npz") and not n.endswith(".tmp.npz")),
                key=os.path.getmtime)
            for old in files[:max(0, len(files) - DISK_TILES)]:
                os.unlink(old)
        except OSError:
            pass

    def _load(self, source, ek, nk):
        key = f"{source.id}/{ek}_{nk}"
        tile = self._from_disk(key)
        if tile is not None:
            return tile
        for label, url in source.vintages:
            data = self.fetch(url(ek, nk))
            if data is None:
                continue
            tile = read_tile(data, source.fmt, f"{source.id} {label}" if label else source.id)
            self._to_disk(key, tile)
            return tile
        return None

    def get(self, source, ek, nk):
        """The tile with its lower-left corner at kilometre (ek, nk), or None
        where the source has none there.

        Two requests wanting the same tile share one download: the second waits
        on the first instead of fetching the same megabytes again.
        """
        key = f"{source.id}/{ek}_{nk}"
        with self._lock:
            if key in self._memory:
                self._memory.move_to_end(key)
                return self._memory[key]
            missing_at = self._missing.get(key)
            if missing_at is not None and time.monotonic() - missing_at < MISSING_TTL:
                return None
            event = self._loading.get(key)
            owner = event is None
            if owner:
                event = self._loading[key] = threading.Event()
        if not owner:
            event.wait(FETCH_TIMEOUT * 2)
            with self._lock:
                return self._memory.get(key)
        try:
            tile = self._load(source, ek, nk)
        except Exception:                                      # noqa: BLE001
            tile = None                     # not cached as missing: the portal may be back
            failed = True
        else:
            failed = False
        with self._lock:
            if tile is not None:
                self._memory[key] = tile
                while len(self._memory) > MEMORY_TILES:
                    self._memory.popitem(last=False)
            elif not failed:
                self._missing[key] = time.monotonic()
            self._loading.pop(key, None)
            event.set()
        return tile


_store = TileStore()
_transformers = {}


def _to_plane(crs, lng, lat):
    from pyproj import Transformer                              # noqa: PLC0415

    tr = _transformers.get(crs)
    if tr is None:
        tr = _transformers[crs] = Transformer.from_crs(4326, crs, always_xy=True)
    return tr.transform(lng, lat)


def to_lnglat(e, n, crs=25832):
    """A plane point back to WGS84 — for requests that still send EPSG:25832."""
    from pyproj import Transformer                              # noqa: PLC0415

    key = ("inv", crs)
    tr = _transformers.get(key)
    if tr is None:
        tr = _transformers[key] = Transformer.from_crs(crs, 4326, always_xy=True)
    return tr.transform(e, n)


def sample(lnglats, store=None):
    """Heights for WGS84 points [[lng, lat], ...].

    Returns (heights, sources): per point the height in metres rounded to the
    centimetre and the dataset it came from ('dgm1-th 2020-2025', 'dgm1-by',
    …), or None for both where no Land's DGM1 has the point.
    """
    store = store or _store
    heights, sources = [], []
    for p in lnglats:
        z = label = None
        try:
            lng, lat = float(p[0]), float(p[1])
        except (TypeError, ValueError, IndexError):
            lng = lat = math.nan
        if math.isfinite(lng) and math.isfinite(lat):
            for source in SOURCES:
                if not source.covers(lng, lat):
                    continue
                e, n = _to_plane(source.crs, lng, lat)
                tile = store.get(source, *source.tile_of(e, n))
                h = tile.height(e, n) if tile is not None else None
                if h is not None:
                    z, label = round(h, 2), tile.label
                    break
        heights.append(z)
        sources.append(label)
    return heights, sources
