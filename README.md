# Open Layout Tool

An interactive web application for designing railway track layouts on a map — running at
[open-layout-tool.org](https://open-layout-tool.org/).

## Features

- **Interactive map** with multiple basemaps (OpenStreetMap, Elevation, Satellite) based on MapLibre
- **DB kilometrage overlays** — the German rail network's kilometrage lines as reference layers,
  with hectometre points and kilometrage jumps marked, and the exact kilometre read off wherever
  the cursor is near a line; one overlay for the current DB InfraGO network, one for lines outside
  it (closed, or handed over to other infrastructure managers)
- **Create track elements** — straight lines and curved lines
- **Connect elements** to other elements using curved or straight elements, as well as transition
  curves
- **Connect switches** to form the foundation of a train station or whatever the requirements may
  be, including switch connections between two tracks
- **Splice elements** where straight tracks are already in place
- **Edit elements** — modify geometry, elements and switches
- **Platforms** — pick a track and two points on it; the platform edges follow the track at 1.67 m
  (front edge) and 4.67 m (back edge) from the axis, on either side
- **Line and track names** — a new DB line track takes the number of the line it lies on, that
  line's name (from OpenStreetMap/OpenRailwayMap), and a name from the kilometrage of its middle
- **Plan export** — scaled site plans (1:500 / 1:1000) as PDF or SVG, with main points, stationing,
  element labels, switch symbols, kilometrage, a title block and an optional map backdrop
- **Data exchange** — import/export full projects or selected tracks as JSON, import Verm.ESN and
  Gleislage-CSV surveying data, export to [OSRD](https://osrd.fr) format, and share projects
  through a small server store
- **Project management** — create, open, and delete projects; data persists locally in the browser

## Getting Started

```bash
npm install
npm run dev
```

The dev server runs over https (a self-signed certificate, which the browser will warn about once)
— some of the Landesvermessung basemaps only answer CORS requests over https.

```bash
npm run build      # production build into dist/
npm run preview    # serve that build locally
```