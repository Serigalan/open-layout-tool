# switch — turnouts, crossings, switch connections

`src/core/utils/switch/` · needs `geometry`, `track`, `rules`

The geometry of switches: the forms of DB Ril 800.0120, how a turnout lies on a track (straight, arc or
clothoid), the routes it adds, the drawn symbol, crossings and crossing switches, the switch connection
(Gleisverbindung) between two tracks, connecting a turnout or crossing to an open track end, the position
slider of the dialogs, and what remains of the tracks when a switch is deleted. The record itself — kinds,
ports, element marks — is in the `track` module; what the dialogs commit is in `commands`.

## Files

| File | What it does |
|---|---|
| `catalogue.js` | The forms of `src/core/constraints/db-ril-800-0120.json` as the geometry reads them: turnout tables, crossing tables, fallback stages for connections, branch radius of a bent turnout, bauform, Weichenmarke distance |
| `route.js` | A switch route `{ length, r1, r2 }` and chains of them: points, bearings and slices along a route, the branch of a turnout laid on a given stem |
| `symbol.js` | The drawn switch: routes as polylines, the filled body between them, the LCS line, the label; `rebuildSwitchSymbol` derives all of it from the tracks on load |
| `crossing.js` | Crossings and crossing switches (incl. Bogenkreuzungsweiche): angle, legs, end distances, connecting curves, geometry |
| `sleepers.js` | Where a turnout's sleepers lie (along its bisector, 0.30 + 0.60·k m from WA), the ldS, the sleeper through a point of either track — the grid the heights lie on |
| `detail.js` | A turnout in detail: sleepers (with the bracket sleepers of its variant) and rails in the turnout's own frame, for a laid turnout or a catalogue form on helper tracks |
| `detailScene.js` | A laid turnout in detail with its surroundings: the partners of a switch connection, the turnouts close by and the tracks there, in the turnout's frame |
| `switchPlacement.js` | Where a turnout lies on a track: the toe at a station, the through route over as many elements as it covers; why it cannot lie somewhere |
| `switchCants.js` | The cant of a turnout's two routes kept together after every write (`coupleSwitchCants`) |
| `switchConnectionUtils.js` | The switch connection: two turnouts facing each other on two tracks and the element(s) between them |
| `midChain.js` | One to three elements between the two branches of a switch connection, two of their values sought |
| `connectToTrack.js` | Connecting a turnout's branch or a crossing's leg to an open track end by refitting the element there |
| `stationSlider.js` | The valid stretches and snap points of the position slider |
| `switchDelete.js` | Which routes stay as ordinary track when a switch is deleted, and the plan for doing it |
| `weichenRegelwerk.js` | The form tables grouped for the rulebook viewer |

## Forms

A form *is* its catalogue entry in `db-ril-800-0120.json` — not a copy shaped for the drawing code — so a
measure changed in the file is changed wherever the form is drawn, listed or exported. What the geometry
reads: `R` and `ratio` (1:n) make the body; `branch` lists the sections of a branch that is more than one
arc (e.g. an arc followed by a straight end piece); `symmetric` marks a form without a through route
(215 – 1:4,8); `dLcs` is the Weichenmarke; `lds` the distance from the switch end (WE) to the last through
sleeper (ldS), used for heights; `minl` the shortest intermediate straight 800.0120 names (kept for the
viewer — a connection is held to LP.EL.01, see below); `verbindung`
the fallback stage and rank a form has in a connection (the tool's own choice, marked as such in the
catalogue).

Turnouts are offered in the Ril's two groups: Regelformen (A01) first, Sonderbauformen (A02) after them.
The default is `300 – 1:9`, found by name, not position.

**Variants.** Most forms are built several ways: rail profile 49E5, 54E4 or 60E2A1, concrete or timber
sleepers, as a Regelform or a Sonderbauform. Each way is a row of the DB switch table 800.0120 (05/2024) and
stands under its form as `varianten`: DB number, designation, profile, sleepers, class, sleeper count from WA
to the ldS, `klammer` (sleepers before WA / behind the ldS on the main track / on the branch track), ZS–WA,
smallest radius as an inner-bent turnout, and the table's measures (`masse`). A variant changes neither the
geometry nor the ldS: the catalogue binds, and the table rounds the ldS to 0.1 m. `switchVariantFor(form,
rail)` picks the variant of a rail profile — concrete before timber, Regelform before Sonderbauform, the
form's first where none has the profile. A test builds every row from its form (a = R·tan(α/2), b = a + lz,
l, track distance at WE) to 3 mm.

**Frogs.** The fb and gb turnouts of the DB switch table (federnd beweglich, gelenkig beweglich; run with a
cant deficiency of 130 mm) are forms of their own with `herzstueck` — fifteen of them, labelled like
`500 – 1:12 fb`, some with their own straight end piece, some with the geometry of a rigid form. They run at
the speed of their radius, state no minimum intermediate straight and no connection stage (a connection never
picks them), and take the ldS of the rigid form of the same geometry where the table's rounds to it. The
2500 – 1:26.5 is itself an fb turnout.

**Clothoid and compound-curve turnouts.** Nine fb forms of the DB table have a branch of several curved
sections: a clothoid from a large radius at the toe (the curvature steps there, as the design has it) into an
arc — `6000/3700 – 1:32.5 fb` — two arcs (`7000/6000 – 1:42 fb`), or that and a clothoid running out to the
straight (`…/∞`). `branch` states them as the table does (`{ type: 'clothoid', R1, R2, length }`, arcs with
their `length`); `R` is the smallest radius, which the speed follows. Their through length is t1 + t2, where
the branch's end tangent crosses the through route (`switchTangents`), not a sum of arc tangents. A run-out
branch states more than the turnout: its WE is where the tracks stand `s_we` apart (the table's s), so it is
cut in the run-out clothoid or carried on straight to there — with that every form meets t1, t2 and l of the
table to 2 cm. Laid on a curved stem, a clothoid section's curvature adds to the stem's piece by piece
(`switchBranchChain`), so the branch is clothoids again. A branch piece finds its stretch of stem by its middle
(`cantAt(s, piece)`), since a form of several sections has more pieces than the stem has.

The Weichenmarke is the table's `dLcs`; `switchMark(form)` gives it, and the construction below for a turnout
that states none (the fb and gb forms). Only a form without one would use the construction
`d = 2.272·n − (l_t + g)` with `l_t = R·tan(w/2)`, `w = atan(1/n)`, rounded onto the grid `0.30 + k·0.60 m`.

## A turnout on a track

The turnout's through route is the track itself — one piece per element it covers, cut where the turnout
begins (toe, WA) and ends (WE). It may reach over several elements and lie on straights, arcs and
clothoids; not on a Bloss curve (its pieces are no Bloss curves), not over another switch, not on a kinked
straight, and the track must run through tangentially under it (`switchPlacement.js`).

**Bending.** Laying a turnout into a curve moves no sleeper, so at every station the branch's curvature is
the stem's plus the form's:

```
κ_branch(s) = κ_stem(s) + κ_form          (κ = 1/R, signed)
```

The stem's station is the one abreast of the branch's (`switchAbreast`, Entscheidung 370): the branch is a few
centimetres shorter or longer than the through route, so up to the last element change under the turnout
the stations agree and past it the rest of the branch is stretched onto the rest of the through route. WA
meets WA and WE meets WE — a 500 – 1:12 whose stem runs out into a straight at WE ends on R 500 exactly, not
on the stem's curvature read a few centimetres short of WE (500.21 m in the user's case). The stem
`switchBranchChain` takes is therefore the track from WA to WE, the through length long.

On a stem of constant curvature that is one radius (`branchRadius`); on a clothoid stem the sum still runs
linearly in s, so the branch is a clothoid again (`switchBranchChain`). The result
is the bauform: `plain` (straight stem), `ibw` (inner-bent: branch and stem turn the same way), `abw`
(outer-bent) or `abw_straight` — the limiting case where the branch comes out straight. That case is built
as the plain form with its routes swapped (`swapped: true`, see `track`): the curved line is the branch,
the straight the through route.

**Cant** (Entscheidung 367). Both routes lie on the same sleepers, so the branch carries the cant of the
track beside it, piece by piece: a ramp where the element beside it ramps — a clothoid piece as
`cantStart`/`cantEnd`, an arc or straight piece as its own ramp (`withCantRamp`) — and one `cant` where it
does not. Branch and through route differ in length by centimetres, so the cant is read at the station
abreast (`switchAbreast`): up to the last element change under the turnout the stations agree, past it the
rest of the one route is stretched onto the rest of the other. At WA and at WE both tracks therefore carry
exactly one cant. "Weiche auf Gleis" and the switch connection read it the same way.

**Symbol.** The body is the area between the branch and the through route from the toe to the switch end,
plus the LCS line (Weichenmarke) and the label, placed from the centre of area of the body so the same
distance means the same gap for a 1:7 and a 1:26,5. All of it is derived from the tracks on every load and
never stored.

## The cant of a turnout's routes (decision 376)

A turnout lies on one set of sleepers, so its two routes carry one cant side by side. Laying it reads the
branch off the track beside it (decision 367); `coupleSwitchCants(before, after, switches)` keeps them together
afterwards. The store runs it on every write, before the gradients are coupled (they read the cant), and the
element table on its working copy. Where a write changed the cant along one route, the other takes it, element
by element, at the station abreast (`switchAbreast` over the joints of the route the turnout was laid onto);
both changed, the main route leads. Cant is signed by the raised rail as seen along a track, so a route whose
track runs the other way from the toe takes it with the other sign. The track then carries it on over the
route's ends to the next element that states its ends (`withCantsOver`), and the track up to the toe (port A)
meets the toe with the same cant (`withCantAtEnd`); a cant changed at the end of that track starts the main
route in turn. A track reached that way may hold a route of the next turnout — a crossover's connecting track,
a track running on into another turnout — which is coupled in the next pass, until nothing changes (at most 24
passes). In a station of straights without transitions, a cant therefore runs on through every track and
turnout joined to it: there is no element where it could ramp. Only turnouts are coupled; crossings and slips
are not.

## A turnout in detail

`switchDetail(tracks, sw)` draws a laid turnout, `formDetail(form, { rail })` a catalogue form on two helper
tracks. The frame is the turnout's own: WA at the origin, x along the main route's tangent at WA, y toward the
branch. The variant is the one of the main track's rail at WA (`turnoutSleepers` reads it with
`superstructureAt`).

WA and WE are rail joints in the middle of a sleeper bay. From WA to WE lie as many sleepers as the variant's
count less those from WE to the ldS, spaced evenly (0.596–0.617 m for the DB forms, about 0.63 m for the
run-out turnouts) and square to the bisector — the grid of `sleepers.js`, which the heights snap to as well.
From WE the sleepers are laid off along both following axes: at WE + 0.30 + 0.60·k on the main track and the
same distance behind the branch's own WE, the ldS at the table's distance (the catalogue's where there is no
variant; the table's −0.244 of the 215 – 1:4.8 makes the last sleeper before WE the ldS). Each joins its two
axis points, which fixes its angle. With this every variant reaches the table's count exactly. The sleepers
of the variant's brackets carry on: before WA square to the main track, ±1.30 m; behind the ldS one per track
every 0.60 m, starting at the ldS's angle and turning linearly until the last lies square to its track, 1.30 m
outside and inside shortened to 5 cm short of the middle between the axes. Every sleeper reaches 0.55 m beyond
the outer rail; the rails are parallels 0.75 m beside both axes. WA and WE are drawn as joints, a point on each
rail in the middle of its bay; WM (t1 along the main route) and the ldS on the axes.

**Surroundings.** `switchDetailScene(tracks, switches, sw)` adds what lies around a laid turnout, in its
frame. The partners of a switch connection are found along the branch: its track followed to the far end,
across links, and a turnout met there within 250 m of the toe — or one whose branch leads here — is the other
half; a turnout farther off (the other end of a station track) is not. The partners are drawn in full and the
view is fitted to them with the turnout; every other turnout with a part within 15 m of that box is drawn too,
and the tracks there as runs of their two rails (only the elements near the window are sampled).

## Crossings and crossing switches

A crossing is two routes that cross: `main` A–C and `cross` B–D, stated from the crossing point. Its body is
the rhombus A → D → C → B; the legs are its diagonals. It is stored as four leg tracks (one straight each,
marked `main`/`cross`) plus a track for each slip curve (marked `slip1`/`slip2`) — slip curves hang on no
port and are found by their mark.

The distance of each end from the crossing point is the form's tangent `lt` (the measured value; the end
measure `c = 2·l_t·sin(α/2)` follows from it). A crossing switch with straight legs ends at the tangent
points of its connecting curves, `R·tan(α/2)` along each leg. The Bogenkreuzungsweiche has curved legs of
radius `Rk` and length `lb` each (`l_KW = 2·l_b`); its connecting routes are a straight on the convex side
and, in the double slip, a tighter arc `Ri` on the concave side. A crossing needs straight track on both
sides of the crossing point.

## Switch connection (Gleisverbindung)

Two turnouts of one form facing each other, each laid into its own track, and the element(s) between their
branches. Each branch leaves its track at the form's own angle `w = atan(1/n)` at every station, bent or
not — neither angle nor form radius is free; a solver that bent them would produce a curve no turnout can
build.

**The stem** (Entscheidung 366). Each turnout's toe stands on the element picked on its track, but the
turnout may run on over that element's node into the elements beyond — as far as a turnout may lie on them
(`turnoutRunsOn`: no switch, no Bloss curve, the tangent carried on) — exactly as "Weiche auf Gleis" lays one:
`connectionPick` hands the solver those elements as `pieces`, each with its own start node, route and cant.
A turnout whose toe stands in a transition that runs out into a straight is laid on that clothoid piece and
then on the straight, so its branch is a clothoid and then the form's own arc (R 500 beside the straight for
a 500 – 1:12), not the clothoid carried on past its end. The commit carves the through route over both
elements; the piece behind WE is that of the element the switch end falls in.

**The construction** (`switchConnectionUtils.js`). The unknowns are the toe stations s₁ (on track 1, given by
the slider) and s₂ (on track 2, sought). Branch 1 is the form laid on the stem it covers at s₁. The middle
element is *defined* as the arc leaving branch 1's end on its tangent and turning by `Δ = t₂ − t₁`, so it
meets branch 2 tangentially for any s₂ — tangent continuity by construction at both ends. An arc of given
turn reaches, as its length grows, along the ray bisecting that turn, so the one condition left is that
branch 2's end lies on that ray:

```
r(s₂) = (B2_A − B1_E) · n̂(t₁ + Δ/2)  →  0
```

a signed distance, smooth in s₂ and linear wherever track 2 is straight, so a secant iteration lands on the
straight case's exact answer in one step (a scan takes over where it fails). Tolerance 10⁻⁸ m: the residual
appears as a tangent step of about `r/Lg` at the joint, and must stay under the chain checker's 10⁻⁶°. On
two parallel straights this is the classical intermediate straight; on converging tracks an intermediate arc
of radius `Lg/δ`; in curves and on transitions the same construction.

**Forms per speed.** For a design speed the forms of that speed are tried through the catalogue's three
fallback stages, flatter before sharper. A form fails when the branches leave no room between them, when
the intermediate element breaks LP.EL.01 or LP.KS.01 (below), when a curve or bent branch exceeds the
permitted cant deficiency, or when the cant at the two ends of the middle element differs — the middle
element carries one value, a step would be a ramp of no length.

**Up to three intermediate elements** (`midChain.js`). Instead of one arc the dialog may ask for one to
three elements, each a straight, an arc or a transition, each with length (and an arc's radius) given or
left open. A radius is given with its sign, as the element table shows one — + right, − left, in the
direction the connection runs from the first turnout to the second — and that fixes the side it bends to
(`side` in the spec, Entscheidung 368); an open radius finds its side. Exactly two values are sought; the third unknown is s₂. Transitions run between the curvatures
of their neighbours. The default — one arc with length and radius open — is the closed construction above.

**Checks.** All intermediate elements carry the cant of the middle (the rounded mean of both tracks' cant
at the ldS — the two tracks must carry the same cant there, not at the toe); every arc and transition end
is held to the permitted cant deficiency. Every intermediate element must be at least `l_min` (LP.EL.01 at
the connection's speed), measured as the run of its own curvature: a straight between two branches that
end in straight pieces (190 – 1:9, 500 – 1:14, …) is one straight from arc to arc, so the 1:9 crossover
at 4.0 m spacing (2.99 m between the switch ends) holds. At every joint of an intermediate element with a
jump in curvature the comparison radius (LP.KS.01) must reach the Ermessensgrenze; under the Regelwert the
dialog says so (`checkMidRun`, Entscheidung 356). The pieces of track left
before the toe and behind the switch end, on both tracks, must be zero or at least `l_min` — measured with
the run of the element's curvature beyond the node they end in (`connectionPick` `runs`, Entscheidung 363);
the toe is put on the element change behind it where it can be. "Weiche auf Gleis" measures its pieces
the same way (`switchOnTrackRemnant` `run`, `runAhead`).

**Python solver** (Entscheidungen 357–358). Where no shift of the slider gives a connection, the server
build offers a search in the optimizer service (`/crossover`, `crossover.py`): both toes free on their
elements and one to three middle elements. The geometry stays here — `connectionBranchEnds` samples
both branch ends (point, tangent, curvature, end run, cant at the ldS, the turnout's own checks) every
0.5 m within 300 m of the picks, for every form of the fallback chain; the service interpolates them and
closes element sequences with least squares and SLSQP under the dialog's limits. An answer is adopted as
a shift and a spec with two values open, a `side` for each given radius and a `seed` (second toe and
open values) the iteration starts from (`commands/crossover.js`); the slider's range is then the stretch
around the adopted shift (`computeShiftBounds({ around })`).

**Committed anyway** (Entscheidung 361). A form refused only by the rules above — middle element
(LP.EL.01, LP.KS.01), cant, cant deficiency, the pieces before WA and behind WE — still has a geometry:
`buildConnection` says so as `ruleOnly`, whatever reason comes first; no answer, overlapping branches and
cants that disagree at the ldS are never `ruleOnly`. Where no form of the fallback chain is valid, the
first `ruleOnly` one stands in for the last one tried, and the result is `overridable`. Where no shift is
valid the slider spans the shifts at which one is overridable (`computeShiftBounds({ lenient })`,
`shiftSnaps`/`preferredShift` alike), and `buildSCurve({ force })` builds it.

**Edited** (Entscheidung 364). `solveSwitchConnection(..., form)` and `connectionBranchEnds(..., { form })`
take one form instead of the speed's fallback chain: an existing connection is laid again with its own
turnouts' form (see `commands/crossoverEdit.js`).

## Connecting to an open track end

"Weiche/Kreuzung an Gleis anschließen" (`connectToTrack.js`): a turnout (or crossing) is laid into a host
track, and its branch (or one end of its cross route) is joined to an open end of another track. The
element at that end — the *connecting element* — keeps its other node and the tangent there and takes a
new length and radius so that its open end lands on the port tangentially. The port moves with the
turnout, which slides along the host: one station x. For any x the element is fixed by position alone (an
arc from a point and a tangent to a point is one arc; a transition is fitted by a small Newton method), so
what remains is the direction miss at the port as a function of x. That function is scanned along the
whole host for roots; each opening direction gives its solutions and the one nearest the click is taken.
The branch and the connected track become one track (`joinRouteIntoTrack`), which keeps the connected
track's name, data and direction.

Refused: an end that is not open, a connecting element inside a switch or a Bloss curve, no root, a
length ≤ 0, a toe without room, leftover pieces under `l_min`, and any rule error on the refitted track.
Where the rules reject it, the dialog offers remedies (lower speed, a transition before the arc; see
`commands`) — not a larger radius, which follows from the position.

## Position slider

The dialogs state a turnout's position as a station from the track's BEGIN — a field that takes any value
and a slider beneath it (`stationSlider.js`). The slider runs finely only over the stretches where the
turnout may lie (`validIntervals`: sampled every metre, each edge then bisected to 0.1 mm and rounded
inwards to the millimetre) and skips the rest; it snaps where the toe or switch end falls on an element
change (within 1 m or one slider pixel). It reaches 50 m either side of the click. The validity test is the
placement plus `l_min` before and after the toe.

## Deleting a switch

A switch owns elements: its branch (a track of its own) and its through route, carved into the line it was
laid into. Deleting only the record would leave marked elements of a switch that no longer exists;
deleting everything would tear a hole in a running line. One rule decides (`keptRoutes`): **a route stays
as ordinary track when both its ports carry track beyond the switch, unless a route before it in the kind's
order has already claimed one of those ports.** For a turnout that is the table

| Occupied ports | What stays |
|---|---|
| A and B2 | the through route — a line runs over it |
| A and B1, not B2 | the branch — the through route is a stub |
| anything else | nothing of the switch carries a line |

A crossing's routes share no port, so both may stay; a slip curve shares its ports with both through routes
and stays only where neither does. On a swapped turnout the branch claims the toe first. Kept routes are
unmarked and joined back with their neighbours into one track; what does not stay is removed.

## Decisions

- **The catalogue file is the form.** No form table in the code.
- **One construction for every stem.** Straight, arc and clothoid stems are read as routes
  `{ length, r1, r2 }`, so a connection between a straight and a curve, two curves or a transition is the
  same code.
- **Form angle and radius are never free variables** in a connection; only positions are.
- **A switch connection needs equal cant at the ldS**, not at the toe; one cant on the middle element.
- **The branch's curvature is the stem's abreast plus the form's** (Entscheidung 370), so at WA and at WE it
  is exactly the bending rule, whatever the two routes' lengths.
- **The branch's cant is the through route's abreast**, piece by piece and equal at WE (Entscheidung 367),
  not a line from the cant at WA to the cant at WE.
- **A connection's turnout runs on over an element change** like any turnout laid into a track (Entscheidung
  366); only its toe is bound to the element picked, which is what the slider moves along.
- **Bloss curves carry no turnout**, crossings need straight track.
- **Deleting follows one rule for all kinds** instead of a table per kind.
- **A variant is not a form.** Profile and sleepers do not change the geometry, so they stand under the
  form, whose label stays the key a project keeps; the catalogue's ldS binds over the table's.

## Tests

`switch.test.js`, `crossingUtils.test.js`, `connectToTrack.test.js`, `stationSlider.test.js`,
`switchConnectionUtils.test.js`, `switchDelete.test.js`, `variants.test.js`, `sleepers.test.js`, `detail.test.js` … next to the files; `src/core/test/formChains.test.js`,
`swappedTurnout.test.js` and `switchEnds.test.js`; every construction holds the chain invariants
(`expectValidTrack`, `expectSwitchRoutesCarved`, `expectSwitchCantAdmissible`).
