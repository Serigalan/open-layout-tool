# pointCloud — point clouds

`src/core/utils/pointCloud/` · needs `geometry`, `track`, `crossSection`, `elevation`, `survey`, `km`

Mobile-mapping and terrestrial scans as spatial constraints for the design: LAS, LAZ and E57 files of several
gigabytes read as streams, tiled and thinned into the browser's Origin Private File System (or, in the main
build, prepared on the server), cut into thin slices for the cross section, checked against the clearance
contour, searched for rail heads to trace a track's measured axis, and re-referenced onto each other. The same
pure functions run in the browser, in a Web Worker and in the project server's jobs.

## Files

| Area | Files |
|---|---|
| Reading | `lasHeader.js`, `lasReader.js` (LAS/LAZ chunk by chunk), `lazChunkTable.js` (the LAZ chunk table, ported from LASzip), `lazPerfBrowser.js` (laz-perf WASM), `e57Reader.js` + `e57Xml.js` (E57), `cloudReader.js` (either), `lasText.js` (preview) |
| Import | `importPipeline.js` (file → tiles, one or five levels), `pointCloudWorker.js` + `pointCloudImport.js` (the browser import in a worker), `cloudProbe.js` (extent and plausibility against the project) |
| Storage | `tiles.js` (tile format, segments, levels), `cloudStore.js` (OPFS), `cloudCache.js` (OPFS cache of server tiles), `cloudSource.js` (one reader for local and server clouds), `projectClouds.js` (local + provider clouds of a project) |
| Planes | `cloudCrs.js` (affine map per 250 m cell instead of proj4 per point), `registration.js` (spatial Helmert from point pairs), `cloudRegistration.js`, `surveyShift.js` |
| Use | `cloudSection.js` (points in a cross section), `cloudSlice.js`, `cloudPaint.js`, `cloudOutline.js`, `clearanceCheck.js`, `clearanceScan.js`, `railDetect.js`, `railTrace.js`, `serverRuns.js`, `cloudServer.js`, `cloudFormat.js` |

## Where a cloud lives

- **Local clouds** are read on one device into its OPFS, one directory per project and cloud
  (`pointclouds/<project>/<cloud>/tiles.bin` and its index, written last — a directory without an index is
  an aborted import and is cleared away). **Nothing about them is in the project record**: 260–400 MB per km do
  not fit into a revision, and another device simply has none. Local clouds keep everything they could do
  before the server existed: cross section, clearance at a station and along a track, rail trace.
- **Server clouds** (main build) are uploaded once and shared with all members of the project. Viewing is open
  to all members; changing clouds (upload, delete, re-reference, server runs, saving measured axes) needs the
  admin or the right "edit point clouds", checked on the server. The server keeps five levels and serves tiles
  by range requests; the browser caches what it fetched in OPFS (packs per server answer, least recently used
  dropped past a limit, 2 GB default). Only the server has the 3D view and re-referencing (`src/server/cloud3d`).

## Import

A delivery is a few long files of several GB, read **chunk by chunk**, never whole: LAZ through its chunk
table and laz-perf's `ChunkDecoder` — laz-perf does not expose the table, so its arithmetic decoder and integer
compressor were ported from LASzip (the reading part only, checked against laspy on every chunk of the sample);
E57 by its pages, XML section and compressed vectors, with each scan's pose applied. The import asks for the
file's plane and height system **every time, without a default** — LAS headers name none, it differs per
delivery, and a default would be clicked through and put the cloud silently beside the track; a plausibility
probe against the project's tracks catches gross mix-ups.

**Tiles** are 2 × 2 m squares in a plane: mobile-mapping data arrives in scan order, so a tile is written once
the scanner has moved on (a later pass adds a segment). Two resolutions locally:

- **2 cm voxels** (default): one point per voxel, ~260 MB per km instead of ~400 at 1 cm; the survey itself is
  hardly better than 2 cm, and a 10 cm slice still keeps five voxel layers. Per point x, y in millimetres from
  the tile corner and z from the segment's lowest point as Uint16, intensity as a byte; sorted by height, then
  across, then along, delta-coded, zlib — about 3.9 bytes per point. Tiles in the plane of most of the project's
  tracks, converted on import.
- **Original**: every point, on the file's own integer grid in the file's own plane — a LAS/LAZ comes back
  bit-exact (rounding to absolute millimetres moved the sample's points by up to 0.5 mm, as its offset is not on
  whole millimetres); E57 is kept to 0.1 mm. Converted when read. Three to four times the storage.

On the server all five levels are made in one pass, all in the file's own plane: L0 original, L1 2 cm voxel, L2
8 cm, L3 32 cm, L4 1.28 m, with tiles of 2, 2, 8, 32 and 128 m and units of 1, 1, 2, 8, 32 mm so a tile fits in
Uint16; colour 8 bit per channel where the file has it. Tile format version 3; versions 1 and 2 stay readable.

**Converting** hundreds of millions of points through proj4 with an NTv2 grid behind it would be slow, so
`cloudCrs.js` uses an **affine map per 250 m cell**: the exact conversion of the cell's centre plus its
Jacobian by central differences; the error against proj4 is far below a millimetre.

## In the cross section

The cross section reads the points within ±5 cm of its plane (a 2D scatter under the drawing; sleepers and
rails turn half transparent so the measured heads show against the planned top of rail). Decoded segments are
cached, so walking the station slider costs only the filtering and the few new tiles. Not Potree: Potree loads
by level of detail and shows only a subset far away, while "does anything reach into the profile" needs the
actual points of the slice.

## Clearance

`clearanceCheck.js` carries the slice's points into the track's frame (over its top of rail, turned back by the
cant about the same running circle) and tests them against the project's clearance contour. A point counts as an
intrusion when it lies inside the outline, **at least 50 mm over the running plane** (rail heads, check rails
and ballast touch the lower edge from inside by survey noise), and outside the permitted intrusion areas (shown
orange, not counted). Depth and nearest distance are measured against the sides and roof, not the lower edge.

Along a whole track (`clearanceScan.js`) the section moves in **0.5 m steps with a 0.5 m slice**, at each
station's gradient and cant, so every point beside the track is looked at once; consecutive steps with intrusions
become one stretch, and a click jumps to its deepest intrusion. Without a gradient a track cannot be checked.

## Rail detection and trace

`railDetect.js` finds the two heads in a slice by their **flangeways**: on the inner side of each head the
surface drops away (the flange runs there), and the two drops face each other at 1435 mm. The outer side of a
head is no help — scanned from the side it smears into ghost points. Each inner flank is measured as the vertical
face 20–35 mm under the head top; the head centre is the flank plus half the nominal head width (49 E5, 54 E4,
60 E2, worn heads included), the axis point the middle of the two centres (see `survey`).

`railTrace.js` walks a guide — a track of the project or a line drawn over the cloud outline — in steps, allows
the track to be up to about a metre off its guide (measured: 0.53–0.84 m between a track and its own Verm.ESN
axis on line 5550; neighbours stand 3.5 m and more apart), tries slice rotations while nothing foresees the
track, and keeps every step's axis point. Turnouts leave gaps. The result is saved as an axis survey or exported
as a point file.

## Long runs on the server

For server clouds the track-wide clearance scan and the trace run as jobs on the server, with the same
JavaScript (over 5 km the browser would otherwise load 1.5 GB of voxels, 8 GB of originals): when the user may
change clouds and every cloud read lies there. Results are kept seven days (a trace until saved), at most four
runs per project, two at a time in their own queue beside the preparation queue.

## Re-referencing

A cloud can be fitted onto another with a **spatial Helmert transformation** found by least squares from point
pairs picked in both (`registration.js`):

```
T(p) = c + t + s · R · (p − c)          R = Rz(κ)·Ry(φ)·Rx(ω)
```

with c the centre of the picked points. Always estimated: the shift (east, north, height) and the turn κ about
the vertical; the tilts ω, φ and the scale s only on request — scanned data are metric, and points along a
railway lie nearly in a line and a plane, so the tilts are often poorly determined. A 3D pair gives three
equations, a pair picked in the cross section two (across and height): on a straight the shift along is then
undetermined, on a single arc the turn about its centre — the rank check says so and asks for a 3D pair. Pairs
with a normalised residual over 3.29 (two-sided, α = 0.1 %) are flagged. T is stored on the server with its
pairs, residuals, author and date, outside the revisions, with its own history; the tiles stay unchanged and T
applies when reading. A new T replaces the old one (not chained). Axis surveys remember the T of the clouds they
were traced in and are marked when it changes (`surveyShift.js`).

## Decisions

- **Clouds are not part of the record**; local clouds stay on their device, server clouds are shared per project.
- **Plane and height system asked on every import**, no default.
- **2 × 2 m tiles in plane coordinates**, not by station (a station-based store would be stale after every axis
  change and valid for one track only); 2 cm voxels by default, originals bit-exact on request.
- **Scatter in the cross section, not Potree.**
- **Intrusion = inside the outline, ≥ 50 mm over the running plane, outside permitted areas.**
- **Rails found by their flangeways.**
- **Helmert with shift and κ by default**, tilts and scale on request.

## Tests

A test file per reader, the tile format, the import pipeline, the clearance check and scan, rail detection and
trace, registration and the survey shift; fixtures generated by `src/core/test/pointCloudFixture.js` and E57
samples in `src/core/test/fixtures/e57/` (made by `tools/e57fixtures.py`).
