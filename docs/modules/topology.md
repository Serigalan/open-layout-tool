# topology — the connection diagram

`src/core/utils/topology/` · needs `track`

The diagram of the topological connections of a project: nodes where track ends meet, edges the tracks,
laid out like a track plan. The state of each track end (switch, link, joint, buffer stop, boundary, open)
is computed in `track/topology.js`; the map's topology view (tracks in true position, big switch circles,
red open ends) is `src/core/map/topologyLayer.js`.

## Files

| File | What it does |
|---|---|
| `topologyGraph.js` | The project as a graph: nodes (switch, link, joint, end) and edges (tracks); clusters of connected parts |
| `topologyLanes.js` | The layout: every line through the network on a row of its own |
| `labelPlacement.js` | Labels placed where they cover nothing |

## The graph

Nodes are switches and links (one per record, at the mean of its port ends), plain joints and free track
ends (with their state); edges are tracks from the node at BEGIN to the node at END, with the switch port
holding each end. The graph falls apart into clusters — the parts connected among themselves — each drawn on
its own; tracks connected to nothing are gathered in one further section.

## The layout

A **line** is what a train runs along without turning off: tracks chained through the straight route of
every turnout (A–B2, or B1 on a swapped turnout), the main route of every crossing (A–C), every link and
every plain joint. Every line gets a row; the longest is the main row, the others are placed on the side on
which they lie in the terrain (read 60 m behind the switch against the stem). Single tracks between two lines
(crossovers) are short diagonals. Columns follow from the switch sides (B1/B2 against A), not from the
terrain. Crossings in the diagram are allowed where a line branches beyond another: short paths go before
freedom from crossings. On the PEK Halle–Könnern data this gives 8 and 6 rows with every crossover two
columns wide, where the earlier planar layout produced 22 rows and crossovers over up to 95 columns.

Labels are placed at the first candidate position that covers no line, node or other label (Liang–Barsky
segment–box test), else at the one that covers least.

## In the map

The topology view replaces the normal drawing (switch bodies, markers, labels, platforms and buffer stops
are hidden; the basemap stays): tracks as plain lines in their true position, every switch a large circle,
every link a square, every open end red — an end lying on another but not connected red with a ring. A
list of open ends with their count zooms to each. An end can be marked as a boundary of the planning area
and then no longer counts as an error.

## Decisions

- **An end is connected or open**, nothing in between.
- **Rows by lines**, crossovers as short diagonals; short paths over planarity.
- **The topology view replaces the drawing** rather than lying over it.

## Tests

`topologyGraph.test.js`, `topologyLanes.test.js`, `labelPlacement.test.js`.
