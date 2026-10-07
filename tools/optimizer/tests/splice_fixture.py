"""Writes src/test/fixtures/splice_answers.json: real answers of the splice
construction for the app's own tests (src/utils/commands/splice.test.js), so
the app's half — stitching the answer into the merged track — is tested
against what the service really says. Run again after changing splice.py:

    WEBSITE/.venv/bin/python tools/optimizer/tests/splice_fixture.py
"""

import json
import math
import os
import pathlib
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from olt_optimizer.geometry import _arc_forward, transition_end          # noqa: E402
from olt_optimizer.splice import splice_payload                          # noqa: E402

E0, N0 = 500000.0, 5700000.0


def pick(start, end, bearing, radius=None):
    return {"start": [E0 + start[0], N0 + start[1]], "end": [E0 + end[0], N0 + end[1]], "bearing": bearing, "radius": radius}


# The app's test tracks: a runs east to x = 200; b runs north from y = 100 at x = 400.
a = pick((0, 0), (200, 0), 90.0)
b = pick((400, 100), (400, 700), 0.0)

# Two arcs from an ideal chain: c (R 600, right) – transition – straight –
# transition – R 900 left; d is that last arc stored running back towards the
# straight, so it is folded in backwards.
c_end, c_b = _arc_forward(E0, N0, 0.0, 600.0, 150.0 / 600.0)
c = {"start": [E0, N0], "end": list(c_end), "bearing": c_b, "radius": 600.0}
x, y, b1 = transition_end(c_end[0], c_end[1], c_b, 40.0, 600.0, None, "clothoid")
s2 = (x + 100.0 * math.sin(math.radians(b1)), y + 100.0 * math.cos(math.radians(b1)))
x, y, b2 = transition_end(s2[0], s2[1], b1, 40.0, None, -900.0, "clothoid")
d_far, _ = _arc_forward(x, y, b2, -900.0, 120.0 / 900.0)
d = {"start": list(d_far), "end": [x, y], "bearing": (b2 + 180.0) % 360.0, "radius": 900.0}

# An arc running on into a straight: e (R 900, right) – R 400 left – the
# straight f, stored as it runs on away from the splice, so it is met at its start.
e_end, e_b = _arc_forward(E0, N0, 20.0, 900.0, 300.0 / 900.0)
f_start, b3 = _arc_forward(e_end[0], e_end[1], e_b, -400.0, 160.0 / 400.0)
f_end = (f_start[0] + 200.0 * math.sin(math.radians(b3)), f_start[1] + 200.0 * math.cos(math.radians(b3)))
e = {"start": [E0, N0], "end": list(e_end), "bearing": e_b, "radius": 900.0}
f = {"start": list(f_start), "end": list(f_end), "bearing": b3, "radius": None}

# Track a2 is track a stored the other way, running west from the corner: its
# start meets b's start, and the shorter of the two (a2) departs backwards.
a2 = pick((200, 0), (0, 0), 270.0)

# Project SBSS: an arc R 410 / 80 mm and a straight, joined by R 750 / 45 mm at
# 80 km/h with the Regellänge on both sides (AP S.3) — 28.0 and 36.0 m.
g_end, g_b = _arc_forward(E0, N0, 90.0, 410.0, 115.0 / 410.0)
j, jb = _arc_forward(E0, N0, 90.0, 410.0, 120.0 / 410.0)
x, y, b4 = transition_end(j[0], j[1], jb, 28.0, 410.0, 750.0, "clothoid")
k, kb = _arc_forward(x, y, b4, 750.0, 150.0 / 750.0)
x, y, b5 = transition_end(k[0], k[1], kb, 36.0, 750.0, None, "clothoid")
h0 = (x + 20.0 * math.sin(math.radians(b5)), y + 20.0 * math.cos(math.radians(b5)))
h1 = (x + 220.0 * math.sin(math.radians(b5)), y + 220.0 * math.cos(math.radians(b5)))
g = {"start": [E0, N0], "end": list(g_end), "bearing": g_b, "radius": 410.0, "cant": 80, "speed": 80}
h = {"start": list(h0), "end": list(h1), "bearing": b5, "radius": None, "speed": 80}

base = {"radius": 300, "lDep": 0, "lArr": 0, "transition": "clothoid", "arcJoin": "straight"}
cases = {
    "corner": {**base, "dep": a, "arr": b},
    "cornerPickedTheOtherWay": {**base, "dep": b, "arr": a},
    "startToStart": {**base, "dep": b, "arr": a2},
    "cornerTransitions": {**base, "dep": a, "arr": b, "lDep": 60, "lArr": 60},
    "arcsStraight": {**base, "dep": c, "arr": d, "lDep": 40, "lArr": 40},
    "arcOnToStraight": {**base, "dep": e, "arr": f, "radius": 400},
    "sbssRegular": {**base, "dep": g, "arr": h, "radius": 750, "cant": 45, "speed": 80, "lDep": 60, "lArr": 60,
                    "modeDep": "regular", "modeArr": "regular"},
}
out = {name: {"request": req, "answer": splice_payload(req)} for name, req in cases.items()}
for name, case in out.items():
    assert "error" not in case["answer"], (name, case["answer"])
path = pathlib.Path(__file__).resolve().parents[3] / "src" / "test" / "fixtures" / "splice_answers.json"
path.write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
print("wrote", path, {n: [e["elementType"] for e in c["answer"]["solutions"][0]["elements"]] for n, c in out.items()})
