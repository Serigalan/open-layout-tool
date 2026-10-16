# plan — the plan export

`src/core/utils/plan/` · needs `geometry`, `track`, `switch`, `km`, `rules`, `common`

Scaled site plans (Lagepläne) at 1:500 or 1:1000 and a schematic overview, as PDF or SVG, on long strip
sheets with a DB-style title block. The module turns a project and the dialog's settings into a **plan
model** — a list of four kinds of drawing primitive per sheet, in page millimetres — and two backends draw
that model; the preview in the app shows the SVG, so it shows exactly what is printed.

## Files

| File | What it does |
|---|---|
| `planAssemble.js` | From dialog settings and project to the plan model: layout, title block fields, backdrop |
| `planExport.js` | The sheet: paper formats, scales, frame, the transform from track plane to page millimetres |
| `planLayout.js` | Where the sheets sit and how they are turned: along a lead track, cut by its stationing with overlap |
| `planGeometry.js` | Everything a plan draws, in the track plane: paths, main points, station marks, switch symbols |
| `planModel.js` | The plan as primitives per sheet |
| `planItems.js` | Drawing primitives and text metrics: pens, type sizes, text boxes, culling |
| `planTrackItems.js` | What a sheet shows of the tracks: lines, labels, stations, switches, kilometrage, main points, buffer stops |
| `planSheet.js` | Sheet furniture: frame, fold mark (DIN 824), scale bar, north arrow |
| `planTitleBlock.js`, `planLogo.js`, `planSketch.js`, `planHeader.js` | Title blocks (compact and full DB template), wordmark, location sketch, editable header fields |
| `planSchematic.js`, `planSchematicPlan.js` | The network as a schematic strip along a reference axis, and that strip as sheets |
| `rasterBasemap.js` | A MapLibre style rendered north-up offscreen and warped onto the sheet as backdrop |
| `planPdf.js`, `planSvg.js` | The two backends |

## The model

A sheet is a list of primitives in page millimetres (x right, y down, origin top left):

```
{ type: 'path',  d, stroke, width, dash, fill, opacity }
{ type: 'text',  x, y, angle, size, align, parts: [{ t, sub, color }], color, prio, path, marks? }
{ type: 'image', dataUrl, x, y, w, h, opacity }        (backdrop, logo)
{ type: 'group', clip: { x, y, w, h }, items }          (clipped areas)
```

A text with a `path` is set along that page polyline, so a label on a curve bends with it — SVG with a real
`<textPath>`, the PDF backend by placing the glyphs itself (PDF has no such operator).

A backend translates only these, so the same plan goes into PDF or SVG without either knowing anything about
railways. Paths use only absolute `M L C Z`, so shapes drawn elsewhere (a logo, a symbol) reach both backends
(`common/svgPath.js` normalizes them). Two conventions to keep straight: jsPDF's `lines()` takes deltas and
its font sizes are points while the page is in millimetres; and the model's `angle` is counter-clockwise
positive (jsPDF), SVG's `rotate()` clockwise. The SVG states its physical size, so it opens at true scale in a
drawing program.

## How a plan is laid out

- **Plane data, not display geometry.** A plan draws from the design values in the track's own plane, at
  drawing resolution — never from the WGS84 polylines of the map.
- **Sheets follow the track, not the compass.** A lead track gives every sheet its centre and rotation; a long
  alignment is cut into sheets along that track's stationing with an overlap, so the join is recognisable on
  both sides.
- **Formats** are long strips 297 × 840, 1260 or 1920 mm; scales 1:500 (2 mm/m) and 1:1000 (1 mm/m); 20 mm
  filing margin, 5 mm elsewhere; a 180 mm column on the right is headed by the title block and the legend.
- **Status colours**: existing black, new red, removal yellow — as a DB drawing reads them.
- **What is drawn**: track axes, element boundaries and main points with stations, design values per element
  (separated by a spaced pipe — in Helvetica "| l =" would otherwise read as "l l ="), switch symbols with
  designation, kilometrage from the km lines, platforms, buffer stops, justified cant exceptions and justified
  gradient changes. Labels are culled where they collide, by priority.
- **Backdrop**: a plain map (OpenFreeMap Positron) by default, or an aerial one faded further; rendered by
  MapLibre offscreen north-up and warped onto the rotated sheet.
- **Title block**: compact or the full DB template; parties left to right with signature lines, project
  image and logo (any image the browser can show is converted to a bounded PNG), a location sketch of the
  whole network with the sheet's part marked (one point every 100 m). The header is a field of the project
  record (`planHeader`), versioned with the variant.

## Schematic overview

The track network as a strip: the lines of the layout become horizontal lanes along one reference axis, every
switch joining two lanes a 45° connection. Only the length along the axis is to scale — read by projecting
every track onto the reference within a corridor — so a switch sits where it sits in reality; which lane a
track takes follows from which side of the reference it lies on. The strip is cut into sheets along the
kilometrage and drawn with the same primitives and furniture as the site plan.

## Decisions

- **One model, two backends; the preview is the SVG.**
- **Plans from plane data at drawing resolution.**
- **Sheets along a lead track with overlap.**
- **Colours from the planning status** of tracks and switches.

## Tests

`planAssemble.test.js` (the whole model from a project, sheets and texts), `planSchematic.test.js`,
`planSchematicPlan.test.js`, `planTitleBlock.test.js`; `src/core/test/schematicFixture.js`.
