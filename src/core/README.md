# src/core — browser components

Everything that computes and stores in the browser alone: the project store,
the map, every panel that works without a server, the point clouds in OPFS,
the plan export. Runs on its own — the local build (`npm run build:local`)
ships nothing else.

**`core` never imports from `src/server`** (decision 277). Where a server part
has to appear in the app, `core` offers an extension point (`core/extensions.js`)
and `src/server/register.js` fills it.
