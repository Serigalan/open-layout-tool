# splice — joining two track ends

`src/core/utils/splice/` · needs `geometry`, `rules`

The construction behind "Zwei Gleise zusammenfügen": given two picked elements, find every way to join an
end of one to an end of the other with an arc, a straight or transitions, judge each solution by the rule
catalogue and rank them. It is the JavaScript port of the optimizer service's `splice.py`, runs in a Web
Worker and is used by both builds; the dialog's request and commit are in `commands/splice.js`.

## Files

| File | What it does |
|---|---|
| `solveSplice.js` | The construction: all cases, transitions (clothoid, Bloss; given, Regel- or Mindestlänge), alternatives, ranking, explanations when nothing fits |
| `spliceRemedies.js` | What a splice can change when LP.KS.01 rejects a curvature jump: speed at the joint, a larger radius, transitions instead of the jump |
| `spliceJob.js` | One worker kept between requests; a cancelled request takes the worker with it |
| `spliceWorker.js` | The worker entry |
| `serviceAnswers.json` | 243 answers of the Python service to random requests — the reference the port is tested against |

## The construction

Each pick comes in the plane of its track: its two ends, the bearing at its end, its signed radius, its
length and how much track lies before and after it. **Which ends meet is found, not taken from the clicks**:
every pair of ends (end–start, start–end, end–end, start–start) is constructed, the departure run into the
splice at its end and the arrival met at its end, a pick joined at its other end handed over flipped. The
cases:

| Picks | Construction |
|---|---|
| straight – straight | an arc of the requested radius in the corner, transitions either side optional |
| arc – straight | a new arc between them (the arc pick re-shaped), transitions optional |
| arc – arc | a straight between them with optional transitions, **or** a single transition from one curvature to the other |

Transitions are clothoids or Bloss curves, each side on its own (on/off, form, length). Lengths may be
given, or the Regellänge/Mindestlänge the rules ask for **in the very chain solved** — the lengths are set
from the chain, the chain built again, up to eight rounds. The geometry mirrors the service's: transitions
integrated with Gauss-Legendre, shift parameters from the integral.

A solution must be **continuous** (no gap > 0.1 mm, no kink > 10⁻⁴°, transitions meeting their neighbours'
curvature) and must not **loop** (turn by more than half a circle beyond what the picks turned already).

## Ranking

Each solution is judged as a whole by `checkTrack` — the rest of the departure, the inserted elements, the
rest of the arrival and all joints, with the speed and cant each element will carry: what is inserted at the
dialog's speed, the rest of a pick at its own — or at the dialog's where that is lower (`picksAtSpeed`,
Entscheidung 362; reconnecting likewise). Order: the mildest
worst finding first (ok, hint, warning, …, error); then the way of joining asked for before the other; then
the least rebuilt (track given up + change of the picks' lengths + new length). The best is proposed and
shown on the map; the others can be stepped through where there are any.

For two arcs **the other way of joining is always tried too**: a direct transition instead of a straight
and vice versa (the straight with the transitions asked for, or where none were, at the Regellänge). If
only the other way fits, the panel says why the requested one does not.

When **nothing fits**, the error names what would: the largest radius below the requested one, between an
arc and a straight also the smallest above it, and the longest equal transitions that fit at the requested
radius. Lengths are named even without a solution.

## Remedies

Where LP.KS.01 (comparison radius at a curvature jump) rejects a joint, `spliceRemedies` solves again with:
a lower speed at the joint (the highest that removes the error), a larger radius of the inserted arc (rounded
up), or transitions instead of the jump — each offered with what remains on it. The same remedies (speed,
transition before the arc) are offered when connecting a switch to a track (`commands/connectRemedies.js`).

## Why in the browser, and why a port

The splice runs in the browser in both builds, so the local version can join tracks without a server. Most
answers take a millisecond, but searching the largest radius that keeps a spacing builds the splice over and
over and takes a second or two — hence the worker. The spacing to a neighbouring track itself stays in the
Python service (`clearance.py`): with a spacing the server build asks the service for the whole splice; the
local build has none. "Reconnect" and the alignment fit also stay in Python and use `splice.py` there.

Two implementations of one construction drift apart unless something holds them together:
`tools/optimizer/tests/splice_answers_fixture.py` writes the service's answers to `serviceAnswers.json`, and
`solveSplice.test.js` requires the port to give the same answers; in CI `--check` fails when `splice.py`
changed without the fixture being rewritten. **Whoever changes `splice.py` rewrites the fixture and follows
the change in `solveSplice.js`.**

## Tests

`solveSplice.test.js` (against the 243 service answers), `spliceRemedies.test.js`.
