# km — kilometrage lines

`src/core/utils/km/` · needs `geometry`

The DB lines (Strecken) with their kilometrage, as reference data: which line a track lies on, the line
number and name it takes, the track name built from the kilometrage of its middle, and the kilometrage of
any point. The map overlay that draws the lines is `src/core/map/kmLineLayer.js`.

## Files

| File | What it does |
|---|---|
| `kmLineSource.js` | Fetches the line files a project's tracks name and keeps the stretch around the project in `project.kmLines` |
| `kmLineUtils.js` | The kilometrage of a track point against a line, measured in the track's plane |
| `kmLineMath.js` | Where along a 100 m piece of the overlay a point lies — the arithmetic of the map readout, free of MapLibre |
| `kmTileSource.js` | The PMTiles byte source of the overlay, retrying a refused range past the browser cache |
| `lineLookup.js` | Which line is nearest to a track as a whole, its name, and the track name from the kilometrage of the middle |

## Data

Shipped with the app (checked into `tiles/`, symlinked into `public/data/`; built outside this repository):

- `tiles/km_linie.pmtiles` — the overlay: whole chains when zoomed out, the alignment in 100 m pieces from
  zoom 12, a point per hectometre and per kilometrage jump from zoom 13. Each feature says whether it belongs
  to today's DB InfraGO network (`in_db`); the overlay shows that network and, as a muted dashed second layer,
  what the survey data holds beyond it.
- `tiles/km/<line>.json` — one file per line: its stationed runs in WGS84 `[[lon, lat, km], …]` and its name.
- `tiles/km/_index.json` — a grid saying which lines run through which part of the country, so only lines
  near a track are fetched.

## How it works

**Naming a new line track** (`lineLookup.js`): the nearest line as a whole gives the line number and name; the
kilometrage of the track's middle gives the name — a track beside line 6340 whose middle lies at km 123.93 is
`6340.12393`.

**Kilometrage of a point** (`kmLineUtils.js`): the line is converted into the track's plane once (and kept so
while the project is open), then the point is projected onto it. The source states kilometrage in whole
metres, so every answer is ±0.5 m — four orders above the millimetre a datum conversion moves things.

**What a project keeps.** After a track is saved, the lines its tracks name are fetched and only the stretch
around the project is kept in `project.kmLines` as `{ id, lineNumber, crs, clip, runs }` (a few tens of kB
instead of a whole line), with id `km-<line number>` — fixed, so two browsers loading the same line produce the same entry rather than a merge
conflict.

**Lines from a file.** The MDB import brings the kilometrage line of the delivery itself (Satzart 24, see
[exchange](exchange.md)), to the millimetre and with its own jumps. It is kept like a fetched line but marked
`source: 'mdb'`; it replaces the shipped line of that number, and `ensureKmLines` fetches nothing over it,
however far the tracks grow. A line no track names any more goes like any other.

**Why WGS84 here.** Everything else in the app is plane data. The km lines are foreign reference data, not
design geometry, and one line serves tracks whose planes may differ — there is no one plane to keep it in.
Clipping by a box is a filter on data, not a measurement; measuring happens in the track's plane.

**Byte source.** Every deploy writes a new archive; the browser then asks for a range with the old ETag and
the server rightly answers with the whole 48 MB file. `KmTileSource` asks once more past the cache.

## Decisions

- **Km lines in WGS84, measured in the track plane.**
- **Only the stretch around the project is stored**, under a deterministic id.
- **A line from an imported file is not replaced by the shipped one.**
- **The DB network and the rest as two overlays** from one archive.

## Tests

`kmTileSource.test.js`, `lineLookup.test.js`.
