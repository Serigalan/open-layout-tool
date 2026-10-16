# common — small helpers

`src/core/utils/common/` · depends on nothing else in `utils`

Helpers without a railway in them, shared by modules and interface alike.

| File | What it does |
|---|---|
| `format.js` | `clamp`, number formatting (decimals, decimal comma, trimmed zeros) |
| `fileUtils.js` | Downloading a blob/text/JSON, reading a chosen file as text or bytes |
| `keyboard.js` | Which shortcuts belong to the app: Ctrl/Cmd+Z undoes the project step only outside a typing field (inside, the field keeps its own undo); Ctrl+Y / Ctrl+Shift+Z redo; where Escape belongs to a field |
| `settings.js` | The user's own settings (language, colour, layers, terrain source, …) — per browser in `localStorage` (`olt_settings`), **never part of a project** |
| `chartAxes.js` | Axis steps and ticks of the drawing overlays (bands, profiles) that keep labels apart |
| `svgPath.js` | SVG path data reduced to absolute `M L C Z` for the plan backends (arcs and quadratics become cubics) |
| `logoMark.js`, `logoImage.js` | The app's mark (one track writing O, L and T) and converting an image file into a bounded PNG data URL for title blocks |
| `projectImages.js` | The pictures a new project can start with (country outlines and pictograms under `public/project-images/`); a chosen one is uploaded and referenced by hash like any other |
| `mapTiler.js` | The MapTiler key for satellite and terrain tiles (`VITE_MAPTILER_KEY` overrides it at build time) |

**Why user settings are not project data.** Language, colour and the terrain source are how one person works,
not part of a design; in the record they would ride through every revision and conflict between users.
