"""Writes src/test/fixtures/reconnect_answers.json: a track and real answers of
the reconnect search (olt_optimizer/reconnect.py) for the app's own tests
(src/utils/commands/reconnect.test.js) — the app's half, the stretch, the
points, the request and the track written back, is tested against what the
service really says. Run again after changing reconnect.py or splice.py:

    WEBSITE/.venv/bin/python tools/optimizer/tests/reconnect_fixture.py
"""

import json
import os
import pathlib
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from olt_optimizer.reconnect import reconnect_payload                     # noqa: E402
from verify_reconnect import MODEL, as_pick, build, points_of             # noqa: E402

E0, N0 = 500000.0, 5700000.0

# Straight, straight, a curve R 800 with 60 m transitions either side, straight,
# straight — the two short straights at the ends so the neighbours of the curve
# are not the track's ends.
chain = build([("s", 50), ("s", 200), ("t", 60, None, 800.0), ("a", 300, 800.0), ("t", 60, 800.0, None),
               ("s", 200), ("s", 50)], start=(E0, N0))
for el in chain:
    el.pop("role")
    el["speed"] = 80
    if el["elementType"] == 1:
        el["cant"] = 50


def request(dep_i, arr_i, fixed=(False, False), **kw):
    dep = as_pick(chain[dep_i], "end", fixed[0])
    arr = as_pick(chain[arr_i], "start", fixed[1])
    lo = dep_i + (1 if fixed[0] else 0)
    hi = arr_i - (1 if fixed[1] else 0)
    return {"dep": dep, "arr": arr, "points": points_of(chain[lo:hi + 1]), "tolerance": 0.10, "speed": 100,
            "transition": "clothoid", "radius": 0, "cantModel": MODEL, "lMin": 40, **kw}


cases = {
    # The curve chosen, its neighbours the two long straights, re-shaped.
    "curve": request(1, 5),
    # The straight before it belongs to a switch: kept, built on from its end.
    "fixedDeparture": request(1, 5, fixed=(True, False), tolerance=0.20),
}
out = {"elements": chain, "cases": {}}
for name, req in cases.items():
    answer = reconnect_payload(req)
    assert "solutions" in answer, (name, answer)
    # The points are what the app computes itself; the test compares a few.
    pts = req["points"]
    req = {**req, "points": {"e0": pts["e0"], "n0": pts["n0"], "count": len(pts["de"]),
                             "sample": [[i, pts["de"][i], pts["dn"][i]] for i in range(0, len(pts["de"]), 5000)]}}
    for sol in answer["solutions"]:
        sol["reconnect"]["band"] = sol["reconnect"]["band"][::20]
    out["cases"][name] = {"request": req, "answer": answer}
path = pathlib.Path(__file__).resolve().parents[3] / "src" / "test" / "fixtures" / "reconnect_answers.json"
path.write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
print("wrote", path, {n: [(s["reconnect"]["variant"]["lengths"], s["reconnect"]["radius"], s["reconnect"]["max"])
                          for s in c["answer"]["solutions"]] for n, c in out["cases"].items()})
