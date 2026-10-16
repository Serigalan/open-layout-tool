# crossSection — the track seen across

`src/core/utils/crossSection/` · needs `geometry`, `track`, `common`

The cross section of a track at a station: the running plane turned by the cant, the superstructure under
it (rails, sleepers, planum edge) and the clearance contour over it, plus what the section line crosses —
neighbouring tracks, platforms, the terrain. Used by the cross-section overlay, the platform height, the
clearance checks against point clouds (`pointCloud`), rail detection, the turnout plane (`elevation`) and
the track-spacing rule of the optimizer service.

## Files

| File | What it does |
|---|---|
| `crossSectionUtils.js` | The section at a station: cant angle and pivot, superstructure by station, rail and sleeper profiles, neighbouring tracks and platforms on the section line, fitting the drawing |
| `gaugeProfiles.js` | The clearance contours of DB Ril 800.0130 A01 (`src/core/constraints/db-ril-800-0130.json`): outline and intrusion areas, mirrored into closed rings |

## The frame

All in millimetres of the track's own frame: `y` across the track from its centre, positive to the right
seen in the running direction; `z` up from the **top of the rail that is not raised** — the rail the
gradient states the height of. The cant lifts the other rail (in a curve the outer one), so the section
turns about the inner rail:

```
sin θ = u / 1500          (1500 mm = distance of the running circles; track gauge 1435 mm)
```

A positive cant raises the left rail (negative y), so the section turns clockwise and θ is negative. Inside a
transition the cant is interpolated linearly between its ends — the ramp is straight in this model.

Nothing of a section is stored: it is derived from what the track and its elements carry — cant, radius,
superstructure — so it cannot disagree with the alignment. Neighbouring tracks and the terrain are found
where the section is drawn.

## Superstructure

A track carries rails and sleepers as **stretches along the track** (`track.rails`, `track.sleepers`, each
`[{ type, from, to }]` in metres from BEGIN), not per element: a rail profile changes at a station, and tying
it to element ends would put a joint wherever the alignment has one. Without a statement a track is
54 E4 on B70 from begin to end; only an adjustment is written down, and a later range wins over an earlier
one.

Rail profiles after DIN EN 13674-1 (figures from the Dlubal catalogue): 49 E5, 54 E4, 60 E2, with their
former names in brackets ("54 E4 (S 54)") because the MDB stock data and old drawings use them. Each states
the new and the least worn dimensions (a 54 E4 head may be 44.2–55 mm high). Sleepers: B70, B90 and
switch sleepers.

## Clearance contours

A profile is a half outline `[y, z]` from the track centre outwards plus the areas inside it that structures
may reach into (platforms, signals/masts, tunnels); the other half is the mirror image, built where a closed
ring is needed, so a contour is stated once and cannot become asymmetric by a typing slip. A profile is
chosen **per project** (`project.gaugeProfile`, in the project settings) — the Ril's main-track and
secondary-track profiles, and for S-Bahn lines two profiles: "S-Bahn" (outline 2400, intrusion for signals or
masts up to 2100) and "S-Bahn tunnel" (outline 1900, no such intrusion) — as one profile with three
intrusions a wall at 2000 mm would have counted as an allowed intrusion on open line too. Everything that
reads a profile knows only "an outline and its areas", so a new profile is a catalogue entry.

## What the section shows

- **Other tracks** whose axis the section line crosses, with their platforms; a track without heights is
  drawn at the reference height, pale, labelled "no gradient".
- **Platforms** stated over top of rail (`height`) at their edge distance.
- **Terrain** from the chosen source (`elevation`). The drawing is fitted to tracks, platforms and planum
  edges; the terrain is cut off rather than fitted (a six-metre embankment would shrink the track to a few
  pixels). The width searched for neighbours is adjustable.
- On a **route** the section looks in the route's running direction and is mirrored where the route runs a
  track backwards.

## Decisions

- **Rotation about the unraised rail**; heights refer to it.
- **Superstructure by station ranges**, defaults not written.
- **Contours stated once and mirrored**; one profile per project; two S-Bahn profiles.
- **The rounded gradient is shown**, not the tangent polygon.

## Tests

`crossSectionUtils.test.js`, `gaugeProfiles.test.js`.
