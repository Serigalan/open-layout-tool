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

## On a web server (shared hosting)

The folder `app/` is nothing but static files: any web server serves it — no Node.js, PHP or database
on the server. Upload **the contents of `app/`** (including the hidden file `.htaccess`) into a folder
of the web space, the root or a subfolder such as `/olt/`, and open its address.

- **https is required.** The browser gives the app its storage and its project ids only on a secure
  page (`https://…`, or `http://localhost`). Switch on the host's certificate (Let's Encrypt).
- **Byte ranges** must work for `data/km_linie.pmtiles` (Apache does by default; the `.htaccess` keeps
  it from compressing the file). Check: `curl -I -r 0-9 https://<your address>/data/km_linie.pmtiles`
  answers `206 Partial Content`.
- **About 2400 files, 200 MB.** Uploading them one by one over FTP takes long; where the host's file
  manager or SSH can unpack a zip, upload a zip of `app/` and unpack it there.
- The `.htaccess` sets file types, caching and keeps the km tiles uncompressed; on nginx or other
  servers, `.wasm` must be served as `application/wasm`.
- **Every visitor has their own projects, in their own browser.** Nothing is stored on the web server
  and nobody sees anyone else's projects; to hand a project on, export it as a file. Projects belong
  to the address: under another domain or folder a browser shows other (or no) projects.
- **The km data is public there.** Whoever knows the address can load it, as everything else in
  `app/`. Where it must not be, protect the folder with the host's password protection (HTTP basic
  authentication); the app works behind it unchanged.
- With https the two WMS layers of Sachsen-Anhalt and Schleswig-Holstein show too.

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
