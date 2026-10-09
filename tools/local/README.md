# Open Layout Tool — local version

The Open Layout Tool on your own computer: it runs in the browser alone, without a server and without
signing in. Nothing leaves the computer except the map tiles, the terrain heights (DGM5, MapTiler) and
the basemaps, which the browser loads from their providers as in the online version.

## Start

You need [Node.js](https://nodejs.org) 18 or later (only to serve the files; the app itself runs in
the browser).

- **Windows:** double-click `start.cmd`
- **Linux / macOS:** run `./start.sh` in a terminal (or `node serve.mjs`)

Then open **http://localhost:8080/** in Chrome, Edge or Firefox. Another port: `node serve.mjs 8081`.
Opening `app/index.html` straight from the disk does not work — workers, the browser's file system and
ES modules need a web server.

## Where the projects are

In the browser's storage (IndexedDB) on this computer, and nowhere else. The start page lists them —
create, open, rename, export, delete — and **Import** reads project files (`.json`), whether exported
here or from a variant on a project server; an exported file opens in the online version too.

The browser holds the only copy: **export your projects as files** to keep a backup. The start page
asks the browser to keep its storage for good and says when it does not. "Local storage" on the start
page shows what the app keeps — projects, point clouds, settings — and deletes it. A different browser,
or another port, sees other storage: always open the same address.

## What it can do

Everything that computes in the browser:

- create, connect (straight, curve, transition curves) and edit tracks; the element table
- switches, crossings, switch connections, track links; heights in turnouts
- heights and the elevation profile, platforms, routes, cross sections, the rule check
- point clouds read in on this computer (LAS, LAZ, E57): cross section, clearance check, rail detection
- topology, data exchange (project and track files, Verm.ESN TRA/GRA, OSRD, Provi, Gleislage CSV,
  alignment exchange format), plan export as PDF and SVG
- the German rail network's kilometrage lines, which come with the version

## What it cannot do

These need the project server or the optimizer service and are only in the online version:

- projects with variants, revisions, checking in, merging, several users
- optimizing a track or an element, joining two tracks, reconnecting existing elements, fitting an
  alignment to axis points
- the MDB import, the Länder's DGM1 heights
- point clouds on a server, long runs there, their 3D view and re-referencing

Two WMS layers of the Landesvermessung (Sachsen-Anhalt, Schleswig-Holstein) answer only https pages and
stay empty here.
