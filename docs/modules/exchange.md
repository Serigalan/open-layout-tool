# exchange — files in and out

`src/core/utils/exchange/` · needs `geometry`, `track`, `switch`, `rules`, `elevation`, `km`

Reading and writing the file formats other programs use: OSRD's RailJSON and the tool's own alignment
exchange file, Verm.ESN binary axes (TRA/GRA), ProVI interface archives, the Gleislage CSV export and the
DB ASCII interface delivered as an Access database (MDB). The project's own format, oltjson-1.1, is in the
`project` module and described in [data format](../data-format.md). The panels for all of this are in
`components/panels/dataExchange/` and `components/panels/ProviImportSection.jsx`; the MDB section and worker
are server parts (`src/server/panels/MdbSection.jsx`, `src/server/mdb/`), because the Access file is
converted on the server.

## Files

| File | Direction | Format |
|---|---|---|
| `alignmentCodec.js` | both | The element chain as an exchange file states it, shared by the two RailJSON-shaped writers and their reader |
| `osrdExport.js` | out | OSRD RailJSON (schema 4.0.0) with the DB alignment extension, for an OSRD instance |
| `exchangeExport.js` | out | The alignment exchange file: RailJSON-shaped, the design data on each track section |
| `osrdImport.js` | in | Both of the above; rebuilds switches, crossings and links from RailJSON nodes |
| `railJsonImport.js` | in | What a parsed RailJSON adds to a project: fresh ids, renamed tracks, repointed switches and buffer stops, passthrough of unmodelled objects |
| `vermEsnImport.js` | in | Verm.ESN TRA (axis) and GRA (gradient) records → elements and heights; a zip of pairs as a batch |
| `vermEsnKmGradient.js` | in | A gradient stationed along the kilometrage line carried over to the track at right angles |
| `fileCants.js` | both | The cant at both ends of each element, between a file's curve-relative values and the model's |
| `vermEsnExport.js` | out | Tracks and routes as TRA + GRA, zipped with a text naming plane and height datum |
| `proviImport.js` | in | ProVI archives: axes (`A…`), gradients (`T…`), turnouts on axes |
| `gleislageCsvImport.js` | in | The Gleislage CSV export (and cant CSV) |
| `mdbImport.js` | in | The DB ASCII interface (Satzarten 11–41) as converted from Access by the server |
| `mdbGradient.js` | in | MDB gradient (Satzart 22 + 13 + 11) → `track.heights` with its height datum |
| `mdbKmLine.js` | in | MDB kilometrage line (Satzart 24) → `project.kmLines` |
| `mdbSwitchPlacement.js` | in | The MDB's switch inventory placed onto the imported tracks |
| `mdbSwitchDerive.js` | in | Turnouts the inventory does not state, read from the alignment |
| `mdbPipeline.js` | in | The whole MDB import: tracks, plane, switches, links, buffer stops, notes |

## Principles

- **Geometry at full precision.** An exported alignment is re-imported by chaining its values, so a rounded
  bearing walks the whole track off course (10⁻⁴ gon ≈ 9 mm over 44 km). Only float noise is trimmed; reference
  values that rebuild nothing are rounded.
- **Native planes.** Imported coordinates, grid bearings and lengths are taken as they are in the plane the
  file is stated in (the user says which, with a plausibility check against the plane's extent); WGS84 is only
  derived for display. A chain is never reprojected silently. Measured on the test database: computed in each
  element's own Lagesystem the closing error stays at 2 mm, forced into one plane outliers reach 5.9 m — so
  each chain stays in its own system, joined by links, unless the user asks for one target plane (then every
  element is refitted to its transformed nodes, see `geometry/planeTransform`, and the cost is reported).
- **One element builder.** The MDB is the DB ASCII interface in Access form, and Verm.ESN is an extract of the
  same interface with the same type keys (down to the "straight with a kink" carrying its angle in gon in the
  radius field) — so the MDB adapter maps its record types onto the Gleislage/Verm.ESN element builder instead
  of laying out the geometry a second time.
- **Checks against the file's own values.** Every chain is closed against the end points and bearings the
  file states; elements that do not start where the previous ended (tolerance 0.3 mm for Verm.ESN, the source's
  quantisation) are reported, not repaired.
- **Imported data is existing track** (status `existing`); only the RailJSON exchange reads back what the app
  itself wrote.
- **Reports, not silence.** Every import writes notes (key + parameters, translated by the page) to the import
  report, kept per project in the browser, outside the record (eight runs of up to 4 000 lines): a report says
  something about an import, not about the alignment, and must not ride through undo snapshots and exports. A
  full storage keeps only the newest report shortened rather than failing the import.

## Formats

### Alignment exchange file and OSRD RailJSON

Both carry the same element chain — what a polyline cannot express: type, station, length, signed radii, cant
at both ends of a ramp (from the neighbours, or the transition's own `cantStart`/`cantEnd`), design speed,
and for a kinked straight its deflection angle. The **OSRD export** writes OSRD's own `track_sections` (with
its derived curves and slopes) and puts the design data into a DB alignment extension (native CRS anchor, gon
bearings, the element chain). The **exchange file** is RailJSON-shaped but carries the design data itself on
each track section: the horizontal alignment from a native-CRS anchor and the vertical alignment as height
points; it will not load in OSRD. The `olt` extension carries line category and track use.

On import a RailJSON switch is a node whose ports only say which ends meet; the app rebuilds the body from the
branch (port B1): its arc gives node, tangent, radius and arc length, and the form is matched by radius and
arc length including a straight end piece (a 190 – 1:9 matched as a bare arc would be drawn 6 m short).
Crossing kinds are rebuilt from their four legs; links from link nodes. What the app does not model is kept
as passthrough (`project.osrd`) and handed back on export. Tracks are re-id'd where the project has the id
already and renamed where the name is taken; buffer stops and switches follow.

### Verm.ESN

**TRA**, 78 bytes per record, little-endian: radius at begin and end, easting, northing, bearing (rad, grid,
from north clockwise), station (float64), type (int16), length, cant at begin and end (mm, relative to the
element's curve — positive raises the outer rail, negative the inner one —, float64), a float32. Types: 0 straight, 1 arc, 2 clothoid, 4 Bloss, 5 straight with a kink at its end (the
junction angle in gon in `radiusB`: `endBearing = bearing + (radiusB − 200) gon`); 3 and 6 are ignored. A
header record counts the elements; the last record only closes the axis. **GRA**, 36 bytes per record:
station, height, vertical curve radius (negative over a crest), tangent length, point number. Neither file
names its plane or height datum, so the export adds a text naming them.

A **batch** reads a zip: each TRA becomes a track named after its file, and the GRA of the same file name
(case and folders ignored) gives its heights. Plane and height datum are chosen once for all pairs. A TRA
whose elements do not join is left out as the single import refuses it; a GRA without a TRA is reported.
Each track can also come in a second time as a reference axis (Bestandsachse, see `survey`) of the same name
and gradient, to compare the edited track with — in the same undo step; an axis over 2 km becomes several
reference axes of about equal length (`survey/referenceStretches`).

A TRA whose name ends in a digit and `S` (`6340S`, `6311-001S`) is a **kilometrage line**, not a track. A
gradient is often stationed along it rather than along its track: each point is then laid off on the line
(beyond its ends along the tangent), a perpendicular is dropped there, and where it meets the track — or
the track's tangent beyond an end — the point takes its height; the vertical curve radii stay, a track
running against the kilometrage takes the points in its own direction. Which reference holds is decided per
gradient by how far its ends lie from the track's ends (the track's own stationing or each line); a
gradient normally spans its track, and in the test delivery every one was unambiguous to within 5 cm.
Ends up to 2 cm apart count as the same. A track whose gradient runs along a line takes its line number
(the first four digits), and the line goes into the project as a `kmLines` entry marked `source: 'vermesn'`
— otherwise the kilometrage sync would drop it again, since it keeps only the lines some track names.

A **route** is exported as one axis: its tracks in its direction, reversed ones turned (radii and cant with
them), stationed from 0; one GRA from its profile; a direction change at a joint is written as a straight
with a kink. A route that is broken, has no elements or spans planes is not exported; one with tracks without
heights or in different height systems goes out as TRA without GRA — a gradient over part of a route would
not be the route's.

### ProVI

An archive of extensionless text files; `A623B` is axis 623B, `T623B` its gradient. An axis is a chain of
main points (`HP`) with an element between each two: `KO`/`FE`/`PU` straight or arc (three ways of
constructing, not three shapes), `UB`/`UV` transitions (`TYP 2` clothoid, `TYP 8` Bloss; with `L2` a reverse
curve), `WE` a switch whose routes are stationed along the host and branch axes. Over the test archive (176
axes, 5 000 elements, 229 switches) every rebuilt element ends within 0.6 mm of the next main point. Turnouts
are offered for placement where both routes exist as axes.

**Cant at both ends** (`fileCants.js`, decision 355). The files state the cant at the start and the end of
every element, and it does not only change across a transition between a straight and an arc: the test axes
(`memory/testdata/Test_Achsen`) ramp it in records of one radius at both ends (Verm.ESN lays them as type 2),
between two straights (a reverse ramp through 0), hold it across a change of radius, and cant a turnout's
branch against its own curve. The import signs each value by the raised rail: by the element's curve, and
where it has none (a straight, a ramp between two straights) by the cant it continues. A record of one
radius is an arc (both 0: a straight), whatever its cant does; where its two ends differ it keeps both as
`cantStart`/`cantEnd`. A transition keeps its own ends wherever its neighbours do not already imply them.
The export writes the values back relative to the curve, an arc or straight with a ramp as a type 2 record of
its one radius, as the files have it; the six test axes and the two of line 5550 read back record for record. The Gleislage CSV (and through it
the MDB's cant records) and the exchange file keep the ends the same way.

### Gleislage CSV

Rows each carry their own absolute position, bearing and length, so elements are placed independently and
the junctions checked (the source's quantisation is ~1.6 mm). A start bearing of 0 means "continues its
predecessor" and takes the previous tangent. S-shaped transitions have no equivalent in the model. Default
plane DB_REF GK zone 3; the row's system code is not read as a plane — the user states it.

### MDB — the DB ASCII interface

The Access database (GND-Edit, format version 4 or 6 „AGON“) is converted to JSON by the server (`/mdb` of the
optimizer service: one table per Satzart, records marked deleted dropped); everything else is here, where it
is testable. The ProVI import of the same files (DBGNDIN) served as a reference for code lists and checks;
where it is silent or guesses, the delivered files decide.

- **Lagesystem → EPSG.** Three characters: strip (C 6° … F 15° → GK zone 2…5; G/H/I → UTM 31…33), frame
  (`A` DHDN — the western states, on BeTA2007; `B` PD/83 Thüringen; `C` 42/83; `D` RD/83 Sachsen; `R` DB_REF;
  `S` Soldner Berlin; `U` ETRS89 in the UTM strips), serial character. `ER0` is DB_REF in the 12° strip, `EA0`
  DHDN, `DB0` PD/83, `HU0` ETRS89/UTM32. The key calls a serial character other than `0` „other Cartesian
  coordinates“, but GND_6403 delivers its 42/83 chains as `EC9` and they meet the same points in DB_REF within
  9 cm — so it is read like `0` and named in the report.
- **Packed station** (Satzart 11 `STATION`, 24 `EKAKM`/`EKEKM`): `10⁸ + hectometre · 10⁴ + metres`, with four
  places of metres because a hectometre can be longer than 100 m; below 10⁸ the kilometrage is negative and
  packed as its magnitude; below 10⁵ it is the plain metres of a station track. Read so, every kilometrage
  element of the test database is as long as the difference of its ends.
- **Tracks** by line (Strecke): the Gleisabschnitte of Satzart 33 name their elements. A delivery without
  them is grouped by the line both end points of an element name in Satzart 11 (as ProVI does); the leftovers
  of a file with sections by the route name in `ELTEXT`, else by the operating point — cut by point numbers,
  a planned route falls apart where it runs from a station into the line.
- **Track type from the Richtungskennzeichen** (`STRRIKZ` of 33, else `PSTRRIKZ` of the points). Measured
  against the kilometrage line: 1 lies right of it in the direction of rising km (Richtungsgleis), 2 left
  (Gegenrichtungsgleis), 3 is the kilometrage line itself, 4 a station track, 5 another track. 1/2 become line
  tracks with line number and side, 4 a station track with its track number where that is a number, 5 a line
  track where the number is a line (≥ 1000), else a station track.
- **Checks.** Every element is built from its start point, bearing, length and radii and compared with the
  end point the file states in the same Lagesystem (2 mm, ProVI's limit; the test database: 2 of 9 275). The
  mean point error of Satzart 12 (`MP · 10^MPEXP`) tells surveyed points (3 mm) from digitised ones (2 m);
  tracks on digitised points are named.
- **Gradient** (`mdbGradient.js`): Satzart 22 states gradient elements between point addresses with the
  gradient before and after; a rounding has `Rv = 1000·L/Δi`. Satzart 13 gives the point heights per height
  system, Satzart 11 the stations along the line. Height and plan chains share no point address — only the
  station along the line — so the track is located on the line by station, the piece of gradient above it cut
  out and stretched onto the track length with **both ends as anchors** (stationing and geometry measure the
  same stretch slightly differently; anchored at one end the difference would pile up at the other). More
  than 1 % stretch is refused. A rounding becomes one tangent-polygon point at its middle.
- **Height datum.** The Höhensystem of the gradient (`EHSYS`) becomes the track's `heightEpsg`: P DHHN2016
  7837, R DHHN92 5783, V DHHN12 7699, S DHHN85 5784, T HN76 5785. DBRH 2016 (O) and DBRH 2003 (N), the heights
  DB_REF delivers by GNSS, are read as the datum each is tied to — DHHN2016 and DHHN92; where a point is stated
  in both, O lies a median 1.7 cm above N, the step between those two. Systems without an EPSG code (HN56, W,
  X) are not taken. Where several gradients cover a track the current datum wins.
- **Kilometrage line** (`mdbKmLine.js`): Satzart 24 is laid out like the track elements, the kilometrage
  running with the length from `EKAKM` to `EKEKM`; type 6 is the kilometrage jump and ends a run. For every
  line an imported track names, the line is cut to the project and kept in `project.kmLines` with `source:
  'mdb'`, replacing the shipped line of that number — to the millimetre, with the delivery's own jumps.
- **Switches** (`mdbSwitchPlacement.js`): a unit is located by **projecting its point onto the imported
  tracks**, not by topology — 99.4 % of the units lie within 0.5 m of an axis, while the node addresses are in
  a chain only 35 % of the time. The projection finds the turnout shape — one track running through, one
  beginning there — and **no geometry is generated**: both routes are survey, the record only marks them,
  the symbol is derived. The form follows from radius and slope of the Bauform; a frog named behind the slope
  (`EW 60-500-1:12 fb`, `gb`) picks the fb or gb form, none the rigid one. A unit that cannot be built leaves a `switchHint` (form, number, reason) on the
  elements at its point instead of a switch mark, so the track does not read as plain line. The switch number
  comes from the project, the name from the file (the designation on site), the point address as `pad`.
- **Derived turnouts** (`mdbSwitchDerive.js`): an inventory can be short. A track that ends **on** another
  track **and leaves it at an angle** is a turnout — nothing else parts a rail. The form follows from
  curvature, `κ_form = κ_branch − κ_stem` and `1:n = 1/tan(L·|κ_form|)`; ends without angle (a chain cut
  elsewhere, a stretch surveyed twice) are counted, not turned into switches. Crossings are not derived: in
  plan a level crossing and a flyover are the same picture. A measured form the catalogue does not know is
  reported, not bent onto the nearest.
- **Buffer stops** from nodes of form "Prellbock"; **links** at the joints between chains of different
  Lagesysteme.

## Decisions

- **Full precision for geometry; native planes; one element builder.**
- **Chains stay in their survey's Lagesystem**, joined by links; a single target plane only on request.
- **MDB switches by projection, never generated**; unbuildable ones leave hints.
- **ProVI's reading of the MDB as a reference, the files as the judge**: its code lists and its 2 mm check
  are taken; its dropping of elements whose end points name different lines is not.
- **The gradient keeps its own height datum**; DBRH is read as the official datum it is tied to.
- **Track type and side from the Richtungskennzeichen**; a delivery without sections grouped by its points.
- **The kilometrage of the delivery replaces the shipped line** in the project.
- **Derived turnouts need an end on a track and an angle**; no derived crossings.
- **Import reports outside the record.**
- **Routes export as one axis or not at all.**
- **Cant at both ends of every element**, curve-relative in the files, by the raised rail in the model;
  a transition states its own ends only where the neighbours do not; one radius is an arc, ramp or not.

## Tests

A test file per importer and exporter, with real-data fixtures in `src/core/test/fixtures/`
(`mdb_*.json`, `provi_ausschnitt.zip`, `track_optimized.json`), plus `mdbLagesystem.test.js` and
`mdbOhneAbschnitt.test.js`.
