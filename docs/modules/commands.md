# commands — what the dialogs commit

`src/core/utils/commands/` · needs `geometry`, `track`, `switch`, `rules`, `crossSection`

Every dialog that changes the project collects its inputs, calls one function here and hands the result
to the store as one undo step. The functions are pure: they take the project state and the dialog's
settings and return tracks, elements, switch records — or a refusal with a locale key. The tests call the
same functions, so what they check is exactly what the dialogs write. The dialogs themselves only gather
input, show previews and findings, and claim names and numbers.

## Files

| File | Dialog | What it builds |
|---|---|---|
| `tracks.js` | Create element, connect straight/curve, parallels | New tracks; straights, arcs and transitions appended at a track end; parallel tracks |
| `switches.js` | Switch on track, crossing on track | A turnout or crossing laid into a track at a station: split track, carved through route, new branch tracks, switch record |
| `sCurve.js` | Switch connection (Weichenverbindung) | Both turnouts and the connecting track between two tracks, for a toe position (shift) on track 1; the range of valid shifts and the snaps |
| `crossover.js` | Switch connection, Python solver | The request for `/crossover` (both branch ends sampled, the limits) and an answer adopted as shift, middle elements and seed |
| `crossoverEdit.js` | Edit switch connection | Which track is a switch connection, the connection taken apart in memory (the turnouts deleted, their lines joined), where the dialog starts on it, and the commit that replaces it |
| `connectSwitch.js` | Connect a turnout to a track | The turnout on the host and the refitted connecting element (see `switch/connectToTrack.js`) |
| `connectCrossing.js` | Connect a crossing to a track | The same for one end of a crossing's cross route |
| `connectRemedies.js` | both of the above | What can be changed where the rules reject the refitted element: lower speed, a transition before the arc |
| `splice.js` | Join two tracks (Zwei Gleise zusammenfügen) | What a picked element offers, the request, and the merged track built from the answer |
| `reconnect.js` | Reconnect existing elements (Neu verbinden) | The stretch between two clicks, the old axis every 1 cm, the request to the service and the track written back |
| `editGeometry.js` | Track editor (element table) | Planning and applying length/bearing/radius changes and how far they reach; a Zwischenelement laid anew between its neighbours |
| `elementRoles.js` | Track editor (element table) | Fest-, Folge- and Zwischenelement: the roles elements state and the ones that follow from them, what each lets be typed |
| `tableView.js` | Track editor (element table) | The rows of a track or a route: a route's tracks in its direction, one it runs against turned round; each row's track element, values and edits turned back (`inRun`, `trackEdit`, `writeRows`) |
| `optimizeApply.js` | Optimize track (server) | The optimizer request and the track a result makes, keeping the gradient |
| `optimizeReport.js` | Optimize track (server) | The reason the optimizer gives for a changed row, as text |

## How they behave

**New elements** come from the element factory (`geometry`). A new track takes the coordinate system of the
project and the strip nearest the first click; its metadata comes from the dialog's track fields.

**Cant** of a new arc (`tracks.js`, `cantAtTrackEnd`): always freely selectable. Without a transition in
front, the default is the cant of the adjoining element — only a transition ramps cant; with a transition
the Regelüberhöhung is proposed. "Connect straight" after a canted arc switches its transition on at the
Regellänge, following speed and form until a length is set by hand.

**Rules gate every commit.** The elements a dialog would write are checked with the catalogue (`checkTrack`)
in the chain they will stand in, joints included; any error blocks. Transition lengths are offered as
Regellänge and Mindestlänge with the governing rule and its formula.

**Switch on track** (`switches.js`): the toe position is a station on the track; the turnout may reach over
several elements; the pieces of element left before the toe and from the toe to the next node in the
opening direction must be zero or at least `l_min` (LP.EL.01 at the speed of the *diverging* track, from
40 km/h). The new branch track takes the stem track's height datum. Switch records get the lowest free
number. A crossing needs straight track either side of its crossing point.

**Switch connection** (`sCurve.js`): the slider sets the toe of the first turnout as a station on track 1
(±50 m around the click); the construction finds the second (see `switch`). WA is placed first on the
element change behind the turnout; the remaining pieces on both tracks must be zero or at least `l_min`. The
connecting track is the branch of both turnouts. If the tracks are canted, the dialog then offers to fit
the crossover's heights (`elevation`).

**Editing a switch connection** (`crossoverEdit.js`, Entscheidung 364; in the Edit panel): a track that
begins and ends at a route (B1/B2) of two turnouts of one form a turnout can be laid in with
(`SWITCH_PICK_TYPES`), with one to three elements of its own between their routes, is one
(`switchConnectionOf`). `takeApart` removes it in memory and deletes both turnouts as the
delete dialog does (`planSwitchDeletion`, each line joined back into its track), and puts the picks where
the toes stood — toe and switch end projected onto the joined tracks, the pick on the element of the toe, from
which the turnout runs on over an element change as it lay (Entscheidung 366). `editStart` gives the dialog the
middle elements as they are, two values open so that they close at shift 0 (`adoptCrossover({ lenient,
exactFirst })`; one element alone is the closed-form arc). Where the construction does not lay it as it
lies — cants that disagree at the ldS, a connection made by "Weiche an Gleis anschließen" that does not
close — it opens all the same (`closes` false): elements as they are,
the first two lengths open, the old values as seed; the dialog names the reason. The dialog then runs on those tracks with the form fixed
(`form` through every solve, `crossoverRequest({ form })`); `buildSCurve({ identities, connTrack })` keeps
the switch ids, names and numbers and the connecting track, `editCommit` puts the two deletions before it,
and `storage.commitSwitchConnectionEdit` runs all of it as one undo step.

**Splice** (`splice.js` + `splice` module): a picked straight or arc may be re-shaped; a transition only at a
track end, as the point it ends in (`joinAt`), and the splice builds on from there leaving it as it is. The
departure is the pick whose end faces the gap, whichever was clicked first; where two ends or two beginnings
meet, the **shorter** track is reversed and folded in, and the merged track keeps the name and data of the
one that keeps its direction. The speed defaults to the larger of the two picks (none: not checked). The
merged track's gradient: the departure's up to where the new track leaves it, the arrival's from where it
rejoins it, and one straight gradient between — no point and no curve at the two junctions. Platforms and
height points are re-stationed. With a spacing to a neighbouring track the request goes to the optimizer
service instead (only the server build has it).

**Reconnect** (`reconnect.js`, server build): the stretch between two clicks on one track is replaced by the
splice construction that keeps closest to the old axis. The old axis is sampled every 1 cm in the browser,
sent as whole millimetres from an origin; the service searches radius (50–50 000 m, whole metres, with the
app's cant), transitions at Regellänge, Mindestlänge, none, or fitted to the old axis by least squares, and
between two arcs also a direct transition. Best: within tolerance (default 0.10 m, the largest distance both
ways) before outside, then the mildest rule finding, then the smallest maximum, then the smallest RMS
deviation. Removing and reconnecting is one undo step; the track keeps its id, name and data; heights and
platforms in the stretch are re-stationed proportionally, behind it shifted by the length change. A
neighbour may be kept at a minimum spacing plus the widening from cant.

**Track editor** (`editGeometry.js`): a changed length, radius or bearing re-shapes everything hanging off the
element's end, across tracks. A change is refused if it would move **more than one switch or more than three
tracks** — past that nobody can hold in their head what a typed number moves. The bearing is display only
(a typed bearing would rotate everything behind it from a cell that looks like a property of one element). A
transition next to an arc follows the arc's new radius at its end, keeping its length, where it joined
tangentially and outside turnouts. Length and radius are shown to 3 decimals and kept at full precision; only
a real change is taken over. A kinked straight keeps its kink.

**A route in the track editor** (`tableView.js`, decision 381): the table shows a route's tracks one after the
other in the route's direction; a track it runs against is turned round (order, bearings, radius and cant signs,
cant start/end). A cant, a speed or a reason goes onto the track element turned back; a length, a radius and a
role are worked out on the track turned round and turned back (`inRun`, switch ports flipped with it), so a
Folgeelement moves what follows along the route and the joint before it stays. V_max reads the whole route,
including the joints between its tracks; merging alike elements stays within each track.

**Delete elements** (done by the store itself, `storage.deleteElements`): any number of elements on several tracks in one step;
what is left of a track falls apart into connected pieces (the first keeps the name); where the axis is cut,
each piece gets a height point on the built gradient (in a vertical curve its piece of the parabola).

## Decisions

- **Pure commands, thin dialogs** — what is tested is what is written.
- **Errors block commits**, in the chain the elements will stand in.
- **Shorter track is reversed** when splicing two ends or two beginnings.
- **Edit reach: more than one switch or more than three tracks is refused.**
- **Cant stays as the adjoining elements unless a transition ramps it.**

## Tests

A test file beside each command (`tracks`, `switches`, `sCurve`, `connectSwitch`, `connectCrossing`,
`connectRemedies`, `splice`, `reconnect`, `editGeometry`, `optimizeApply`); `splice.test.js` and
`reconnect.test.js` use real answers of the service from `src/core/test/fixtures/`.

## Element roles in the track editor (decision 375)

The element table changes only what an element's role allows (`elementRoles`). A **Festelement** (no `role`)
keeps length and radius. From the first element stating `role: 'follow'` on, every element is a
**Folgeelement**: length and radius are typed, each element starts where the one before ends and
`planElementChange` carries the change down the chain as before. A **Zwischenelement** (`role:
'intermediate'`, an arc or a straight, not in a switch) has a span — the nearest element on each side that is
not a transition (`intermediateSpan`) — whose elements follow it. Its radius is typed and
`planIntermediateChange` lays the span anew: the element before keeps its start, direction and radius, the
one after keeps its end, end direction and radius, the transitions between keep their lengths (the one
joining the Zwischenelement runs into the new radius), and the three lengths that close the chain are found
by Newton's method on end position and end bearing. Nothing outside the span moves; heights behind it move
on with the new length, those on it are spread over it. A radius no chain closes with is refused. Only the
element the user set states its role (`withRole`); a Folgeelement drops the roles after it.
