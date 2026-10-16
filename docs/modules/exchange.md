# exchange — files in and out

`src/core/utils/exchange/` · needs `geometry`, `track`, `switch`, `rules`, `elevation`

Reading and writing the file formats other programs use: OSRD's RailJSON and the tool's own alignment
exchange file, Verm.ESN binary axes (TRA/GRA), ProVI interface archives, the Gleislage CSV export and the
DB ASCII interface delivered as an Access database (MDB). The project's own format, oltjson-1.0, is in the
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
| `vermEsnImport.js` | in | Verm.ESN TRA (axis) and GRA (gradient) records → elements and heights |
| `vermEsnExport.js` | out | Tracks and routes as TRA + GRA, zipped with a text naming plane and height datum |
| `proviImport.js` | in | ProVI archives: axes (`A…`), gradients (`T…`), turnouts on axes |
| `gleislageCsvImport.js` | in | The Gleislage CSV export (and cant CSV) |
| `mdbImport.js` | in | The DB ASCII interface (Satzarten 11–41) as converted from Access by the server |
| `mdbGradient.js` | in | MDB gradient (Satzart 22 + 13 + 11) → `track.heights` |
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
at both ends of a ramp (from the neighbours, or the cut transition's own `cantStart`/`cantEnd`), design speed,
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
from north clockwise), station (float64), type (int16), length, cant at begin and end (mm, magnitude,
float64), a float32. Types: 0 straight, 1 arc, 2 clothoid, 4 Bloss, 5 straight with a kink at its end (the
junction angle in gon in `radiusB`: `endBearing = bearing + (radiusB − 200) gon`); 3 and 6 are ignored. A
header record counts the elements; the last record only closes the axis. **GRA**, 36 bytes per record:
station, height, vertical curve radius (negative over a crest), tangent length, point number. Neither file
names its plane or height datum, so the export adds a text naming them.

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

### Gleislage CSV

Rows each carry their own absolute position, bearing and length, so elements are placed independently and
the junctions checked (the source's quantisation is ~1.6 mm). A start bearing of 0 means "continues its
predecessor" and takes the previous tangent. S-shaped transitions have no equivalent in the model. Default
plane DB_REF GK zone 3; the row's system code is not read as a plane — the user states it.

### MDB — the DB ASCII interface

The Access database is converted to JSON by the server (`/mdb` of the optimizer service); everything else is
here, where it is testable.

- **Lagesystem → EPSG.** Three characters: strip (C 6° … F 15° → GK zone 2…5), frame (`A` RD/83 —
  read as DHDN on BeTA2007, since nothing in a file says a chain is Saxon; `B` PD/83 Thüringen; `C` 42/83;
  `S` Soldner Berlin; `R` DB_REF), serial digit. `ER0` is DB_REF in the 12° strip, `EA0` DHDN, `DB0` PD/83.
- **Tracks** by line (Strecke); elements of no Gleisabschnitt are grouped by the route name in `ELTEXT`,
  else by the operating point — otherwise a pure geometry export would import nothing.
- **Gradient** (`mdbGradient.js`): Satzart 22 states gradient elements between point addresses with the
  gradient before and after; a rounding has `Rv = 1000·L/Δi`. Satzart 13 gives the point heights per height
  system, Satzart 11 the stations along the line. Height and plan chains share no point address — only the
  station along the line — so the track is located on the line by station, the piece of gradient above it cut
  out and stretched onto the track length with **both ends as anchors** (stationing and geometry measure the
  same stretch slightly differently; anchored at one end the difference would pile up at the other). More
  than 1 % stretch is refused. A rounding becomes one tangent-polygon point at its middle.
- **Switches** (`mdbSwitchPlacement.js`): a unit is located by **projecting its point onto the imported
  tracks**, not by topology — 99.4 % of the units lie within 0.5 m of an axis, while the node addresses are in
  a chain only 35 % of the time. The projection finds the turnout shape — one track running through, one
  beginning there — and **no geometry is generated**: both routes are survey, the record only marks them,
  the symbol is derived. A unit that cannot be built leaves a `switchHint` (form, number, reason) on the
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
- **Derived turnouts need an end on a track and an angle**; no derived crossings.
- **Import reports outside the record.**
- **Routes export as one axis or not at all.**

## Tests

A test file per importer and exporter, with real-data fixtures in `src/core/test/fixtures/`
(`mdb_*.json`, `provi_ausschnitt.zip`, `track_optimized.json`), plus `mdbLagesystem.test.js` and
`mdbOhneAbschnitt.test.js`.
