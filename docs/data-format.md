# The project format: oltjson-1.0

Every project of the Open Layout Tool exists in exactly one form, **oltjson-1.0** — in an exported file, in
the browser (local projects and working copies), in the server's revisions and, plus derived display data, as
the model the app works on in memory. This page specifies the format and gives the reasons for its shape.
The code is `src/core/utils/project/persistenceUtils.js` (see [project](modules/project.md)).

## Envelope

```json
{
  "format": "oltjson",
  "version": "1.0",
  "projects": [ { …one record… } ]
}
```

A file may hold several records; the app writes one per project. A payload is accepted only when `format` and
`version` are exactly these — anything else is refused (`unsupported_version`), never converted. A payload that
names the format but does not hold it (switches without `switchId`/`kind`/`formVersion`/`ports`, a switch-marked
element without `switchId`) is refused as `invalid_payload`. That check is the one door: everything behind it may
take the model for granted.

| Where | How the record is kept |
|---|---|
| Exported file (`.json`) | the envelope above; a project image embedded as data URL `image` |
| Local build | IndexedDB `olt-local`: `projects` (the whole record, image as data URL) and `summaries` for the list |
| Server build, browser | IndexedDB `olt` › `workingCopies`: the record being edited plus its base revision and that revision's record |
| Project server | table `revision`: the dehydrated record gzip-compressed in `payload`, `schema_version` 1 = oltjson-1.x; the image as a blob referenced by `imageHash` |
| In memory | the same record, hydrated (derived display data added), immutable |

## The record

```json
{
  "id": "ddf81e71-…",
  "title": "PEK Halle–Könnern",
  "description": "…",
  "creator": "…", "createdAt": "2026-09-10T13:21:07.630Z",
  "crsSystem": "DBREF_GK",
  "lineCategory": "main",
  "gaugeProfile": "hauptgleis",
  "planHeader": { … },
  "imageHash": "…",
  "tracks": [ … ], "switches": [ … ], "platforms": [ … ],
  "endMarks": [ … ], "routes": [ … ], "kmLines": [ … ],
  "axisSurveys": [ … ], "referenceAxes": [ … ],
  "osrd": { … }
}
```

| Field | Meaning |
|---|---|
| `id` | UUID of the project |
| `title`, `description` | set in the project settings |
| `crsSystem` | the project's coordinate system (a key such as `DBREF_GK`, `ETRS89_UTM`); absent = the system of most tracks |
| `lineCategory` | `main`, `secondary` or `s_bahn` — decides the Höhenplan limits; absent = main line |
| `gaugeProfile` | the clearance profile of DB Ril 800.0130 used in cross sections and clearance checks |
| `planHeader` | the editable title block of the plan export |
| `imageHash` / `image` | the project picture: SHA-256 of a blob on the server, or a data URL in files and local projects |
| `osrd` | passthrough of RailJSON objects the app does not model, handed back on export |

Collections, each keyed by its own id (which is also how the merge compares them):

| Collection | Key | Content |
|---|---|---|
| `tracks` | `id` | element chains with metadata and heights |
| `switches` | `switchId` | turnouts, crossings, slips, links |
| `platforms` | `id` | platforms anchored to a track by stations |
| `endMarks` | `id` | buffer stops and planning-area boundaries at free track ends |
| `routes` | `id` | named runs of tracks |
| `kmLines` | `lineNumber` | the stretch of each DB line around the project, with kilometrage |
| `axisSurveys` | `id` | measured axis points traced in point clouds |
| `referenceAxes` | `id` | reference axes (Bestandsachsen) as centimetre points |

### Track

```json
{
  "id": "a9f56232-…", "name": "6050.001",
  "trackType": 1, "lineNumber": 6050, "lineName": "Halle Steintorbf–Halle-Trotha", "side": 1,
  "owner": "DB", "status": "existing", "trackUse": "siding", "lineCategory": "secondary",
  "epsg": 5684, "heightEpsg": 7837,
  "elements": [ … ],
  "heights": [ { "station": 0, "z": 108.55 }, { "station": 1183.141356, "z": 109.88, "rv": 15000 } ],
  "rails": [ { "type": "60E2", "from": 0, "to": 420 } ],
  "sleepers": [ { "type": "B90", "from": 380, "to": 520 } ]
}
```

- `trackType` 1 = line track (`lineNumber`, `lineName`, `side`), 2 = station track (`stationName`,
  `uicStation`, `trackNumber`).
- `status` `existing` | `new` | `removal` (absent = existing); `trackUse` only `siding` (absent = main track);
  `lineCategory` only where the track overrides the project's.
- `epsg` — the **one** plane all its elements are stated in; `heightEpsg` the vertical datum of its heights
  (default 7837, DHHN2016).
- `heights` — the vertical alignment as a tangent polygon: `station` [m from BEGIN], `z` [m, top of the
  unraised rail], `rv` [m] vertical curve radius at that point, `la` [m] curve length that governs `rv`,
  `reason` [text] why a gradient changes inside a turnout. Absent = no gradient.
- `rails`, `sleepers` — superstructure as station ranges; absent = 54 E4 on B70 throughout.

### Element

| Field | straight `0` | arc `1` | transition `2` |
|---|---|---|---|
| `elementType` | 0 | 1 | 2 |
| `startNode`, `endNode` | `[E, N]` m | `[E, N]` m | `[E, N]` m |
| `bearing` | ° at start, grid north, clockwise | ° | ° |
| `length` | m | m (arc length) | m |
| `radius` | — | m, signed (+ right) | — |
| `r1`, `r2` | — | — | m, signed, `null` = straight end |
| `transitionType` | — | — | `clothoid` \| `bloss` |
| `endBearing` | only for a kink | only if it differs from `bearing + length/R` | only if it differs from the integrated one |
| `cant` | — | mm, signed by the raised rail | — (ramps between its neighbours) |
| `cantStart`, `cantEnd` | — | — | mm, only on a cut transition |

Optional on any element: `speed` (design speed, km/h; 0 or absent = unknown, not checked), `cantException`
(the written justification for 100–120 mm cant in a turnout), and on the elements of a switch's route the mark
`switchBranch: true`, `switchRoute` (`main`, `branch`, `cross`, `slip1`, `slip2`) and `switchId`. An import
that could not build a switch leaves `switchHint` (form, number, reason) instead.

There is **no station on an element** — stations are the running sum of the lengths — and no polyline.

### Switch

```json
{
  "switchId": "00000000-0000-4000-8000-000000000001", "kind": "turnout", "formVersion": 1,
  "name": "switch.001", "number": 1, "label": "500 – 1:12", "speed": 60, "trailing": false,
  "ports": {
    "A":  { "trackId": "a9f56232-…", "endpoint": "END" },
    "B1": { "trackId": "4841ff85-…", "endpoint": "BEGIN" },
    "B2": { "trackId": "faf8663f-…", "endpoint": "BEGIN" }
  }
}
```

- `kind`: `turnout` (ports A, B1, B2), `crossing`, `single_slip`, `double_slip` (A, B, C, D), `link` (A, B).
- `label` names the form in `db-ril-800-0120.json`; `formVersion` the version of the form tables it was built
  against.
- `ports.X = { trackId, endpoint }` — which end (`BEGIN` | `END`) of which track the port holds.
- Optional: `swapped: true` (an outer-bent turnout built as the plain form with routes swapped), `status`,
  `mainRadius`/`mainRadiusEnd` (stem radii where the tracks do not state them), `pad` (point address from an
  MDB import).
- No symbol: body, LCS line, label position and bauform are derived on load.

### Platform, end mark, route

```json
{ "id": "12a6…", "trackId": "aa47…", "startStation": 438.2, "endStation": 578.2, "side": "left",
  "frontOffset": 1.67, "backOffset": 4.67, "height": 550, "stationName": "Halle-Trotha", "code": "LHT" }

{ "id": "…", "kind": "buffer_stop", "trackId": "…", "endpoint": "END", "type": 4, "brakeLength": 4 }
{ "id": "…", "kind": "boundary",    "trackId": "…", "endpoint": "BEGIN" }

{ "id": "…", "name": "Route 1", "trackIds": ["…", "…", "…"] }
```

A platform's polygon and a buffer stop's drawing are derived. A route stores only its tracks in running order;
the direction it runs each one is derived from where they meet.

### Km line, axis survey, reference axis

- `kmLines`: `{ id: "km-<lineNumber>", lineNumber, crs: "EPSG:4326", clip: [w, s, e, n], runs: [[[lon,
  lat, km], …], …] }` — foreign reference data in WGS84, the runs of the line clipped to the box around the
  project's tracks.
- `axisSurveys`: `{ id, name, epsg, rail, guide, cloudNames, cloudRefs?, createdAt, step, gaps, points: { e0,
  n0, z0, st, de, dn, zl, zr, ga, q } }` — parallel arrays of whole millimetres (see [survey](modules/survey.md)).
- `referenceAxes`: `{ id, name, epsg, heightEpsg, source, points: { s0, step, count, e0, n0, de, dn, z } }` —
  a point every centimetre, millimetre differences.

## Numbers

| Quantity | Unit | Kept to |
|---|---|---|
| coordinates, lengths, radii, stations | m | 1 µm (6 decimals) |
| heights `z` | m | 0.1 mm (4 decimals) |
| bearings | ° | 10⁻⁹° |
| cant | mm | 0.001 mm |
| design speed | km/h | as entered (5 km/h steps) |

## What is never stored

Everything that follows from the rest is stripped on save and rebuilt on every load (`hydrateProjects`):
element polylines (`geometry`, `renderCoords`), `track.coordinates`, switch symbols (`fillCoords`, `lcsCoords`,
`labelCoords`, `bodyCentre`, `bauform`), platform polygons, the end bearing of arcs and transitions where it
agrees with the design values. Also outside the record: point clouds (on the device or on the server), import
reports (per project in the browser), user settings (language, colour, layers, terrain source), which tracks
are hidden on this device, and images on the server (referenced by hash).

## Why the format is shaped like this

**One format everywhere.** File, browser, server and in-memory model are the same record. There is no
conversion layer between them that could lose or invent anything, the server checks a revision with exactly the
code the browser wrote it with, and an exported file can be read back anywhere.

**Design values, not polylines.** A track is stored as what was designed — straights, arcs and transitions with
their lengths, radii and cant — because that *is* the design. Polylines would lose the design values (a radius is
not recoverable from vertices at millimetre precision), would make every edit a re-sampling, and are many times
larger. Every drawn coordinate is derived reproducibly from the design values by one factory and one integrator,
so a fresh element and a reloaded one are identical.

**Plane coordinates, one plane per track.** Railway alignments are designed and surveyed in projected planes
(DB_REF / Gauß-Krüger, ETRS89 / UTM, historic Lagesysteme). Storing WGS84 would put a datum transformation into
every load and save — not exact (DB_REF ↔ WGS84 is ~0.6 mm off in a round trip) and, for historic datums, grid
dependent. A track keeps the plane it was designed or surveyed in, so imported data stays exactly as delivered;
where a line crosses from one plane into another, two tracks meet in a `link` node, as in the DB data and in
OSRD. The kilometrage lines are the one exception: reference data shared by tracks in different planes.

**Heights independent of elements, stationed along the track.** The vertical alignment of a railway is designed
as its own tangent polygon with vertical curves, independent of where horizontal elements begin and end. Tying
heights to elements would force a height point at every element boundary and lose them on every re-shaping.
Stations along the track survive edits of the horizontal alignment; only a length change moves the stations
behind it.

**Derived data is not stored.** What is not stored cannot disagree with what is. It also keeps diffs and merges to
primary data (a re-sampled polyline is no change), keeps the record small — a project of 22 tracks and 13
switches is ~75 kB of JSON, ~15 kB gzipped — and lets display precision change without touching any data.

**Stable ids, references by id.** Every object that something else refers to has its own UUID; references are an
id plus, for track ends, `BEGIN`/`END` — never a name (names are labels users change, and two records could share
one) and never an array index. Collections keyed by id are what makes a field-by-field three-way merge possible.
Elements have no ids, so a track's `elements` and `heights` are merged as one value each — a deliberate trade
between merge granularity and format simplicity.

**Ports as an object.** `ports: { A: { trackId, endpoint } }` names each port; which ports a kind has is the kind's
business. A fixed set of fields per port (as before) or an array of anonymous ports would both need a format change
for a new kind; reading and writing go through three functions, so the storage form lives in one place.

**End marks, routes, surveys as collections.** A buffer stop names its track end like a switch port and rides the
same remap when a track is split or reversed; a field on the track would be copied onto both halves of a split.
Routes store only track ids so that turning a track round leaves them right.

**Precision with a reason.** Positions are kept to 1 µm, not 0.1 mm: a switch laid into a track read back at
0.1 mm would inherit a tangent break of 10⁻⁵° on a 40 m arc — ten times the 10⁻⁶° the chain checks hold every
joint to. (0.1 mm would have made the file only ~15 % smaller after compression.) Heights are kept to 0.1 mm so that
a gradient between two close points is right to 0.01 ‰. Angles to 10⁻⁹° are below a micrometre over 50 km.
Exchange exports write the design values at full precision for the same reason: re-imported values are chained,
and a rounded bearing walks a long track off course.

**JSON.** Readable, diffable, and every platform reads it; the browser parses it natively and the server stores it
gzip-compressed. Binary formats would save little after compression and cost inspectability.

**Old data is refused, not migrated.** When the format was introduced there was no production data to carry
over, and a loader that accepts several versions spreads "this field might be missing" through all code behind it.
Instead, one door checks the version, and every older file, browser project, working copy or server revision is
refused with a message (the server answers `409 format_outdated` for older rows). A future change to the format
gets a new version and, where data exists by then, an explicit conversion at that door — not tolerant readers
everywhere.

## Why not an existing format

The app reads and writes these formats for exchange (see [exchange](modules/exchange.md)); none of them can be
its own:

| Format | What it lacks as the project format |
|---|---|
| OSRD RailJSON | Track sections carry polylines and derived curves/slopes, not the design chain; no vertical tangent polygon with vertical curves, no cant ramps, no switch forms of Ril 800.0120 (a switch is a node), no platforms as stationed objects, no variants. The app writes it with a DB alignment extension and keeps unmodelled objects as passthrough. |
| Verm.ESN (TRA/GRA) | One axis per file pair, binary, no plane or datum stated, no topology, no switches, platforms or metadata. |
| ProVI, Gleislage CSV, DB ASCII (MDB) | Interfaces of other programs and of the DB inventory, each covering part of the model; read, not written (except Verm.ESN). |
| LandXML | Alignments and profiles, but no switch forms, track topology, cant ramps as the DB rules see them, or the objects the tool adds (end marks, routes, surveys); verbose XML. |
| IFC 4.3 (IfcRail) | Rich, but a large object model built for BIM exchange, not for editing and merging in a browser; geometry by placement chains that are expensive to evaluate and hard to merge. |

A format of its own, shaped like the model, keeps the app free of mapping layers and lets the exports be what they
are meant to be: translations for other programs.
