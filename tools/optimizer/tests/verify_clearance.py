"""Acceptance for the track spacing of a splice (olt_optimizer/clearance.py).

The spacing is the user's minimum widened by what the cant adds where it leans
the two clearance outlines towards each other; the splice is checked against
it, or searched for the largest radius that keeps it.

The case: an existing inner track — a straight running east, a left-hand arc
R 300 about (100, 300), a straight running north — and the two straights of a
new outer track 4.5 m outside it. The corner arc tangent to both is concentric
with the inner one at R 304.5 and keeps its 4.5 m; a larger one moves its
middle towards the inner arc by (R − 304.5)(√2 − 1). Without cant, 4.0 m are
kept up to R ≈ 305.7.

    /var/lib/open-layout-tool/venv/bin/python tools/optimizer/tests/verify_clearance.py
"""

import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from olt_optimizer.clearance import Spacing, auto_cant          # noqa: E402
from olt_optimizer.splice import splice_payload                  # noqa: E402

FAILED = []


def ok(label, cond):
    print(("PASS " if cond else "FAIL ") + label)
    if not cond:
        FAILED.append(label)


with open(os.path.join(HERE, "..", "..", "..", "src", "constraints", "db-ril-800-0130.json"), encoding="utf-8") as f:
    PROFILE = next(p for p in json.load(f)["lichtraum"]["profile"] if p["id"] == "hauptgleis")["umriss"]
MODEL = {"coeff": 6.5, "defCoeff": 11.8, "defMin": 60, "max": 160, "step": 5}
E0, N0 = 500000.0, 5600000.0


# ── the spacing the cant adds ────────────────────────────────────────────────

sp = Spacing(PROFILE)
ok("no cant: the outlines meet at twice the half width", abs(sp.needed(0, 0, 1) - 5000) < 1e-6)
ok("no cant: nothing added", sp.widening(0, 0, 1) == 0 and sp.widening(0, 0, -1) == 0)
# A positive cant raises the left rail: the track leans right.
w = sp.widening(150, 0, 1)
ok(f"leaning towards the neighbour adds about z · u/1500 at the outline's shoulder ({w:.3f} m)", 0.25 < w < 0.55)
ok("leaning away adds nothing", sp.widening(150, 0, -1) == 0)
# Leaning alike, the gap across stays; read level it widens by a few
# centimetres, a level cut through a tilted outline being wider (w / cos θ).
ok(f"both leaning alike add only a little ({sp.widening(150, 150, 1):.3f} m)", 0 <= sp.widening(150, 150, 1) < 0.06)
ok("the neighbour leaning towards this track adds as much", abs(sp.widening(0, -150, 1) - w) < 0.01)
ok("auto cant as the app: R 300 at 80 km/h is 140 mm", auto_cant(80, 300, MODEL) == 140)
ok("auto cant as the app: none where the deficiency stays under 60 mm", auto_cant(40, 2000, MODEL) == 0)


# ── the inner track and the new outer straights ──────────────────────────────

def inner(cant=0.0):
    """Axis points of the inner track every metre, with its cant (negative: a left-hand curve)."""
    pts = [(E0 + x, N0, 0.0) for x in range(0, 100)]
    cx, cy = E0 + 100, N0 + 300
    n = int(300 * math.pi / 2)
    for i in range(n + 1):
        a = -math.pi / 2 + (math.pi / 2) * i / n
        pts.append((cx + 300 * math.cos(a), cy + 300 * math.sin(a), -cant))
    pts += [(E0 + 400, N0 + 300 + y, 0.0) for y in range(1, 400)]
    return [list(p) for p in pts]


DEP = {"start": [E0 + 0, N0 - 4.5], "end": [E0 + 100, N0 - 4.5], "bearing": 90.0, "radius": None}
ARR = {"start": [E0 + 404.5, N0 + 700], "end": [E0 + 404.5, N0 + 300], "bearing": 180.0, "radius": None}

# The inner arc as built: (100, 0) → (400, 300) about (100, 300).
ref = inner()
ok("the inner track is laid out as described",
   abs(ref[100][0] - (E0 + 100)) < 1e-6 and abs(ref[100][1] - N0) < 1e-6
   and abs(ref[100 + int(300 * math.pi / 2)][0] - (E0 + 400)) < 1e-6)


def ask(**kw):
    clearance = {"ref": kw.pop("ref", ref), "dMin": kw.pop("dMin", 4.0), "profile": PROFILE,
                 "cantModel": MODEL, **kw.pop("clearance", {})}
    return splice_payload({"dep": DEP, "arr": ARR, "radius": kw.pop("radius", 304.5), "clearance": clearance, **kw})


res = ask(radius=304.5)
c = res["info"]["clearance"]
ok(f"concentric R 304.5: kept, 4.5 m apart ({c['distance']:.3f} m)", c["kept"] and abs(c["distance"] - 4.5) < 0.01)
res = ask(radius=320)
ok("R 320 comes too close", not res["info"]["clearance"]["kept"])

res = ask(clearance={"maximize": True, "speed": 0})
c = res["info"]["clearance"]
ok(f"largest radius without cant: 305 m ({c.get('radius')})", c.get("radius") == 305)
ok("…and it keeps the spacing", c["kept"] and c["margin"] >= 0)
ok("…the arc built is that radius", abs(abs(res["info"]["signedR"]) - 305) < 1e-9)

# At 80 km/h the new arc takes the cant the app proposes (135 mm at R 304)
# and leans towards the inner track.
res = ask(clearance={"maximize": True, "speed": 80})
c = res["info"]["clearance"]
ok(f"largest radius with the new track canted: smaller ({c.get('radius')}, u = {c.get('cant')})",
   c.get("radius") is not None and c["radius"] < 305 and c["cant"] == auto_cant(80, c["radius"], MODEL) > 0)
ok(f"…the spacing asked for there is widened ({c['required']:.3f} m)", c["required"] > 4.2)

# Both canted alike: they lean together, and the plain 4.0 m holds again.
res = ask(ref=inner(140.0), clearance={"maximize": True, "speed": 80})
c = res["info"]["clearance"]
ok(f"both canted alike: 305 m again ({c.get('radius')})", c.get("radius") == 305)

# The cant ramps over transitions: with 40 m of them the arc moves inwards and
# the largest radius is another, but the answer still holds the spacing.
res = ask(lDep=40, lArr=40, clearance={"maximize": True, "speed": 80})
c = res["info"]["clearance"]
ok(f"with transitions: a radius that keeps the spacing ({c.get('radius')})",
   "error" not in res and c["kept"] and c["margin"] >= 0)

# A neighbour on the corner itself: every arc leaves it at its tangent point.
res = ask(ref=[[E0, N0 - 4.5, 0], [E0 + 404.5, N0 - 4.5, 0], [E0 + 404.5, N0 + 700, 0]],
          clearance={"maximize": True, "speed": 0})
ok("a neighbour every arc touches: no radius keeps it", res.get("error") == "splice_error_clearance")


# ── an arc and a straight ────────────────────────────────────────────────────
# The new outer track comes in on a flat arc (R 1500, left, from (100, −4.5)
# heading east); the new arc between it and the northbound straight is the
# radius to choose, kept 4.0 m off the inner track.
import time                                                       # noqa: E402
from olt_optimizer.geometry import _arc_forward, transition_end    # noqa: E402

end, b_end = _arc_forward(E0 + 100, N0 - 4.5, 90.0, -1500.0, 60.0 / 1500.0)
ARC = {"start": [E0 + 100, N0 - 4.5], "end": list(end), "bearing": b_end, "radius": -1500.0}


def arc_ask(**cl):
    return splice_payload({"dep": ARC, "arr": ARR, "radius": cl.pop("radius", 300), "clearance": {
        "ref": ref, "dMin": 4.0, "profile": PROFILE, "cantModel": MODEL, **cl}})


t0 = time.monotonic()
res = arc_ask(maximize=True, speed=0, lMin=12)
took = time.monotonic() - t0
c = res.get("info", {}).get("clearance", {})
ok(f"arc and straight: a largest radius keeping 4.0 m ({c.get('radius')}, {took:.1f} s)",
   "error" not in res and c["kept"] and 200 <= c["radius"] <= 320 and res["info"]["arcLength"] >= 12)
ok("arc and straight: answered within a few seconds", took < 5)
r = c["radius"]
over = arc_ask(radius=r + 3)
ok("arc and straight: 3 m more radius does not keep it",
   "error" in over or not over["info"]["clearance"]["kept"])
ok(f"arc and straight checked at that radius: kept ({arc_ask(radius=r)['info']['clearance']['distance']:.3f} m)",
   arc_ask(radius=r)["info"]["clearance"]["kept"])

# ── two arcs: no radius to choose, the spacing is only checked ───────────────
P0 = (E0, N0)
A, bA = _arc_forward(P0[0], P0[1], 20.0, 900.0, 250.0 / 900.0)
x, y, bS1 = transition_end(A[0], A[1], bA, 70.0, 900.0, None, "clothoid")
S1 = (x, y)
S2 = (S1[0] + 120.0 * math.sin(math.radians(bS1)), S1[1] + 120.0 * math.cos(math.radians(bS1)))
x, y, bB = transition_end(S2[0], S2[1], bS1, 70.0, None, -700.0, "clothoid")
B = (x, y)
C, _ = _arc_forward(B[0], B[1], bB, -700.0, 200.0 / 700.0)
# A neighbour 6 m to the left of the straight between them.
left = (-math.cos(math.radians(bS1)), math.sin(math.radians(bS1)))
side_ref = [[S1[0] + 6 * left[0] + t * math.sin(math.radians(bS1)), S1[1] + 6 * left[1] + t * math.cos(math.radians(bS1)), 0]
            for t in range(-20, 141)]
res = splice_payload({"dep": {"start": list(P0), "end": list(A), "bearing": bA, "radius": 900.0},
                      "arr": {"start": list(C), "end": list(B), "bearing": (bB + 180.0) % 360.0, "radius": 700.0},
                      "lDep": 70.0, "lArr": 70.0, "clearance": {
                          "ref": side_ref, "dMin": 4.0, "profile": PROFILE, "cantModel": MODEL,
                          "maximize": True, "speed": 0}})
c = res.get("info", {}).get("clearance", {})
ok(f"two arcs: checked, not searched (closest {c.get('distance', 0):.3f} m)",
   "error" not in res and "radius" not in c and c["kept"] and abs(c["distance"] - 6.0) < 0.05)

print()
print("all passed" if not FAILED else f"{len(FAILED)} FAILED")
sys.exit(1 if FAILED else 0)
