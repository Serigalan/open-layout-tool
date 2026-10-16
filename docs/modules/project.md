# project — the record as a whole

`src/core/utils/project/` · needs `geometry`, `track`, `switch`, `survey`

The project record as one thing: its format oltjson-1.0 (the door every payload passes, hydration on load,
dehydration on save), the project settings (coordinate system, line category), the validation every merge
result and every server revision must pass, and the short description of what one undo step did. The format
itself — every field, and why it is shaped as it is — is described in [the data format](../data-format.md).

## Files

| File | What it does |
|---|---|
| `persistenceUtils.js` | oltjson-1.0: `projectsPayload`, `parseProjectsPayload` (the door), `hydrateProjects` (derive on load), `dehydrateProjects` (strip and round on save), `parseTracksPayload` (track files) |
| `projectSettings.js` | The project's coordinate system and line category; moving tracks into another plane with everything a switch joins to them |
| `validateProject.js` | Whether a record holds together: errors and warnings, stably keyed; `newFindings` |
| `stepLabel.js` | What one step did, in a few words, worked out from the two states |

## Load, save, refuse

`parseProjectsPayload` is **the one place that decides** whether a payload is taken: it must say
`format: 'oltjson'`, `version: '1.0'`, hold `projects`, every switch must be a modelled record (`switchId`,
`kind`, `formVersion`, `ports` an object of port objects) and every switch-marked element must carry its
switch's id. Anything else is refused with `unsupported_version` or `invalid_payload` — **never converted**.
Everything behind the door may take the model for granted instead of guarding each field.

`hydrateProjects` rebuilds what is derived, in place: element polylines and render coordinates, the end bearing
of arcs and transitions where the record leaves it to them, track coordinates, switch symbols and platform
polygons — from the plane data only. Nothing is converted or repaired there.

`dehydrateProjects` strips all of that again and rounds numbers to what they mean: positions, lengths, radii
and stations to 1 µm, heights to 0.1 mm, angles to 10⁻⁹°, cant to 0.001 mm; an end bearing that agrees with
the derived one (within 10⁻⁷°) is dropped.

## Project settings

**Coordinate system.** The project names a *system* — a datum with its projection, e.g. DB_REF /
Gauß-Krüger or ETRS89 / UTM — not one plane. The meridian strip stays each track's own (`track.epsg`). A new
track is laid out in the project's system, in the strip whose central meridian is nearest its first click;
existing tracks keep their plane, and one in another *system* is shown as deviating. Without a setting the
system is that of most tracks; without tracks the UTM zone of the first click. An import sets the system to
that of most tracks **only where the project names none**, so a deliberate choice survives an import.

**Moving tracks to another plane** (another strip or system) recalculates them (`geometry/planeTransform`:
nodes exact, lengths and radii scaled, heights and platforms re-stationed, switch symbols rebuilt) **together
with every track a turnout or crossing binds to them** — a switch lies in one plane. Links do not bind; they
exist for tracks in two planes. A dialog first lists the tracks that go along and the cost; an element without
nodes blocks.

**Line category** (main line, secondary line, S-Bahn) is set only in the project settings: the project's, and
per track through "own line category", which copies the project's current one as the track's own. It decides
which Höhenplan limits apply.

Also in the settings (stored on the project): title, description, and the clearance profile (`gaugeProfile`,
one per project). Language and colour are user settings, not project settings.

## Validation

`validateProject(record)` is pure and works on the plane data alone, so browser and server run the same code
on a hydrated or a dehydrated record. It returns `{ errors, warnings }`, each finding
`{ code, key, collection, id, label?, params }` with a stable `key` (code and ids), so two states can be
compared for what is **new** in one of them (`newFindings`). It checks:

- every switch port names an existing track end, and no end is held twice; every element's `switchId` exists;
- platform and height stations lie within their track's length; end marks stand only at free ends;
- routes, axis surveys and reference axes are well-formed;
- the element chains (`geometry/chainChecks`): node gaps from 1 cm are warnings and an **error only from
  0.5 m** — imported track has real kinks and gaps (the PEK data set one of 9 cm); untrue lengths are
  warnings;
- tracks drawn twice (closer than 0.5 m over more than 10 m, not at the same switch, and at a shared end only
  beyond half the shorter track) are warnings.

**Only new errors block**: new against one's own state in a merge, against the base revision on the server.
An import may bring errors; they are reported.

## What a step did

The undo history names each step ("track 6050.001 changed", "switch.003 added", "project settings changed")
by comparing the two states rather than having every writer say it: the store is immutable, so whatever kept
its object did not change.

## Decisions

- **One format everywhere; older data refused, not converted.**
- **The derived is rebuilt on every load and never stored.**
- **The project names a system, the track its strip**; imports set the system only where none is named.
- **Plane changes take a switch's tracks along.**
- **Validation is shared by browser and server; only new errors block.**

## Tests

`persistenceUtils.test.js`, `projectSettings.test.js`, `validateProject.test.js`, `stepLabel.test.js`.
