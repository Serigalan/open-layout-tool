# survey — measured axes

`src/core/utils/survey/` · needs `commands`, `track`, `geometry`

Track axes that were measured rather than designed, and comparing designs with them: axis points traced in
point clouds (`axisSurveys`), reference axes of existing track read from Verm.ESN files (`referenceAxes`),
shift values of a design against a reference axis, and the request and result of fitting an alignment to
axis points (the fit itself runs in the optimizer service).

## Files

| File | What it does |
|---|---|
| `axisSurvey.js` | A measured axis kept in the project: axis points from a rail trace, packed; statistics, defects |
| `referenceAxis.js` | A reference axis (Bestandsachse): a surveyed track's axis as points every centimetre, built from a TRA (and optional GRA) file |
| `shiftValues.js` | Shift values (Verschiebewerte): across and in height, at round stations of the reference axis; CSV |
| `alignmentFit.js` | Alignment from axis points: point file parsing, the request to the service, the new track and the report from its answer, editing the straights |

## Axis surveys

An axis point is **the middle between the two rail head centres** — not the middle of the gauge faces 14 mm
below the top of rail: the head centre rests on the whole head top and needs no inner flank, which is often
hidden in a scan (side wear shifts it by half the wear, and the report says so). It is found from the inner
flank plus half the nominal head width, since the outer side of the head is smeared in scans; for the axis
both are the same while both heads are equally wide. The height of a point is, by default, the top of the
**lower** rail head, with the cant measured up from it — as `track.heights` is defined; both head heights
are stored raw and SO and cant derived. Standard gauge only. At turnouts the trace leaves a gap and reports
it.

A survey is a collection of its own in the project (`axisSurveys`), not tied to a track: its points lie in a
plane of their own (`epsg`), so changing the track it was traced along leaves it as it is. It is small enough
to share with the record (~60–80 kB per km) and is the basis of an alignment that should stay traceable —
unlike the point clouds, which stay out of the record. Points are packed as whole millimetres in parallel
arrays: station along the guide, easting/northing from an origin, both head tops, gauge and quality. A survey
remembers the server clouds it was traced from and the re-referencing in force then; if that changes, the
survey is marked and can be shifted along or traced again (see `pointCloud`).

## Reference axes

A reference axis is the axis of a surveyed track as **points every centimetre, nothing else** — its elements
are not kept. It is read from Verm.ESN (TRA, optional GRA with the gradient including vertical curves), at
most 2 km of axis in the project (a range by its own stationing is chosen for a longer one). Point *i* lies
at station `s0 + i·step`; easting, northing and height are whole millimetres, each stored as the difference
to the point before. Collection `referenceAxes`, merged as a whole object.

## Shift values

How far a design lies from a reference axis, at round stations of the reference (1, 5 or 10 m): at station s
the **normal of the reference axis** is cut with the compared axis within 2 m. The shift across is the
distance along that normal, positive to the right in the reference axis' direction; the lift is the compared
gradient's height at the cut minus the reference's, positive upwards — only where both are in the same
height system. Computed in the browser on every mouse move in the connect dialogs. Over a limit (default 50 mm
across and in height, remembered per device) there is only a warning. Shown as a band, a table, CSV and on
the map; the height profile draws the reference axis' height the same way, with the deviation as its own
strip in mm.

## Alignment from axis points

The interface between detection and design is a **point file**: easting, northing, top of rail and cant per
axis point (`Nr;Station [m];Rechtswert [m];Hochwert [m];SO [m];Überhöhung [mm];Güte`), the stage-A export or
points delivered from elsewhere (headers in German or English, or none). The fit runs in the optimizer
service (`alignment_fit.py`, `gradient_fit.py`): straights after the client's procedure (6 m window, 1 cm
tolerance, 0.5 m step, 6 m spacing) with a fitted line, curvature test and minimum length; curves between
them by the splice mathematics, with R and transitions fitted to the points; the gradient and the cant of
the elements from the points' heights and cant. The result is a **new track**, never a change to an existing
one. The break points can be moved in the curvature diagram (in the panel, zoomable).

Edge cases decided: two straights that are offset rather than turned (no curve fits between them) become
one straight when found automatically, with the station named; set by hand, it is an error at that place. A
curve where the points begin or end is fitted from the tangent point of the straight and cut at the first or
last point. A transition is left out when the fit without it is worse by less than 0.5 mm RMS — tested only
for transitions that shift the curve by less than 2 cm (L²/24R).

## Decisions

- **Axis point = middle of the head centres**, height = top of the lower rail.
- **Surveys and reference axes are their own collections**, in their own planes, not tied to tracks.
- **Reference axes keep points, not elements**, every centimetre as millimetre differences.
- **Shift values along the reference normal**, warnings only.
- **Fitting runs in Python**; its result is always a new track.

## Tests

`axisSurvey.test.js`, `referenceAxis.test.js`, `shiftValues.test.js`, `alignmentFit.test.js` (with a real
service answer from `src/core/test/fixtures/align_answer.json`).
