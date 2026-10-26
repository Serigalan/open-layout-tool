# Architecture

## The whole

```
                     ┌──────────────────────────── browser ────────────────────────────┐
                     │                                                                 │
  main build ──────▶ │  src/server   sign-in, variants, working copy, service clients, │──▶ olt-server (Node, SQLite)
  (npm run build)    │      │        3D window, server panels                          │      /api
                     │      ▼ imports, never the other way round                      │
  local build ─────▶ │  src/core     store · shell · panels · overlays · map · hooks   │──▶ olt-optimizer (Python)
  (npm run           │      │                                                          │      /optimizer
   build:local)      │      ▼                                                          │
                     │  src/core/utils   computing modules (no React, no store)        │
                     └─────────────────────────────────────────────────────────────────┘
```

- **`src/core`** — everything that computes and stores in the browser alone. The local build ships only this.
- **`src/server`** — what needs the project server or the Python service. The main build ships both.
- **`tools/server`**, **`tools/optimizer`** — the two services ([server](server.md)); **`deploy/`** — operation.

Two builds from one codebase: `vite build` (entry `src/main.jsx`, core + server → `dist/`) and
`vite build --mode standalone` (entry `src/main.local.jsx`, core alone → `dist-local/`, served by
`tools/local/serve.mjs` or packed as a zip). `tools/check-local-bundle.mjs` asserts the local bundle contains no
server part.

## Layers and their rules

| Rule | Held by |
|---|---|
| `src/core` never imports from `src/server`, not even indirectly. Server parts appear in core only through the extension points of `core/extensions.js`, filled by `src/server/register.js` before the first render. | ESLint rule, `tools/boundary.mjs --core`, architecture test |
| The local entry imports nothing of `src/server`; the main entry docks the server on before anything else. | architecture test |
| Code outside a module of `src/core/utils` imports from its `index.js` and nowhere else. | `tools/modules.mjs`, architecture test |
| The modules depend on each other without a cycle. | `tools/modules.mjs` |
| A module imports nothing of the interface (components, map, shell, hooks, store) — only the extension points, translations, palette, basemaps and rulebooks. | `tools/modules.mjs` |
| Every module has a page in `docs/modules/`. | `tools/modules.mjs` |
| No module reads the store. | architecture test |

`npm run check` runs everything CI runs: lint, knip (dead code), unused translations, the boundary, the module
rules, all tests, both builds, and — with a Python environment — the optimizer's tests.

## The computing modules

`src/core/utils` is cut into modules by subject. Each is a directory with an `index.js` (its public interface,
generated from what the rest of the app uses and kept by hand from there) and a page here. In dependency order —
each needs only modules above it:

| Module | Needs | Subject |
|---|---|---|
| [common](modules/common.md) | — | formatting, files, keyboard, user settings, chart axes, SVG paths, logo |
| [geometry](modules/geometry.md) | — | planes and datums, elements, transitions, parallels, plane changes, chain invariants |
| [km](modules/km.md) | geometry | kilometrage lines, line and track names |
| [rules](modules/rules.md) | geometry | rule catalogue DB Ril 800.0110, expression language, alignment checks, cant/speed/length limits |
| [splice](modules/splice.md) | geometry, rules | joining two track ends (port of the service's splice) |
| [track](modules/track.md) | common, geometry, km, rules | tracks, switch records and ports, heights, links, track ends, platforms, routes |
| [crossSection](modules/crossSection.md) | common, geometry, track | cross section, superstructure, clearance contours |
| [switch](modules/switch.md) | geometry, rules, track | switch forms, routes, symbols, crossings, switch connections, deletion |
| [topology](modules/topology.md) | track | connection diagram |
| [commands](modules/commands.md) | crossSection, geometry, rules, switch, track | what the dialogs commit |
| [elevation](modules/elevation.md) | common, crossSection, geometry, rules, switch, track | Höhenplan rules, turnout planes, coupling on request, terrain |
| [plan](modules/plan.md) | common, geometry, km, rules, switch, track | plan export (PDF/SVG) |
| [exchange](modules/exchange.md) | elevation, geometry, rules, switch, track | RailJSON, Verm.ESN, ProVI, CSV, MDB |
| [survey](modules/survey.md) | commands, geometry, track | measured axes, reference axes, shift values, alignment fit |
| [pointCloud](modules/pointCloud.md) | crossSection, elevation, geometry, km, survey, track | point clouds |
| [project](modules/project.md) | geometry, survey, switch, track | the record: format, settings, validation |
| [merge](modules/merge.md) | geometry, project, survey, track | three-way merge, comparison |

`node tools/modules.mjs --order` prints this order from the code.

**Why modules with a facade.** Before, `utils` was some 130 files side by side; what belonged together and what
another part of the app was meant to use could only be read from the imports. Now a module says what it offers
(`index.js`), what it needs is checked to be acyclic, and its page says what it does, how it computes and why.
Within a module files import each other directly; tests may reach inside any module.

**Costs and how they are kept small.** A facade makes an importer load the whole module. The bundler is told
the modules are free of side effects (`vite.config.js`, `treeshake.moduleSideEffects`), so unused re-exports are
dropped from the app and the worker bundles. Under plain Node (the project server) the whole module is loaded,
which is why every module must load without a browser — the ESM hook stubs the one Vite-only construct
(`import.meta.glob`). Worker entry files are never part of an index: a worker is started by URL from a file of its
own module, and a worker only the server build needs lives in `src/server` (the MDB worker).

## Data flow

1. **Start.** The NTv2 base grids are loaded first (hydration converts historic datums), then the store.
2. **Open.** A project record (oltjson-1.1, see [data format](data-format.md)) passes `parseProjectsPayload`, is
   hydrated (display geometry derived) and becomes the store's open project.
3. **Edit.** A panel gathers input, calls a command (`utils/commands`), checks the result against the rules and
   hands it to a store function. The store applies it immutably, applies consequences (turnout height coupling,
   route repair, end-mark pruning, length-governed curves) in the same undo step, notifies subscribers and writes
   the dehydrated record behind to where the project is kept.
4. **Save / share.** Local build: IndexedDB and file export. Main build: the working copy in IndexedDB, checked in
   as a revision; the server validates it with the same code and stores it gzip-compressed.

## Off the main thread

| Worker | Why |
|---|---|
| `utils/splice/spliceWorker.js` | the largest-radius search builds the splice many times (a second or two) |
| `utils/pointCloud/pointCloudWorker.js` | importing gigabytes of LAS/LAZ/E57 into OPFS |
| `src/server/mdb/mdbWorker.js` | building, placing and transforming a whole MDB takes seconds |
| `src/server/cloud3d/tileWorker.js` | decoding and transforming point tiles for the 3D view |

## Conventions

| | |
|---|---|
| Coordinates | `[easting, northing]` in the track's EPSG plane; points in calculations `{ easting, northing, zone }` with `zone` the EPSG code |
| Bearings | degrees from grid north, clockwise (exchange formats: gon) |
| Radii | signed, positive = right-hand curve; `null` = straight; curvature κ = −1/R where an integrator needs it |
| Cant | mm, signed by the raised rail (positive raises the left rail); on arcs; transitions ramp linearly |
| Stations | m from a track's BEGIN; never stored on elements |
| Heights | m, top of the unraised rail, kept to 0.1 mm |
| Speeds | km/h in 5 km/h steps; 0 = unknown |
| Track ends | `BEGIN` (first element's start node), `END` (last element's end node) |
| Texts | always through translation keys; comments in English; decisions referenced by their reasons, not by number |

## Testing

- Unit tests next to every module file (`*.test.js`), run by Vitest under Node (no DOM).
- **Chain invariants** (`src/core/test/chainInvariants.js`): every construction that builds or changes element
  chains asserts `expectValidTrack`, `expectSwitchCantAdmissible` and `expectSwitchRoutesCarved`.
- **Shared vectors** between JavaScript and Python: the rule expression language, the alignment check and
  transition lengths (`src/core/constraints/tests/`), and the splice answers (`splice/serviceAnswers.json`).
- **Real data**: MDB, ProVI and point cloud excerpts in `src/core/test/fixtures/`; the PEK Halle–Könnern data set
  where present (tests skip without it).
- **Architecture tests** for layers, modules, colours in components and accessible buttons.
- The project server's API tests run against an in-memory database with `fastify.inject`.
- The optimizer's acceptance tests (`tools/optimizer/tests/`) run in CI.

## Adding something

- A new computation belongs in the module of its subject; if something outside the module needs it, add it to
  that module's `index.js`. If it fits no module, add a directory with an `index.js` and a page in
  `docs/modules/` (the check requires both) and make sure the dependency order stays acyclic.
- What needs the project server or the Python service goes to `src/server` and docks on through an extension
  point; `npm run build:local` must stay green.
- A rule value belongs in the catalogue file, not in code. Whoever changes `splice.py` rewrites the splice
  answers fixture and follows the change in `solveSplice.js`.
- Write the reason for a behaviour into the module page's *Decisions* section.
