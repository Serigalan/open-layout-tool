# elevation — the vertical alignment as a whole

`src/core/utils/elevation/` · needs `track`, `rules`, `switch`, `crossSection`, `geometry`, `common`

The `track` module keeps a track's height points and the arithmetic along one track. This module is what
ties heights to everything around them: the Höhenplan rules of DB Ril 800.0110 (HP.*), the plane a
turnout lies in, the heights at a turnout's toe and last through sleeper — coupled, or taken over one by
one in the design mode —, the profile along a route, and ground heights from terrain models.

## Files

| File | What it does |
|---|---|
| `gradientCheck.js` | HP.LN (gradients) and HP.AR (vertical curves) applied to a track; the Regelwert radius; radii governed by a curve length |
| `switchGradient.js` | The turnout plane: the branch's height from the main route's height, gradient and cant (`ldsLift` on the ldS sleeper, `trackHeightAt` between WA and ldS) |
| `switchChain.js` | WA and ldS: their lines, the coupling of a turnout's tracks there (`withSwitchHeights`, run by the store), `switchMisfits`, `takeOverHeight` for the design mode, `heightRoles` for the profile |
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

Between WA and ldS the plane is drawn (cross section, 3D) but not stored; a height point there is a free
point like any other. A form whose ldS the catalogue does not state is coupled up to WE. Where the areas
of two turnouts overlap on one track (common in crossovers), each draws its plane up to the middle of the
overlap.

**WA and ldS** (`switchChain.js`, decision 384) — every turnout has a point at WA and at the ldS on both
tracks, once their heights reach there (an ldS point is put on the gradient where it is missing). They are
not entered; each follows from the points either side of it:

- *Main route:* every WA and ldS point lies on the straight line Q → P between the nearest free point before
  it and the nearest after it, along the way a train runs (approach, main route, on over the WA of the next
  turnout). Without a point before the WA, the WA is the line's end.
- *Branch* (the connecting track of a crossover is the branch of both turnouts): its WA is the end of the
  track and lies on no line — it is taken over from the main route. Its ldS lies on the line from the point
  before it (its WA, or a free point between) to the first point behind it, which has to be free and its own:
  in a crossover each ldS needs a free point of its own behind it, else the ldS stays as stored and the
  design mode says so.

**Coupled** (the default): a turnout's tracks meet at WA (one height) and at the ldS (the branch in the
plane, `z_b = z_m + g·a + u/1500·y`, `ldsLift`). The store runs `withSwitchHeights` after every write, for
the turnouts on the tracks it changed and then those on the tracks that moved with them: ldS points, lines,
coupling. **The track the write changed leads**: from the main route, the branch takes the toe and moves
the free point behind its ldS so the line through it meets the plane; from the branch, the main route moves
the free point behind its turnout (P) so its ldS lies under the branch's, the branch's toe following the
main route's (a secant on that one height, the rest linear). Both or neither changed: the main route leads;
a track whose heights did not reach the turnout before never leads.

**Design mode** (Entwurfsmodus Weichen, a switch under the Höhenplan's heading): nothing couples — the
lines still hold. A WA or ldS selected in the profile is taken over into the other track
(`takeOverHeight`, the store's `takeOverSwitchHeight`, one undo step): into the branch the toe is set, at
the ldS the free point behind it moves; into the main route its P moves so the line meets the height there.
`switchMisfits` lists what does not fit (WA and ldS apart by more than 0.2 mm, a branch ldS without a free
point of its own); the mode ends only when the list is empty. It is kept per opened project in the session:
a project that does not fit opens in it, and a write the coupling cannot follow turns it on.

Crossings and slips are not coupled.

**Locked points** (`heightLocks.js`, decision 382). A point with `locked` keeps its height and its station:
the profile and its table show it only (a lock column toggles it; deleting it asks first and takes the lock
with it). The store calls `lockBreach` after every write — lines and coupling done — and refuses the write,
said in the step notice, where a locked height went or changed: a locked WA or ldS holds its line and the
coupling with it. A write that reshapes the tracks may move a locked point along them (the alignment comes
first); its height stays. `setHeightsForTracks(…, { unlock: true })` lets a write take locks away.

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
- **One plane per turnout, on sleepers along the bisector**; its tracks meet at WA and ldS.
- **No gradient changes at WA and ldS**; the points there follow from the points either side.
- **Coupled by default, the track written leading; a design mode to take heights over one by one** that
  ends only when every turnout fits (decision 384, replacing the button of 383, the continuation point,
  the crossover's point M and the pairs on sleepers).
- **The earlier lock of turnout heights is gone**; justification is a text on the height point.

## Tests

`gradientCheck.test.js`, `switchGradient.test.js`, `switchChain.test.js`,
`heightLocks.test.js`, `routeProfile.test.js`, `elevationSource.test.js`, `elevationFill.test.js` next to
the files; a crossover in cant in `src/core/test/swappedTurnout.test.js`.
