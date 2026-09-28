"""Ground heights from the DGM1 of the Länder, sampled on the server.

The Länder publish their 1 m terrain models as 1 × 1 km files, not as a
service a page could ask for a height: a zipped XYZ list of about 5 MB per
square kilometre, and without the CORS header that would let a browser read
it at all. So the page sends the points it wants a height for and this module
answers them — it fetches the tile a point lies in once, keeps it as an array,
and reads every later point from there.

Only Thüringen for now. Its tiles are EPSG:25832 throughout, named after the
kilometre of their lower-left corner, in several vintages; the newest one that
has the tile wins. Heights are DHHN2016 (2020–2025) or DHHN92 (2014–2019) —
the difference is a few centimetres, below what a terrain line in a cross
section shows, and the app treats both as the height system of its tracks.

A point outside every source, or in a tile no vintage has, answers None; the
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

TILE = 1000                       # m, edge of one tile
MEMORY_TILES = int(os.environ.get("OLT_TERRAIN_MEMORY_TILES", "24"))
DISK_TILES = int(os.environ.get("OLT_TERRAIN_DISK_TILES", "400"))
CACHE_DIR = os.environ.get("OLT_TERRAIN_CACHE",
                           os.path.join(os.path.expanduser("~"), ".cache", "olt-terrain"))
FETCH_TIMEOUT = float(os.environ.get("OLT_TERRAIN_FETCH_TIMEOUT", "60"))
# A tile no vintage has is asked for again after this long, not on every point.
MISSING_TTL = 24 * 3600
# Heights below this are the files' "no data", not ground.
NO_DATA_BELOW = -1000.0


class Source:
    """One Land's DGM1: where its tiles lie and how each vintage names them."""

    def __init__(self, source_id, bbox, vintages):
        self.id = source_id
        self.bbox = bbox              # (e_min, n_min, e_max, n_max), EPSG:25832, m
        self.vintages = vintages      # [(label, url(ek, nk))], newest first

    def covers(self, e, n):
        e0, n0, e1, n1 = self.bbox
        return e0 <= e < e1 and n0 <= n < n1


_TH_BASE = "https://geoportal.geoportal-th.de/hoehendaten/DGM"
SOURCES = [
    Source(
        "dgm1-th",
        # The kilometre tiles of the Atom feed run 561–757 east, 5562–5723 north.
        (561_000, 5_562_000, 758_000, 5_724_000),
        [
            ("2020-2025", lambda ek, nk:
                f"{_TH_BASE}/dgm_2020-2025/dgm1_32_{ek}_{nk}_1_th_2020-2025.zip"),
            ("2014-2019", lambda ek, nk:
                f"{_TH_BASE}/dgm_2014-2019/dgm1_{ek}_{nk}_1_th_2014-2019.zip"),
        ],
    ),
]


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
    """The XYZ list of one tile as a Tile.

    The grid is placed by the coordinates in the file, not by the order of its
    lines or a fixed half-metre offset: the vintages differ in both (2014–2019
    puts its cells on whole metres, 2020–2025 on half metres).
    """
    values = np.array(raw.split(), dtype=np.float64)
    if values.size < 3 or values.size % 3:
        raise ValueError("not an XYZ list")
    xyz = values.reshape(-1, 3)
    x0 = float(xyz[:, 0].min())
    y0 = float(xyz[:, 1].max())
    cols = np.rint(xyz[:, 0] - x0).astype(np.int64)
    rows = np.rint(y0 - xyz[:, 1]).astype(np.int64)
    grid = np.full((int(rows.max()) + 1, int(cols.max()) + 1), np.nan, dtype=np.float32)
    z = xyz[:, 2]
    z = np.where(z < NO_DATA_BELOW, np.nan, z)
    grid[rows, cols] = z
    return Tile(grid, x0, y0, label)


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


def _read_zip(data, label):
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        name = next((n for n in zf.namelist() if n.lower().endswith(".xyz")), None)
        if name is None:
            raise ValueError("no XYZ in the archive")
        return parse_xyz(zf.read(name), label)


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
            tile = _read_zip(data, f"{source.id} {label}")
            self._to_disk(key, tile)
            return tile
        return None

    def get(self, source, ek, nk):
        """The tile at kilometre (ek, nk), or None where no vintage has it.

        Two requests wanting the same tile share one download: the second waits
        on the first instead of fetching the same 5 MB again.
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


def sample(points, store=None):
    """Heights for points [[easting, northing], ...] in EPSG:25832.

    Returns (heights, sources): per point the height in metres rounded to the
    centimetre and the dataset it came from, or None for both where no DGM1
    has the point.
    """
    store = store or _store
    heights, sources = [], []
    for p in points:
        z = label = None
        try:
            e, n = float(p[0]), float(p[1])
        except (TypeError, ValueError, IndexError):
            e = n = math.nan
        if math.isfinite(e) and math.isfinite(n):
            for source in SOURCES:
                if not source.covers(e, n):
                    continue
                tile = store.get(source, int(e // TILE), int(n // TILE))
                h = tile.height(e, n) if tile is not None else None
                if h is not None:
                    z, label = round(h, 2), tile.label
                    break
        heights.append(z)
        sources.append(label)
    return heights, sources
