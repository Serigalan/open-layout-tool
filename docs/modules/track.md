# track — the records a project is made of

`src/core/utils/track/` · needs `geometry`, `rules`, `km`, `common`

Pure functions on the objects of a project record: tracks and their element chains, the vertical alignment
along a track, the switch record and its ports, links, marks at track ends, platforms, routes, and the
operations that split, join and reverse tracks. Nothing here reads or writes the store — that is what lets
the importers, the merge and the Node project server use the same code.

## Files

| File | What it does |
|---|---|
| `trackModel.js` | Making, reversing and joining tracks; repointing switch ports after a split/join (`remapSwitches`); track labels and names |
| `switchModel.js` | What a switch record is: kinds, routes, ports (`portsOf`, `portTrack`, `portEnd`, `withPort`), the element mark that ties a route's elements to their switch |
| `heightUtils.js` | The vertical alignment `track.heights`: stationing, interpolation, editing a point by two given values, splitting/joining/reversing heights, joint heights, vertical curves |
| `heightDatums.js` | Height point spacing and the vertical datums (DHHN2016, DHHN92, EGM96, EGM2008) |
| `identifierUtils.js` | Ids, track type fields (line track / station track), switch numbering and designations |
| `trackSplitUtils.js` | Splitting an element or a track at a point (straight, arc, clothoid), carving a switch route out of a track |
| `mergeElements.js` | Runs of elements that are one element merged into one (`mergeChain`): pieces a carve left (switch deletion), or, with `equal`, consecutive elements alike in kind, radius (to 1 mm) and cant — the element table's merge |
| `trackLinkUtils.js` | Links: the node where one track ends and the next begins in another plane |
| `topology.js` | The state of every track end (switch, link, joint, buffer stop, boundary, open); which tracks continue from an end |
| `trackEndMarks.js` | Buffer stops and planning-area boundaries at free track ends |
| `bufferStopGeometry.js` | How a buffer stop is drawn |
| `platformUtils.js` | Platforms anchored to a track by two stations; stationing helpers (`pointAtStation`, `stationOnTrack`, `pointOnElement`) |
| `platformForm.js` | The platform dialog's fields and the record they make |
| `routes.js` | Routes: named runs of connected tracks with their own stationing |
| `trackGroups.js` | Grouping tracks by line or station for lists and assignment |
| `planStatus.js` | Planning status (existing / new / removal) of tracks and switches |
| `alignmentBands.js` | Curvature, cant and speed bands over the station |
| `search.js` | Matching tracks and switches against typed text |

## Tracks

A track is a chain of elements in one plane (`epsg`) plus metadata:

- **Identity and naming:** `id` (UUID), `name`, `trackType` (1 line track, 2 station track); a line
  track carries `lineNumber`, `lineName`, `side`; a station track `stationName`, `uicStation`,
  `trackNumber`. A new line track is named from the kilometrage of its middle (`km` module).
- **Use and rules:** `trackUse` (`siding`, otherwise main track), `lineCategory` only where the track
  overrides the project's.
- **Heights:** `heights` (below) and `heightEpsg`, the vertical datum (DHHN2016 by default).
- **Planning status** `status`: `existing` (Bestand), `new` (Neubau), `removal` (Rückbau) — drawn black,
  red and yellow on a plan as DB drawings read them. A switch without a status of its own takes it from its
  tracks: a turnout from its branch, a crossing from any road; *new* wins over *removal*.

The **station** along a track is the distance from its BEGIN (the start node of its first element). It is
never stored on elements: it is the running sum of the element lengths.

Splitting (`splitElementAt`, `splitTrackAtJoint`) cuts a straight into two collinear straights, an arc into
two arcs of its own radius and a clothoid into two clothoids of its own parameter — at a station, because a
clothoid's curvature runs with the station. A Bloss curve cannot be cut (its pieces would be no Bloss
curves); callers reject one first. The cut is computed in the plane, so the junction lies exactly on the
line. `joinTracks` is the inverse, and `mergeChain` makes the pieces one element again where they differ in
nothing but the cut; with `{ equal: true }` it merges any run alike in kind, radius and cant that meets
without a kink, the rest of the fields from the first (Entscheidung 378). Reversing a track flips every element (bearing + 180°, radii and cant
change sign, r1/r2 swap) and mirrors its heights.

After any split, join or reversal, everything that names a track end — switch ports, end marks — is
repointed through one remap (`remapSwitches`: a split sends a port to the half that holds its end; a fold
backwards swaps BEGIN/END). End marks and routes ride the same remap; see the store.

## Switch records and ports

A switch record has a `switchId` (UUID), a `kind`, a `formVersion` and its `ports`:

| Kind | Ports | Routes (ports they run between) |
|---|---|---|
| `turnout` | A (toe), B1, B2 | `main` A–B2, `branch` A–B1 |
| `crossing` | A, B, C, D | `main` A–C, `cross` B–D |
| `single_slip` | A, B, C, D | as crossing + `slip1` A–D |
| `double_slip` | A, B, C, D | as crossing + `slip1` A–D, `slip2` B–C |
| `link` | A, B | none |

`ports` is an object: `{ A: { trackId, endpoint }, … }` with `endpoint` `BEGIN` or `END` of that track.
Code reads it only through `portTrack(sw, port)` / `portEnd(sw, port)` and writes it through `withPort`, and
walks the ports of a record through `portsOf(sw)`, so a kind with more ports is one more table entry.

The elements of a switch's routes are separate tracks that carry a **mark**: `switchBranch: true`,
`switchRoute` (`main`, `branch`, `cross`, `slip1`, `slip2`) and `switchId`. Membership is decided by the id
alone (`elementBelongsToSwitch`) — never by the name, which is a display string the user may change and two
records may share. Name, form label and number are the switch's own; elements keep no copy.

`swapped: true` marks an outer-bent turnout whose branch became straight by bending: it is built as the
plain form with its routes swapped — the curved line is its branch (B1), the straight its through route
(B2) — and the line runs on over B1 (`turnoutLinePort`). Only the record can say so; the geometry at a joint
gives no sign.

`formVersion` freezes the form table a record was built against, so a later change of a form's
dimensions cannot silently move switches already drawn.

Switch numbers are the lowest free number in the project; designations are `switch.008` for turnouts and
`crossing.003` for the crossing kinds.

## Links

A track carries one plane, but a line does not stop where the survey changes coordinate system. Where it
does, the chain has to be cut — a bearing is grid-relative and a node a pair of grid coordinates, so the
elements of one system cannot be stationed in the other's grid. What joins the two chains can only be a
node, never a stretch (a stretch would have to lie in one of the planes): a switch record of kind `link`,
two ports, no routes, no elements, no form. OSRD has the same object and the export writes it.

Finding links (`findTrackJoints`): the two chains end at the same surveyed point stated in two systems,
which transformed into one plane differ by what the transformation gets wrong — measured 7 mm to 13 cm with
the BeTA2007 grid, 0.79–1.04 m without it. The tolerance is therefore 1.5 m, and since distance alone would
pair ends that pass close by, the tangents must also oppose within 2°.

## Track ends

`topology.js` gives every track end exactly one state: `switch` (held by a switch port), `link`, `joint`
(meets exactly one other free end on the same node, < 1 cm, same plane), `buffer_stop`, `boundary`, or
`open`. There is nothing in between: an end that merely comes close to something is open. Open ends are
what the topology view draws red. Ends are hashed into ~1.5 m cells so a project of a thousand tracks
compares each end with a handful of others.

**End marks** (`project.endMarks`) are records of their own naming an end like a switch port does
(`trackId` + `endpoint`): a `buffer_stop` (type 4/6/8/10 — for now a placeholder that only proposes the
brake length — and `brakeLength`) or a `boundary` of the planning area, which makes an open end
intentional. They are a collection and not a track field because tracks are split, reversed and joined in a
dozen places that already hand the switch ports a remap; a mark rides that remap, while a field would be
copied onto both halves of a split. A buffer stop is 2.20 m long and stands in the track; the brake length
lies between it and the track end. Only free ends carry marks; a port taking the end over removes it.

## Heights — the vertical alignment

`track.heights` is `[{ station, z, rv?, la?, reason? }]`, ascending in station, the first at 0 and the last
at the track's length:

- `station` [m] from BEGIN, `z` [m] the height of the top of rail of the **rail that is not raised** — in a
  curve usually the inner rail; the cant lifts the other one.
- `rv` [m] the radius of the vertical curve rounding the gradient change at that point.
- `la` [m] where the curve's *length* governs (20 m minimum): `rv` is then recomputed from the gradients
  either side whenever they change (see `elevation`).
- `reason` — why a gradient changes inside a turnout, which turns the rule's warning into "justified".

The heights belong to the track and are independent of its elements: re-shaping the elements does not
move them, only a change of length moves the stations behind it. A track without a gradient has no
`heights`; nothing fills them behind the user's back — they are stated, or read from the terrain on request.

The tangent polygon (`heightAt`) is linear between points. The built height (`gradientAt`) rounds each
gradient change with a parabola of curvature 1/R — what a vertical curve of radius R is at railway
gradients:

```
T = R·|i₂ − i₁| / 2                                   (tangent length)
z(x) = z_P + i₁·x + (x + T)²·(i₂ − i₁) / (4T)          for |x| < T, x = s − s_P
```

Editing a point in the Höhenplan table fixes two of its four values — station, height, gradient before,
gradient after — and solves the other two with both neighbours staying put (`solveHeightPoint`): e.g. given
both gradients, the point is the intersection
`s = (z_b − z_a + i₁·s_a − i₂·s_b)/(i₁ − i₂)`. Stations are kept to the millimetre and heights to 0.1 mm
(`roundHeight`), so a gradient between two points is right to 0.01 ‰ over a few metres. A point closer than
0.1 m to a neighbour is refused.

**Joints carry one height.** The end points of all tracks meeting at a node — the three ends at a turnout's
toe, two tracks laid end to end — are one point (`jointGroup` walks them across switch ports and same-node
ends); editing one edits all (`jointHeightUpdates`). Splitting a track inside a vertical curve gives each
half its piece of the parabola, so both still run at the built height.

## Platforms

A platform is anchored to one track by two stations (`startStation`, `endStation`) and a `side`. Its edges
are perpendicular offsets of the track axis: the front edge at 1.68 m (`frontOffset`), the back edge a
3.00 m width behind it. One edge distance for every height and cant — the graded tables belong to a later
design stage — but overridable. Vertically it is stated over the top of rail (`height` in mm: 380, 550 or
760), so its absolute elevation is the track's gradient at that station plus the height, and the two are
never kept side by side. The drawn polygon is derived on load and stripped on save.

## Routes

A route is a named run of connected tracks — over joints, links and switch routes — with its own stations
from 0 in its direction. It stores **only its name and its track ids in running order**; which way it runs
each track follows from where consecutive tracks meet (`resolveRoute`), so turning a track round leaves the
route right. Two consecutive tracks that do not meet, or a track that is gone, are a gap the route reports.
When a track of a route is split, joined or deleted, the store replaces it in the same step by the tracks
now lying there, in order along the old one (`repairRoutes`, by geometry, as the merge carries platforms).

## Decisions

- **The switch id is the link, the name is a label.** Comparing names joined elements of different
  turnouts once two records shared one.
- **Ports are one object on the record** (`ports.A`), read and written through three functions, so the
  storage form is in one place.
- **End marks, routes and switch ports follow tracks through one remap**, not by copying fields.
- **One height per joint.** Three ends of a turnout are one point on the ground.
- **Heights are the track's own, on the unraised rail**, and never invented — a gradient is stated or
  requested.
- **Planning status in three colours** as on a DB drawing; time stages are variants, not years on tracks.

## Tests

Next to the files (`trackModel`, `heightUtils`, `trackSplitUtils`, `trackLinkUtils`, `topology`,
`topologyOnFrom`, `trackEndMarks`, `routes`, `platformUtils`, …), plus `src/core/test/switchEnds.test.js`
and the chain invariants in `src/core/test/chainInvariants.js`.
