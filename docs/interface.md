# The interface layer

Everything in `src/core` that is not a computing module: the store, the map, the shell with its panels and
overlays, the hooks that connect React to the store, translations, styles and the local start page. The
server build adds its own pages and panels from `src/server` (see [server](server.md)).

```
src/core/
  storage.js        the project store: the one open project, undo/redo, write-behind
  extensions.js     extension points the server build fills
  localStore.js     what this browser keeps for the app (storage dialog)
  basemaps.js       basemap styles (OSM, aerial, elevation, Liberty, WMS of the Länder)
  hooks/            React access to the store and to shared field logic
  map/              the MapLibre map: instance, project layers, picking, previews, km and topology layers
  shell/            the map workspace: sidebar, panel register, overlay rules, step notice
  components/       panels (sidebar), overlays (over the map), forms, charts, icons
  home/             the local build's start page and project list
  locales/          de.json, en.json and the i18n context
  styles/           CSS by area, design tokens, palette
  constraints/      the rulebooks as JSON (read by modules and by the optimizer service)
  utils/            the computing modules (see the module pages)
  test/             shared test helpers, invariants, fixtures, architecture tests
```

## The store (`storage.js`)

The one open project is held in memory as the **single source of truth** for every synchronous caller. All
writes go through the store's functions (`saveTrack`, `deleteElements`, `commitSwitchConnection`,
`commitImport`, `setHeightsForTracks`, `updateProject`, …), each one undo step.

- **Immutable record.** Every write makes a new project object and new arrays for what it changes and shares
  the rest. An undo snapshot is therefore just a reference, React can subscribe cheaply, and in development and
  tests the record is deep-frozen so an in-place change fails at once instead of corrupting history.
- **One place for consequences.** After every write the store repairs routes over changed tracks, drops end
  marks whose end is no longer free, recomputes length-governed vertical curves and couples the heights of every
  turnout the write reached — all in the same undo step, so no writer has to remember them.
- **Undo/redo** keep 20 steps; `withUndo` turns several writes into one step (a switch committed piece by piece
  is one Ctrl+Z). The history panel lists the steps by what they did (`project/stepLabel.js`) and jumps several
  at once. The plan header is not part of undo.
- **Id log.** Splits and joins append `{ from, to: [ids] }`; checking in sends it so a merge can carry the
  other side's references.
- **Where the project is kept** is the opener's business (`openStoredProject({ project, meta, key, save })`):
  the working copy of a variant in the server build, a project of the browser's list in the local build, or
  memory only. Writes are dehydrated and written behind once a burst has come to rest; leaving the page or
  closing the project flushes at once.

React reads the store through `hooks/useStore.js` (`useSyncExternalStore`): `useProject`, `useTracks`,
`useSwitches`, … each return a part that keeps its identity until something changes it, so a component reading
switches is not re-rendered by a height edit.

## The shell

`shell/MapWorkspace.jsx` is the map view of an open project: the map, the sidebar, the open panel, the map
overlay and popups, the step notice.

**Panels** (`shell/panels.js`) are one register, in the order of the work: project settings; layers and
topology (view); create, join two tracks, switches (design); edit; heights; cross sections; check; data exchange;
plan; settings at the foot; history (opened from between the undo/redo arrows). The sidebar and the panel pane
are both made from this list; each panel is a lazily loaded chunk, may bring an overlay that closes with it, and
gets what it needs from the shell through `props(s)`. Server tools appear inside panels through the
`panelTools` extension point.

**Overlays** (`shell/overlays.js`): at most one map overlay and one popup at a time. The overlay belongs to the
open panel — element table (edit), height profile (heights), cross section, bands (check), topology diagram,
plan preview, project tracks — and closes when the panel changes; popups (physics, rulebooks) belong to no panel
and replace each other. An overlay can be **detached** into its own browser window (the cross section): it stays
part of the same React tree through a portal, reads the same store, and outlives panel changes.

**Step notice** (`shell/StepNotice.jsx`): what the last step did, said once over the map ("Track 6340.12393
created") with the way back, and the tracks it touched lit for a moment.

**Hints** stand behind an ⓘ next to the heading, section or field they explain; visible text is kept to what to
do now, states, counts, results, warnings and errors.

## The map (`map/`)

MapLibre with the basemaps of `basemaps.js`. `trackLayers.js` draws the project from the record — one source per
kind (tracks, switch bodies, platforms, buffer stops, markers, labels); the first call adds sources and layers,
later ones only replace data. Tracks hidden on this device are left out with what only they carry. GeoJSON
sources are tiled at zoom 22 (~1.5 mm grid) instead of MapLibre's default 18 (~2.4 cm). Highlight colours keep a
minimum colour distance from the project colour the user picked. Element end markers are signed-distance-field
icons, sharp at any size and angle. `pick.js` answers what lies under a point; panels add preview layers with
`usePreview` that disappear when they unmount. `kmLineLayer.js` draws the kilometrage overlays, `topologyLayer.js`
the topology view. Every effect checks that the map it captured is still the map (leaving to the start page
removes it before effect cleanups run).

## Components

- `components/panels/` — one folder or file per panel; forms gather input, show previews, findings and
  remedies, and call a command (`utils/commands`) on "apply". `form/` holds shared form parts (number input,
  station slider, switch orientation picker, rule-field markers, commit bar, info tip).
- Overlays: `TrackTableOverlay` (element table with live rule column; edits a working copy of every track a
  change reaches and writes it back on Save), `ElevationOverlay` + `ElevationTable` (graphic and table view of the
  height profile, with the coupling roles from `elevation`), `CrossSectionOverlay`, `BandsOverlay` (curvature,
  cant, speed, rule findings), `TopologyGraphOverlay`, `PlanPreviewOverlay`, `ProjectTracksOverlay`,
  `RegelwerkOverlay` / `PhysicsOverlay` (read-only rulebooks), `collab/CompareOverlay` (two states on the map).
- `icons.jsx` — all symbols on a 20 px grid; `chart/` — the curvature diagram and deviation band.

## Languages and styles

All texts come from `locales/de.json` and `en.json` through `t(key)`, `fill(key, params)` with single-brace
placeholders and `num(value, { digits, unit })`; tests check that both files have the same keys and placeholders
and `tools/i18n-unused.mjs` (in CI) that no key is unused. Default language English; the choice is a user setting.
Styles are plain CSS per area with tokens in `tokens.css`; no colour literal in a component (architecture test),
and few inline styles.

## The local start page (`home/`)

The local build opens on `LocalStartPage`: the projects of this browser (IndexedDB `olt-local`) with picture,
counts and date; new, open, rename, export, import (fresh ids, so importing twice gives two projects), delete
(with the local point clouds). No sign-in: one local user with all rights. If the browser refuses persistent
storage, the page says so. `localStore.js` lists and clears what the browser keeps (OPFS clouds, settings,
import reports, hidden tracks, project databases).

## Decisions

- **One store, immutable, the only writer**; consequences (couplings, repairs) applied in the store.
- **Panels from one register, overlays by one set of rules.**
- **Detachable overlays share the store** through portals.
- **Texts only through keys**, both languages complete.
