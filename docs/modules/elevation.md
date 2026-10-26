# elevation — the vertical alignment as a whole

`src/core/utils/elevation/` · needs `track`, `rules`, `switch`, `crossSection`, `geometry`, `common`

The `track` module keeps a track's height points and the arithmetic along one track. This module is what
ties heights to everything around them: the Höhenplan rules of DB Ril 800.0110 (HP.*), the plane a
turnout lies in, the coupling of heights at a turnout's toe and last through sleeper, working out a
switch's other tracks from the one given, the profile along a route, and ground heights from terrain
models.

## Files

| File | What it does |
|---|---|
| `gradientCheck.js` | HP.LN (gradients) and HP.AR (vertical curves) applied to a track; the Regelwert radius; radii governed by a curve length |
| `switchGradient.js` | The turnout plane: the branch's height from the main route's height, gradient and cant; pairs of height points on one sleeper |
| `switchChain.js` | The coupling points at WA and ldS, the continuation behind the ldS, crossovers; `turnoutOtherTracks`, a turnout's other tracks from the one given |
| `otherTrack.js` | The button in the Höhenplan: `otherTrackHeights` for every kind of switch (crossings and slips in the given track's plane), `switchesOfTrack` for its list |
| `heightLocks.js` | Locked height points: `lockBreach`, what a write would change that a lock holds — the store refuses it |
| `routeProfile.js` | The profile of a route — its tracks' points over route stations — and a track as a route of one part |
| `elevationSource.js` | Ground heights: registered point sources (DGM1 via the service in the main build), DGM5 tiles, MapTiler tiles |
| `elevationFill.js` | Keeping joints at one height when tracks are re-read from the terrain |

## Heights are design values

A gradient is **stated** — typed, imported, or read from the terrain **on request** in the height profile —
and never filled in behind the user's back. A track without one shows an empty profile with the button for
it; in the cross section such a track stands, greyed and labelled "no gradient", 20 cm above the ground at
its axis — a stand-in that is never stored. The reference is the top of the rail that is not raised (see
`track`).

## Höhenplan rules (`gradientCheck.js`)

The catalogue judges two kinds of object:

- the **stretch** between two height points (scope `gradient`): its gradient on the tangent polygon —
  HP.LN.01 on open line, HP.LN.02 in station tracks with stops or stabling (the whole station track counts,
  every planning as new construction), HP.LN.03 minimum gradient in tunnels (in the catalogue; tunnels cannot
  be stated yet). A "soll" value not kept is a warning.
- the **gradient change** at an inner point (scope `vertical_curve`): whether it is rounded (HP.AR.01), the
  length (HP.AR.02) and radius (HP.AR.03) of the curve, overlapping curves (HP.AR.04), changes in cant ramps
  (HP.AR.05) and in turnouts (HP.AR.06, HP.AR.07).

What a rule needs beyond the heights comes from the track: line or station track, main track or siding, the
line category (the track's own, else the project's, else *main line*), and from the elements under the
curve their design speed and whether it lies in a turnout, a track connection or a cant ramp. Gradients and
gradient changes are judged to 0.01 ‰ and lengths to the centimetre — a stretch drawn at exactly 12.5 ‰
must not warn because of floating point.

How the radius table (Tabelle 12) is read, with v the largest design speed under the curve (without one,
length and radius stay unchecked):

| Radius r_a | Result |
|---|---|
| > 25 000 m | error (maximum) |
| < Regelwert `0.4·v²`, at least 2 000 m (above 230 km/h 22 500 m) | warning |
| < Ermessensgrenze `0.25·v²`, at least 2 000 m (above 230 km/h 16 000 crest / 14 000 sag) | approval |
| < Zustimmungswert `0.16·v²` crest, `0.13·v²` sag | error |

The curve must be at least 20 m long (Regelwert); in track connections up to 80 km/h and a gradient change
≤ 4.5 ‰, 10 m with r_a ≥ 2 000 m suffice. No rounding is needed up to a change of 1 ‰, on sidings and in
track connections up to 4.5 ‰; a missing necessary curve is an error, a superfluous one a hint. A *track
connection* is a track running into a turnout at both ends and at most 20 m long between the turnouts (the
turnout's own branch elements not counted). Gradient changes in cant ramps and turnouts are hints, below
the Regelwert warnings; inside a turnout area (WA to ldS) a change is a **warning to be justified**
(HP.AR.06, the `reason` on the height point turns it into "justified"), and a curve there below the
Regelwert is an **error no justification removes** (HP.AR.07).

**Regelwert button** (`regularVerticalRadius`): R from Tabelle 12 at the design speed, at least as large as
makes the curve 20 m long, at most 25 000 m, rounded up to full 100 m; where HP.AR.01 wants no curve it is
removed. Where the 20 m govern rather than the table, the point records that length as `la`; from then on
the store recomputes R on every change of an adjoining gradient (`lengthGovernedRadii`: the smallest radius
with `l_a ≥ la`, not under the Regelwert, rounded up to 100 m) until a radius is typed by hand.

## Heights in a turnout

**One plane.** A turnout is laid on through sleepers from the toe (WA) to the last through sleeper (ldS),
and that grid is one plane: the main route's gradient along it, tilted across it by the cant. Where the
ldS lies comes from the form (`lds`: distance behind the switch end WE); a form without it is not coupled
and its area ends at WE.

**Sleepers** lie along the **bisector** of main route and branch — the line equally far from both axes;
sleeper k at `s_k = 0.3 + 0.6·k` m from WA along it, square to it there (`switch/sleepers.js`). The bisector is traced from WA in
1 m steps, each step put back where both axes are equally far. A sleeper crosses the two axes in a *pair*
of points. Nothing here is a setting or stored.

**Height across a sleeper.** With P the sleeper's foot on the main route, Q its point on the branch, `g` the
main route's gradient and `u` its cant at P (mm, signed, positive raises the left rail), and `a`, `y` the
sleeper's run along and across the main route (y to the left):

```
z_Q = z_P + g·a + u/1500 · y          (on a square sleeper a = 0: z_Q = z_P + u/1500 · y)
```

1500 mm is the distance of the running circles. Without cant both routes have the same height; with it a
branch to the raised side lies higher — e.g. main route at 105.75 m, u = 50 mm, branch 2.72 m to the left:
z = 105.75 + 50/1500 · 2.72 = 105.8407 m.

**Pairs.** Every height point behind WA up to the ldS sits on a sleeper and has a partner on the same
sleeper of the other track, with the same curve and reason. **Either track may be given**: working out the
other track (below) snaps the given track's points there to their nearest sleeper and gives the other its
partners at the plane's heights. Heights are kept to 0.1 mm; a pair agreeing within 0.05 mm agrees, from
0.2 mm the check says "turnout plane violated". Where the areas of two turnouts overlap on one track
(common in crossovers), the long sleepers there carry all three tracks: each turnout keeps its grid up to
the middle of the overlap. A form whose ldS the catalogue does not state is coupled up to WE.

**Coupling points** (`switchChain.js`) — no gradient changes at WA or at the ldS; the points there are not
entered but follow from points outside:

- *Main route:* every WA and ldS point lies on the straight line between the nearest free point before it and
  the nearest after it, along the way a train runs (approach, main route, on over the WA of the next
  turnout). Without a point before the WA, the WA is free.
- *Branch:* its ldS point lies in the turnout plane; the first point behind it lies on the continuation of the
  gradient the branch runs into the ldS with — only its station and the gradient beyond it are entered; its
  height is shown, not typed.
- *Crossover* (two turnouts whose branches are the ends of one track, on two different main tracks — a
  passing loop on one main track is none): given a main route, the whole crossover lies in that track's
  plane — the connecting track, and the other main route's WA and ldS, whose line Q₂–P₂ then runs through
  them; nothing is stored between the two ldS. Given the connecting track, both main routes follow it, and
  more than 20 m between the two ldS carry exactly one point, where the two continuations meet, 20 m or
  less none.

**Nothing couples on its own** (decision 383). A write changes what it changes; `heightRoles` still tells the
profile which points it may let the user change (WA and ldS are shown only), and `planeDeviations` where a
turnout no longer lies in its plane. The **Höhenplan lists the switches of the track on show** with the
button that works them out (`otherTrackHeights`, via the store's `computeOtherTrack`, one undo step): the
track on show is *given* and keeps its free points; only what the rules above bind follows — its WA and ldS
on their lines, the point behind a branch's ldS on its continuation, its points between WA and ldS on their
sleepers. The other track takes the turnout's plane — the branch u/1500 · y above the main route at each
sleeper, higher where it leaves to the side the cant raises, lower on the other side, whichever way either
track's stations run. A track without a gradient over the turnout is given points at WA and ldS from the
given track's plane. Crossings and slips (`otherTrack.js`): every other track the switch has elements on
takes, over those elements, the given track's plane — its height at the foot of the perpendicular, tilted
by its cant (`planeAcross`), at both ends of the stretch and in the middle where the plane bows. Where a
lock holds what would change, the store refuses the step as any other.

**Locked points** (`heightLocks.js`, decision 382). A point with `locked` keeps its height and its station:
the profile and its table show it only (a lock column toggles it; deleting it asks first and takes the lock
with it). Where it is one of the points the coupling sets for a turnout (toe, ldS, the point between the ldS
of a crossover, a point on its continuation), the turnout is *frozen* — and with it the other turnout of a
crossover ≤ 20 m: `heightRoles` marks its points `frozen`, and gives the free ends of the lines through its
toe and ldS (Q and P) a continuation role, so they move only along that line. The store calls `lockBreach`
after every write and refuses the write — said in the step notice — where a locked height went or changed,
or a frozen turnout's height at its toe or an ldS did (working it out from a track whose line no longer
runs through a locked toe, say). A write that reshapes a
frozen turnout's tracks is not held there (the alignment comes first); a locked point keeps its height
through it. `setHeightsForTracks(…, { unlock: true })` lets a write take locks away.

## Routes

A route's profile (`routeProfile.js`) shows the points of all its tracks over the route's stations; a single
track is a route of one part, so the profile has one way of drawing and editing both. Every point stays its
track's (`owner`); where two parts meet, their end points are one joint point. A write goes to the owning
track and moves only within it; at a junction the station is fixed. The rule check runs per track and is
mapped onto the route; curves and their overlaps are drawn across track boundaries.

## Ground heights (`elevationSource.js`)

In the automatic choice the best source with a value answers each point:

1. registered point sources (extension point `terrainSources`): in the main build the Länder's **DGM1**
   read by the optimizer service — the Länder publish it only as ZIP tiles without CORS headers, hence the
   service; the local build has none;
2. **DGM5** of the BKG as terrain-RGB tiles to zoom 15 (~3 m per pixel);
3. **MapTiler** terrain tiles worldwide (zoom 12, ~20 m per pixel).

The tile sources use the Mapbox encoding `h = −10000 + (R·65536 + G·256 + B)·0.1` m, "no data" as exactly
0 m. The choice is a user setting (per browser, not per project) and applies to cross sections and gradients.
Height systems (DHHN2016, DHHN92, EGM96) are treated as one — the difference is far below what these models
resolve against a gradient.

## Decisions

- **Gradients on request only**; stand-in heights are never stored.
- **Tabelle 12 read as above**, Regelwert button and length-governed radii as above.
- **One plane per turnout, on sleepers along the bisector**; either track may be given, pairs follow.
- **No gradient changes at WA and ldS**; the points there follow from free points outside the turnout.
- **The earlier lock of turnout heights is gone**; justification is a text on the height point.
- **A switch's other tracks are worked out on request only**, from the track on show (decision 383); the
  separate crossover fitting (heights from cant / cant from heights) is gone — a crossover lies in the
  plane of the main route given.

## Tests

`gradientCheck.test.js`, `switchGradient.test.js`, `switchChain.test.js`, `otherTrack.test.js`,
`heightLocks.test.js`, `routeProfile.test.js`, `elevationSource.test.js`, `elevationFill.test.js` next to
the files; a crossover in cant from either track in `src/core/test/swappedTurnout.test.js`.
