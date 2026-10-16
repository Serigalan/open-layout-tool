# Server parts

The main build adds to the browser app everything that needs a server: sign-in, projects with variants and
revisions, the working copy, the Python service's computations, point clouds on the server and their 3D view.
Three places hold it:

| Where | What | Runs |
|---|---|---|
| `src/server/` | the browser parts that talk to a server | in the browser, main build only |
| `tools/server/` | the project server `olt-server` and the job runner `olt-cloudjobs` | Node 22, SQLite |
| `tools/optimizer/` | the Python service `olt-optimizer` | Python 3.10+ |

Operation (setup, deploy, backups, several instances, production releases) is described in
[`deploy/README.md`](../deploy/README.md).

## Architecture rule

**Edited and computed in the browser wherever it works without a server; the server stores, versions and checks.**
No computation is held twice: where Python computes, there is no JavaScript copy (the splice is the one exception —
see [splice](modules/splice.md) — held together by a fixture in CI), and the Node server runs the browser's own
JavaScript for parsing, validation and point-cloud jobs. A panel that needs the server says so when it is not
there instead of silently doing nothing.

| In the browser | On the server |
|---|---|
| creating and editing tracks, elements, switches, crossings, heights, platforms, cross sections | optimizing a track, reconnecting, alignment fit from axis points, splice with track spacing (Python) |
| joining two tracks (splice), rule checks, plan/OSRD/exchange/Verm.ESN export | MDB conversion, DGM1 terrain (Python) |
| merging and resolving conflicts | sign-in, projects, variants, revisions, images, members (Node) |
| point clouds read on this device | checking every revision; preparing uploaded clouds, long runs over them (Node) |

## `src/server` — browser parts of the main build

`src/server` may import from `src/core`, never the other way round. It docks onto core through the extension
points of `core/extensions.js`, filled by `src/server/register.js` — the first import of `main.jsx`, before
anything renders:

| Extension point | Filled with |
|---|---|
| `panelTools` | Reconnect (splice panel); optimize track, optimize element, alignment fit (check panel) — each a lazy chunk |
| `importSections` | MDB import and MDB import into DB_REF |
| `sidebarFoot` | service status (are project server and Python service there?) |
| `terrainSources` | the Länder's DGM1 via the Python service |
| `cloudProviders`, `useCloudServer`, `useServerRun`, `useCloudRegistration`, `crossSectionTools`, `workspaceAddons` | point clouds on the server, long runs, re-referencing, the 3D window link |
| `regelwerkService` | the rule catalogues as the service has them (with drift check) |
| `spliceWithClearance` | splice with a spacing to a neighbouring track, computed by the service |
| `saveProjectMeta` | title and description written to the server's project list too |
| `localStoreSections` | the working copies in the storage dialog |

Main pieces:

- `App.jsx`, `home/` — sign-in, start page with projects and their variant trees (status, last revision, local
  changes), new project, branch variant, compare, merge, export, members, templates; `collab/` — check-in and
  conflict dialogs, history page, user administration.
- `workingCopies.js`, `workingCopyDb.js` — the working copy of a variant in IndexedDB (`olt` › `workingCopies`):
  the record being edited, the revision it rests on and that revision's record.
- `workingCopySync.js`, `useWorkingCopy.js` — opening a variant, local changes (diff against the base), check-in,
  update; the app polls whether the head moved on.
- `variantMerge.js` — merging one variant into another against their youngest common revision.
- `optimizerService.js` — the client of the Python service; every failure is named so the panel can say it.
- `panels/` — optimize, alignment fit, reconnect, MDB import; `mdb/` — the MDB import job and its worker.
- `cloud3d/` — the 3D window (`#/cloud3d`, its own bundle with three.js), re-referencing, share links.

### Check-in and merge

The server **never merges** and takes a revision only **on top of the current head** of a variant (otherwise
`409`). Checking in on a stale base comes back as stale; the browser merges the head into the working copy against
their common base (`utils/merge`), shows the conflicts, the user decides, the result is adopted and checked in
again — so nothing is stored that no user has seen. Merging variants works the same way, with the source's head as
second parent. The working copy must be checked in before a variant is merged into it.

### The 3D window

A window of its own (`#/cloud3d?…`) with three.js, loaded only there. It shows the project's server clouds in
their known systems, drawn relative to a rounded centre in the plane of most tracks; levels of detail replace a
tile by its finer ones while a voxel covers more than a pixel and the visible children fit a point budget;
colour by height spans the 2nd–98th percentile (a crane would flatten the scale). Points are picked on the GPU
and refined to the nearest original point within 10 cm. Tracks, routes and the cross-section station come from
the main window over a `BroadcastChannel`, including unsaved changes; without a main window from the checked-in
head. A walk along a track (eye 2.5 m over top of rail, W/S/A/D/R/F) can be shared as a link. Re-referencing
(see [pointCloud](modules/pointCloud.md)) is done here.

## `tools/server` — the project server

Fastify on Node 22, SQLite in WAL mode behind a thin access layer (Postgres only if ever several instances or
spatial queries on the server are needed). It imports the browser modules from `src/` unchanged through a module
hook (`src/esmHook.mjs`: extensionless imports, JSON imports, `import.meta.env` and `import.meta.glob` stubbed) — no
build step, no second implementation.

**Data** (`migrations/`, applied in order on start):

| Table | Content |
|---|---|
| `user`, `session` | users (admin or user, deactivated instead of deleted — revisions keep their author; right "edit point clouds"), sessions by token hash |
| `project`, `project_member` | projects (soft-deleted; templates open to all), members besides the creator |
| `variant` | named states with parent variant and head revision |
| `revision` | immutable: parent(s), author, time, message, `schema_version`, the whole dehydrated record gzip-compressed, the id log, the keys of the validation errors it already had, the image hash |
| `blob` | images by SHA-256 |
| `point_cloud`, `cloud_job`, `point_cloud_transform`, `cloud_run`, `share_link` | clouds and their preparation queue, re-referencings with history, long runs, read-only share links |

**API** under `/api/` on the app's own origin (no CORS): login/logout/me/password; projects (list, create,
patch, delete, members); variants (create, rename/archive, head, revisions); revisions (get, check in, remaps,
merge base); blobs (`PUT /blobs` not tied to a project, so a new project brings its picture); clouds (create,
upload raw chunks, complete, retry, index, tiles, collective range requests, transforms); runs; shares; admin
(users, clouds); `GET /api/health` without a session.

**Every check-in is checked** with the browser's own `parseProjectsPayload` and `validateProject`; only errors that
are new against the base revision are refused. Revisions of an older format are answered with
`409 format_outdated`. Measured axes may only change with the cloud right — compared against base and merge parent
with sorted keys, so a merge brings the other side's axes without the right.

**Access.** Only an admin creates users; passwords of at least 12 characters hashed with argon2id; sessions as
httpOnly, SameSite=Strict cookies idle-expiring after 30 days; login attempts braked after five failures. A project
is visible to its creator, its members and the admins; anyone else gets `404`, not `403` — the existence of a
foreign project is not revealed. Requests must be JSON (CSRF protection); raw cloud chunks are the one exception and
need a custom header no foreign page can send without a preflight. Membership for tile requests is cached 60 s.

**Point clouds.** Uploads come in 8 MB chunks, each with its SHA-256 checked before it is written; the whole file is
hashed at the end. `olt-cloudjobs` prepares a cloud into its five levels in one pass (one process per job, 768 MB
heap; a job interrupted by a restart is queued again, not failed), deletes the raw file unless asked to keep it,
and runs the long clearance scans and traces in a queue of their own (two at a time, 320 MB heap each). Tiles are
served by `olt-server` with range requests and collective requests of up to 64 ranges, membership checked per
request — not by Caddy's file server, whose forward-auth only checks the sign-in, not the project.

## `tools/optimizer` — the Python service

A small HTTP service (`service.py`) around the package `olt_optimizer`, behind the sign-in under `/optimizer/`:

| Endpoint | What it does |
|---|---|
| `POST /optimize` | Optimizes a track or an element: maximizes the bottleneck speed `v = √(R·(u + u_f)/11.8)` over radii, cant and the lateral shift of intermediate straights within a corridor to the existing axis; differential evolution with Nelder–Mead polish, warm-started from the per-curve baseline; every rule of the catalogue as a constraint at the chosen level (Regelwert or Ermessensgrenze) |
| `POST /splice` | The splice — with a spacing to a neighbouring track (`clearance.py`): the largest radius that keeps the track spacing plus the widening from cant (both clearance outlines tilted by their cant about the lower rail) |
| `POST /reconnect` | Reconnect existing elements: the splice construction nearest the old axis (`reconnect.py`) |
| `POST /align` | Alignment and gradient fit from axis points (`alignment_fit.py`, `gradient_fit.py`) |
| `POST /mdb` | Converts an Access file (via mdbtools) into its Satzarten as JSON |
| `POST /terrain` | DGM1 heights of the Länder that publish fixed-URL tiles (`terrain.py`) |
| `GET /health`, `GET /regelwerke`, `GET /regelwerke/<id>` | Status; the catalogues a run can be held to, with the catalogue hash for the drift check |

The service reads the **same rule catalogue** as the app (`src/core/constraints`, through a symlink in the package)
and evaluates it with a Python port of the expression language; a rule it cannot place makes it refuse, not skip.
`physics.json` is the readable derivation its constants are checked against. Acceptance tests in `tests/`
(`verify*.py`, shared vectors, the splice answers fixture) run in CI.

## Decisions

- **Login for everything server-side**; the app files and NTv2 grids stay public (the sign-in page needs them),
  `/api`, `/optimizer` and the km data are behind the session.
- **Node for the project server** so parsing and validation are the browser's code; **SQLite** until it no longer
  suffices.
- **The browser merges, the server only appends on the head** and checks.
- **Members per project; 404 for the unauthorised.**
- **Point clouds: shared per project on the server, chunked uploads with hashes, served with membership checks.**
- **One Python service** for what is Python, reached over HTTP, not a CLI.
