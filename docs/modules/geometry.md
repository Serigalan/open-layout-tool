# geometry — planes, elements, transitions

`src/core/utils/geometry/` · depends on nothing else in `utils`

The bottom of the stack. Everything that has a position in the app is a point in a **projected plane**
named by an EPSG code, and every piece of track is an **element** — a straight, a circular arc or a
transition curve — stated by its two end nodes in that plane plus a handful of design values. This module
knows the planes and how to convert between them, builds elements, samples them into polylines for the
map, offsets whole tracks into parallels and carries a track from one plane into another.

## Files

| File | What it does |
|---|---|
| `coordinateUtils.js` | The coordinate systems the app knows (datums, Gauss-Krüger and UTM strips, Soldner Berlin), proj4 definitions, plane ↔ WGS84 and plane ↔ plane conversion, grid bearings across planes |
| `ntv2Grid.js` | Loads the NTv2 grids (BeTA2007, Thüringen, Hessen, Saarland) the historic datums are converted on |
| `clothoidUtils.js` | The one integrator for transition curves (clothoid and Bloss), points and bearings along them, projection onto them, shift parameters |
| `elementUtils.js` | Straight and arc arithmetic in the plane: arc centre, end points, tangent bearings, projection of a point onto a straight or an arc, reversing an element, the derived end bearing |
| `elementFactory.js` | The only place elements are made: `straightElement`, `arcElement`, `transitionElement` and their `…From` variants |
| `elementReconstruct.js` | Derives the display geometry (WGS84 polylines) of stored elements on load |
| `geometryPrecision.js` | The sampling constants: sagitta of drawn arcs, vertex spacing of straights, GeoJSON tile zoom |
| `parallelUtils.js` | Offsets a whole track sideways into a continuous parallel track |
| `planeTransform.js` | Carries a track into another plane by refitting each element to its transformed nodes |
| `chainChecks.js` | The invariants an element chain must hold (node gaps, tangent breaks, untrue lengths, foreign EPSG) |

## The model

### One plane per track

A track carries one EPSG code (`track.epsg`); all its elements are stated in that plane as
`[easting, northing]` nodes. Calculations take points as `{ easting, northing, zone }` where `zone` is the
EPSG code — never a UTM zone guessed from a coordinate.

WGS84 is **only ever produced**, for the map and for file formats that want it, and **never an input** to a
calculation. Two reasons:

- A WGS84 round trip is not exact. The DB_REF datum shift alone is about 0.6 mm off when converted there
  and back, and the alignment is computed to micrometres.
- A zone guessed from a point can be the wrong plane altogether. Germany's tracks are surveyed in
  Gauss-Krüger strips of different datums; the same coordinate means different places in each.

The one exception in the whole app are the kilometrage lines (`km` module): foreign reference data, kept in
WGS84 as delivered.

### Coordinate systems

`coordinateUtils.js` knows these systems, each a datum with one projection, cut into meridian strips, each
strip one EPSG code:

| System | Codes | Datum shift to WGS84 |
|---|---|---|
| ETRS89 / UTM | 25828–25838 | none (ETRS89 = WGS84 here, sub-cm in Europe) |
| DB_REF / Gauß-Krüger | 5681–5685 | 7 parameters, EPSG "DB_REF to ETRS89 (1)" — exact by construction |
| DHDN / Gauß-Krüger | 5680, 5676–5679 | BeTA2007 grid (Hessen, Saarland: finer regional grids), else 7 parameters |
| PD/83 / Gauß-Krüger (Thüringen) | 3396, 3397 | Thüringen's NTv2 grid, else 7 parameters |
| RD/83 / Gauß-Krüger (Sachsen) | 3398, 3399 | 7 parameters (grid deliberately not shipped, see below) |
| 42/83 / Gauß-Krüger | 2397–2399 | 7 parameters (EPSG rates them 0.1 m; no grid published) |
| DHDN / Soldner Berlin | 3068 | as DHDN |
| WGS 84 / UTM north, south | 32601–32660, 32701–32760 | none |

Gauss-Krüger zone *n* has its central meridian at *n*·3° and a false easting of *n*·10⁶ + 500 000 m. The
EPSG blocks are not numbered consistently (DHDN 5680 is zone 1, 5676–5679 are zones 2–5), so every block is
decoded on its own instead of by subtraction.

**Why these datum parameters.** Every 7-parameter set is EPSG's own, in the position-vector convention
proj4 expects. DB_REF's EPSG operation is stated in the coordinate-frame convention, so its rotations are
negated; using DHDN's parameters for DB_REF (an earlier mistake) put every DB_REF point 0.227 m off.

**Why grids.** A 7-parameter shift is good to about a metre; a grid to a few centimetres, which the plan
view needs. Each datum has a *base grid* over its whole area, loaded at start-up before the first project
is read (hydration converts every historic coordinate), and may have finer *regional grids*, loaded only
when an import asks for that area (`loadGridsFor(bbox, datums)`). proj4 cannot drop a grid once loaded,
which is why only what overlaps is loaded. A grid that fails to load leaves its datum on the 7-parameter
shift — the app keeps working at metre level rather than refusing to start.

Not shipped, on purpose: Sachsen's RD/83 grid (4.25 MB, ~188 MB heap) — no import can tell a Saxon
chain from a DHDN one (the DB's Lagesystem letter `A` covers both), so all `A` data is read as DHDN on
BeTA2007; and Baden-Württemberg's BWTA2017 (73 MB). Bavaria's own transformation was withdrawn in 2024.

**Outside a grid** proj4 returns `[NaN, NaN]` silently. `project()` converts such a point again with the
7-parameter shift: a metre of error past the grid's edge is worth more than a NaN that surfaces far away as
a track that will not draw.

The project and each track choose a *system*; the strip is the track's own (see `project` module). A new
track takes the strip whose central meridian lies nearest to the first click (`systemCodeAt`).

### Elements

| `elementType` | Element | Design values |
|---|---|---|
| `0` | straight | `bearing`, `length` |
| `1` | circular arc | `bearing`, `length`, `radius` (signed) |
| `2` | transition | `bearing`, `length`, `r1`, `r2` (signed, `null` = straight), `transitionType` (`clothoid` or `bloss`) |

Every element has `startNode` and `endNode` (`[E, N]` in the track's plane). Conventions:

- **Bearing** in degrees, 0 = grid north, clockwise.
- **Signed radius**: positive = right-hand curve (clockwise seen in the running direction), negative =
  left; `null` or 0 is straight. Internally curvature κ = −1/R.
- **Cant** (`cant`, mm) is signed by the raised rail; it sits on arcs (and a canted straight). A transition
  ramps it: its ends take the cant of the neighbouring elements (`transitionCantEnds`) unless it states
  its own `cantStart`/`cantEnd` — typed in the element table, brought by an import whose ramp is not simply
  the one between its neighbours (a ramp inside an arc, a reverse ramp between two straights), or kept by a
  piece a cut left without those neighbours (decision 355).
- **End bearing** is not stored where the design values give it (arc: `bearing + length/R`, transition:
  the integrated heading). It is kept only where it differs — a kinked straight, an imported tangent
  (`derivedEndBearing`, see [data format](../data-format.md)).

All elements are made by `elementFactory.js` from plane points and design values, and carry two derived
polylines in WGS84: `geometry` (fine, sagitta 5 cm) and, for arcs and transitions, `renderCoords` (coarse,
20 cm). `reconstructElements` derives exactly the same on every load, so a fresh element and a reloaded
one look alike. Straights are stored as two points; for the map `displayCoords` inserts a vertex every
100 m, because Web Mercator draws the chord, and a 1 km east–west straight at 50° N bends 23 mm away from
its chord.

## How it computes

### Arcs

`arcCenter` puts the centre on the perpendicular bisector of the chord at distance
`h = √(R² − (c/2)²)`, on the side the sign of R says. Arc length, start and end bearing follow from the
two radius angles (`computeCurvedValuesUtm`). Running a given length from a point (`endPointCurvedUtm`)
turns the radius vector by `±length/|R|`. The bearing after an arc is `bearing + length/R` (radians →
degrees).

### Transitions — clothoid and Bloss

Both profiles run the curvature from κ₁ to κ₂ over the length L; they differ in how:

```
clothoid:  κ(s) = κ₁ + (κ₂ − κ₁)·s/L
           Δφ(s) = κ₁·s + (κ₂ − κ₁)·s²/(2L)

Bloss:     κ(s) = κ₁ + (κ₂ − κ₁)·(3(s/L)² − 2(s/L)³)
           Δφ(s) = κ₁·s + (κ₂ − κ₁)·(s³/L² − s⁴/(2L³))
```

Both turn through the same total angle `Δφ(L) = (κ₁ + κ₂)·L/2`. There is no closed form for the position,
so `sampleTransitionUtm` — **the single integrator every transition in the tool is built on** — marches
`x' = cos φ(s)`, `y' = sin φ(s)` with composite Simpson's rule. Each output point is reached by several
Simpson sub-intervals, so it lies on the exact curve however coarsely the curve is sampled; integrating only
up to some `s < L` gives a point on the very same curve (`transitionPointAtUtm`). The number of drawn
segments follows the sagitta: the largest angle step whose chord stays within the tolerance at the
smallest radius.

Projecting a point onto a transition (`projectOnTransitionUtm`) takes the nearest chord of a 1 m sampling
as a start and refines the foot with a few Newton steps on the tangential offset.

`transitionShift(L, R)` gives the shift `p` (Abrücken) and `t` of a straight-to-arc transition from the
same integrator — exact for any L/R, without the series approximations (clothoid `p ≈ L²/24R`, Bloss
`p ≈ L²/40R`).

A clothoid's curvature is linear in s, so **every piece of a clothoid is a clothoid of the same
parameter** (`clothoidRadiusAt`). That is what lets a turnout be laid into a transition. A Bloss curve has
no such property and cannot be cut.

### Parallel tracks

`offsetTrackElements(elements, d, epsg)` offsets every node by `d` along the right-hand normal of its
tangent (positive = right): straights stay parallel, arcs become concentric (`R − d`, same centre), and
transitions are refitted between the offset nodes with their deflection kept — the new length is
`L·(κ₁ + κ₂)/(κ₁' + κ₂')`. Every offset end is the perpendicular offset of the original end, so the joints
coincide exactly. An offset that collapses a radius below 0.5 m returns `null`.

### Moving a track into another plane

Relabelling `epsg` would move a track by kilometres; even the right numbers do not survive the move: a
bearing is grid-relative (grid north turns ~2.6 gon between GK zones 3 and 4 — some 40 m over a
kilometre), and a length or radius is a plane length (Gauss-Krüger's scale grows away from the central
meridian). What survives is the **node**: a point has one position on the ground. So `transformTrackToPlane`
transforms the nodes and refits each element as a similar shape between them:

```
k = |E' − S'| / |E − S|                       (ratio of the chords)
bearing' = bearing + (γ' − γ)                  (γ: chord direction)
length' = length·k     radius' = radius·k     r1', r2' = r1·k, r2·k
```

That lands on both nodes exactly for all three kinds (a straight's bearing is its chord direction; an
arc's chord is 2R·sin(θ/2); a clothoid is defined by lengths alone, A² = R·L). What it does not keep is the
tangent between two elements whose chords rotate differently; the function reports that *increase* over the
source data's own kinks. Measured over 4 954 joints from DHDN GK4 into DB_REF GK3: 7.9·10⁻⁶° median,
3.7·10⁻⁴° worst. Chords under 0.1 m state no direction reliably and are carried with a 10 m probe instead.

### Chain invariants

`chainChecks.js` states what every chain must hold: consecutive nodes within 1 mm (`JOINT_TOL`), tangents
continuous within 10⁻⁶° (`BEARING_TOL`), stated lengths true (a straight to 0.5 µm against its chord, an arc
to 0.5 mm against its arc length, a transition at least its chord), and no element in another plane than
its track. The test helper `src/core/test/chainInvariants.js` asserts them on every construction, and the
project validation reports them.

## Decisions

- **Plane data is the truth, WGS84 is derived** — see above. Nothing derived is stored (see the data format).
- **One integrator for all transitions.** Points, bearings, projections, the drawn polyline and the shift
  parameters all come from `sampleTransitionUtm`, so they cannot disagree with each other.
- **One factory for all elements.** Every dialog, importer and construction makes elements through
  `elementFactory.js`, so a new element and a reloaded one carry the same fields and geometry.
- **Grids where they exist, 7 parameters as the fallback**, never failure.

## Tests

`clothoidUtils.test.js`, `coordinateUtils.test.js`, `crsNaming.test.js`, `elementFactory.test.js`,
`elementUtils.test.js`, `ntv2Grid.test.js`, `ntv2Regional.test.js`, `planeTransform.test.js` next to the
files; the grids are checked against `pyproj`'s best operation to 10⁻⁹°.
