"""Acceptance for the splice construction (olt_optimizer/splice.py, AP 12.4).

Every case is a round trip where it can be: an ideal chain is built forwards,
its outer elements are handed over as the two picks, and the splice has to find
what was between them. Every chain that comes back is checked to hold together
— each element true to its own figures, each junction without gap or kink.
The cases are the ones the app's former spliceUtils.test.js and
commands/splice.test.js held.

    WEBSITE/.venv/bin/python tools/optimizer/tests/verify_splice.py
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from olt_optimizer.geometry import _arc_forward, transition_end          # noqa: E402
from chain_check import chain_holds, near, turn                          # noqa: E402
from olt_optimizer.splice import splice_payload as _payload              # noqa: E402

FAILED = []


def splice_payload(req):
    """The best solution of an answer, its flags beside it, or the error."""
    answer = _payload(req)
    return answer["solutions"][0] if "solutions" in answer else answer


def ok(label, cond):
    print(("PASS " if cond else "FAIL ") + label)
    if not cond:
        FAILED.append(label)


P0 = (500000.0, 5600000.0)


def along(p, bearing, length):
    return (p[0] + length * math.sin(math.radians(bearing)), p[1] + length * math.cos(math.radians(bearing)))


def pick(start, end, bearing, radius=None):
    return {"start": list(start), "end": list(end), "bearing": bearing, "radius": radius}


# ── two straights ────────────────────────────────────────────────────────────
# Track a runs east to x = 200; track b runs north from y = 100 at x = 400.
a = pick((P0[0], P0[1]), (P0[0] + 200, P0[1]), 90.0)
b = pick((P0[0] + 400, P0[1] + 100), (P0[0] + 400, P0[1] + 700), 0.0)
res = splice_payload({"dep": a, "arr": b, "radius": 300})
ok("corner: no error", "error" not in res)
ok("corner: a quarter circle of R 300, turning left",
   abs(res["info"]["arcLength"] - 300 * math.pi / 2) < 1e-6 and res["info"]["signedR"] == -300)
ok("corner: the arrival is a continuation, not folded in", res["reverseArr"] is False)
ok("corner: straight, arc, straight", [e["elementType"] for e in res["elements"]] == [0, 1, 0])
ok("corner: roles dep, new, arr", [e["role"] for e in res["elements"]] == ["dep", "new", "arr"])
ok("corner: runs from the departure start to the arrival end",
   near(res["elements"][0]["startNode"], a["start"], 1e-9) and near(res["elements"][-1]["endNode"], b["end"], 1e-9))
ok("corner: chain holds (" + str(chain_holds(res["elements"])) + ")", chain_holds(res["elements"]) is None)

res = splice_payload({"dep": a, "arr": b, "radius": 300, "lDep": 60, "lArr": 60})
ok("corner with transitions: 0 2 1 2 0", [e["elementType"] for e in res["elements"]] == [0, 2, 1, 2, 0])
ok("corner with transitions: chain holds (" + str(chain_holds(res["elements"])) + ")", chain_holds(res["elements"]) is None)

res = splice_payload({"dep": a, "arr": b, "radius": 300, "lDep": 60, "lArr": 30, "transition": "bloss"})
ok("corner with Bloss, unequal: chain holds (" + str(chain_holds(res.get("elements", []))) + ")",
   "error" not in res and chain_holds(res["elements"]) is None)

res = splice_payload({"dep": a, "arr": b, "radius": 2000})
ok("corner too wide: refused on the departure side", res.get("error") == "splice_error_dep_too_large")
r_max = res.get("params", {}).get("rMax")
# the departure tangent lies 400 - R east of its start: R 400 is the most that fits
ok(f"corner too wide: names the largest radius that fits ({r_max})", r_max == 400)
fits = splice_payload({"dep": a, "arr": b, "radius": r_max})
ok("corner at that radius: fits", "error" not in fits)
ok("corner one metre wider: does not", "error" in splice_payload({"dep": a, "arr": b, "radius": r_max + 1}))

par = pick((P0[0], P0[1] + 50), (P0[0] + 200, P0[1] + 50), 90.0)
ok("parallel straights: refused", splice_payload({"dep": a, "arr": par, "radius": 300}).get("error") == "splice_error_parallel")

# The arrival met against its direction: track c runs south towards the corner.
# Square to the departure, which way turns less is a coin toss — the one that
# fits is taken.
c = pick((P0[0] + 400, P0[1] + 700), (P0[0] + 400, P0[1] + 100), 180.0)
res = splice_payload({"dep": a, "arr": c, "radius": 300})
ok("corner, arrival folded in: reverseArr", res.get("reverseArr") is True)
c2 = pick((P0[0] + 420, P0[1] + 700), (P0[0] + 400, P0[1] + 100), (math.degrees(math.atan2(-20, -600))) % 360)
res2 = splice_payload({"dep": a, "arr": c2, "radius": 300})
ok("corner, arrival a little past square: folded in too", res2.get("reverseArr") is True and chain_holds(res2["elements"]) is None)
# Two ends meet: the shorter track (a, 200 m against 600 m) is the one turned
# round, whichever was clicked first (Entscheidung 182).
ok("corner, two ends: the longer departs", res.get("depPick") == 1 and res.get("reverseDep") is False)
ok("corner, two ends: runs from the longer one's start to the shorter one's start",
   near(res["elements"][0]["startNode"], c["start"], 1e-9) and near(res["elements"][-1]["endNode"], a["start"], 1e-9)
   and chain_holds(res["elements"]) is None)
swapped = splice_payload({"dep": c, "arr": a, "radius": 300})
ok("corner, two ends, clicked the other way: the same", swapped.get("depPick") == 0
   and near(swapped["elements"][-1]["endNode"], a["start"], 1e-9))
a_long = {**a, "before": 500.0}
res = splice_payload({"dep": a_long, "arr": c, "radius": 300})
ok("corner, two ends, track a the longer with what lies before it: a departs",
   res.get("depPick") == 0 and near(res["elements"][-1]["endNode"], c["start"], 1e-9))
# Two starts meet: the shorter departs, run backwards.
a_back = pick(a["end"], a["start"], 270.0)
c_back = pick(c["end"], c["start"], 0.0)
res = splice_payload({"dep": c_back, "arr": a_back, "radius": 300})
ok("corner, two starts: the shorter departs backwards", res.get("depPick") == 1 and res.get("reverseDep") is True
   and res.get("reverseArr") is False and chain_holds(res["elements"]) is None)


# ── an ideal chain helper ────────────────────────────────────────────────────

def arc_step(p, bearing, length, r):
    end, b = _arc_forward(p[0], p[1], bearing, r, length / abs(r))
    return end, b


def trans_step(p, bearing, length, r1, r2, profile="clothoid"):
    if not length > 0:
        return p, bearing
    x, y, b = transition_end(p[0], p[1], bearing, length, r1, r2, profile)
    return (x, y), b


# ── two arcs joined by one transition ────────────────────────────────────────

def arc_arc_case(r1, r2, length, profile="clothoid", label=""):
    A, bA = arc_step(P0, 20.0, 300.0, r1)
    B, bB = trans_step(A, bA, length, r1, r2, profile)
    C, _ = arc_step(B, bB, 250.0, r2)
    dep = pick(P0, A, bA, r1)
    arr = pick(C, B, (bB + 180.0) % 360.0, -r2)
    res = splice_payload({"dep": dep, "arr": arr, "arcJoin": "transition", "transition": profile})
    ok(f"{label}: no error", "error" not in res)
    if "error" in res:
        return
    ok(f"{label}: finds the transition length back ({res['info']['transitionLength']:.6f})",
       abs(res["info"]["transitionLength"] - length) < 1e-4)
    els = res["elements"]
    ok(f"{label}: both junctions where they were",
       near(els[1]["startNode"], A, 1e-3) and near(els[1]["endNode"], B, 1e-3))
    ok(f"{label}: arc, transition, arc with the radii", els[0]["radius"] == r1 and els[1]["r1"] == r1
       and els[1]["r2"] == r2 and els[2]["radius"] == r2)
    ok(f"{label}: chain holds ({chain_holds(els)})", chain_holds(els) is None)
    return res


res = arc_arc_case(1000.0, 600.0, 120.0, label="compound curve")
ok("compound curve: called one", res and res["info"]["compound"] is True)
res = arc_arc_case(800.0, -600.0, 150.0, label="reverse curve")
ok("reverse curve: not compound", res and res["info"]["compound"] is False)
arc_arc_case(1000.0, 600.0, 120.0, profile="bloss", label="Bloss between two arcs")

A, bA = arc_step(P0, 20.0, 300.0, 1000.0)
res = splice_payload({"dep": pick(P0, A, bA, 1000.0), "arr": pick(P0, A, bA, -600.0), "arcJoin": "transition"})
ok("two circles no transition bridges: refused", res.get("error") == "splice_error_arcs_no_fit")


# ── two arcs joined by a straight ────────────────────────────────────────────
r1, r2, L = 900.0, -700.0, 70.0
A, bA = arc_step(P0, 20.0, 250.0, r1)
S1, bS1 = trans_step(A, bA, L, r1, None)
S2 = along(S1, bS1, 120.0)
B, bB = trans_step(S2, bS1, L, None, r2)
C, _ = arc_step(B, bB, 200.0, r2)
res = splice_payload({"dep": pick(P0, A, bA, r1), "arr": pick(C, B, (bB + 180.0) % 360.0, -r2), "lDep": L, "lArr": L})
ok("arcs by a straight: no error", "error" not in res)
if "error" not in res:
    ok(f"arcs by a straight: finds the straight back ({res['info']['straightLength']:.6f})",
       abs(res["info"]["straightLength"] - 120.0) < 1e-4)
    ok("arcs by a straight: 1 2 0 2 1", [e["elementType"] for e in res["elements"]] == [1, 2, 0, 2, 1])
    ok(f"arcs by a straight: chain holds ({chain_holds(res['elements'])})", chain_holds(res["elements"]) is None)


# ── an arc and a straight, joined by a new arc ───────────────────────────────

def mixed_chain(ld=80.0, la=80.0, rn=-400.0):
    A, bA = arc_step(P0, 20.0, 300.0, 900.0)
    B, bB = trans_step(A, bA, ld, 900.0, rn)
    C, bC = arc_step(B, bB, 160.0, rn)
    D, bD = trans_step(C, bC, la, rn, None)
    E = along(D, bD, 200.0)
    return A, bA, D, bD, E


A, bA, D, bD, E = mixed_chain()
arc_pick = pick(P0, A, bA, 900.0)
straight_pick = pick(E, D, (bD + 180.0) % 360.0)
res = splice_payload({"dep": arc_pick, "arr": straight_pick, "radius": 400, "lDep": 80, "lArr": 80})
ok("arc to straight: no error", "error" not in res)
if "error" not in res:
    ok(f"arc to straight: finds the arc of R -400 and 160 m ({res['info']['arcLength']:.6f})",
       res["info"]["signedR"] == -400 and abs(res["info"]["arcLength"] - 160.0) < 1e-3)
    ok("arc to straight: 1 2 1 2 0", [e["elementType"] for e in res["elements"]] == [1, 2, 1, 2, 0])
    ok(f"arc to straight: chain holds ({chain_holds(res['elements'])})", chain_holds(res["elements"]) is None)

res = splice_payload({"dep": straight_pick, "arr": arc_pick, "radius": 400, "lDep": 80, "lArr": 80})
ok("straight to arc: no error", "error" not in res)
if "error" not in res:
    els = res["elements"]
    # Two ends meet: the straight, the shorter, is the one turned round.
    ok("straight to arc, picked the other way: the arc departs, the straight is folded in",
       res["depPick"] == 1 and res["reverseArr"] is True and els[0]["radius"] == 900.0 and els[-1]["elementType"] == 0)
    ok("straight to arc: from the arc's start to the straight's start",
       near(els[0]["startNode"], P0, 1e-6) and near(els[-1]["endNode"], E, 1e-6))
    ok(f"straight to arc: finds the arc of R -400 and 160 m all the same ({res['info']['arcLength']:.6f})",
       res["info"]["signedR"] == -400 and abs(res["info"]["arcLength"] - 160.0) < 1e-3)
    ok(f"straight to arc: chain holds ({chain_holds(els)})", chain_holds(els) is None)

A, bA, D, bD, E = mixed_chain(ld=0.0, la=0.0)
res = splice_payload({"dep": pick(P0, A, bA, 900.0), "arr": pick(E, D, (bD + 180.0) % 360.0), "radius": 400})
ok("arc to straight without transitions: three elements", "error" not in res and len(res["elements"]) == 3)
ok(f"arc to straight without transitions: chain holds ({chain_holds(res.get('elements', []))})",
   "error" not in res and chain_holds(res["elements"]) is None)


# ── the arrival a continuation: met at its start, run on its own way ─────────
# The same ideal chains, the arrival element stored as it runs on — from the
# splice away. Every arc case has to meet it at its start and keep its direction.

def arrival_ahead(start, end, bearing_at_end, radius=None):
    return pick(start, end, bearing_at_end, radius)


A, bA, D, bD, E = mixed_chain()
res = splice_payload({"dep": pick(P0, A, bA, 900.0), "arr": arrival_ahead(D, E, bD), "radius": 400, "lDep": 80, "lArr": 80})
ok("arc on to a straight: no error", "error" not in res)
if "error" not in res:
    ok("arc on to a straight: the arrival runs on, not folded in", res["reverseArr"] is False)
    ok(f"arc on to a straight: finds the arc of R -400 and 160 m back ({res['info']['arcLength']:.6f})",
       res["info"]["signedR"] == -400 and abs(res["info"]["arcLength"] - 160.0) < 1e-3)
    ok("arc on to a straight: ends at the straight's far end, in its direction",
       near(res["elements"][-1]["endNode"], E, 1e-6) and abs(turn(res["elements"][-1]["bearing"], bD)) < 1e-6)
    ok(f"arc on to a straight: chain holds ({chain_holds(res['elements'])})", chain_holds(res["elements"]) is None)

# A straight running on into an arc: straight, transition, R -400, transition, R 900.
E = along(P0, 20.0, 200.0)
B, bB = trans_step(E, 20.0, 80.0, None, -400.0)
C, bC = arc_step(B, bB, 160.0, -400.0)
D, bD = trans_step(C, bC, 80.0, -400.0, 900.0)
F, bF = arc_step(D, bD, 300.0, 900.0)
res = splice_payload({"dep": pick(P0, E, 20.0), "arr": arrival_ahead(D, F, bF, 900.0), "radius": 400, "lDep": 80, "lArr": 80})
ok("straight on to an arc: no error", "error" not in res)
if "error" not in res:
    els = res["elements"]
    ok("straight on to an arc: runs on", res["reverseArr"] is False)
    ok(f"straight on to an arc: finds the arc of R -400 and 160 m back ({res['info']['arcLength']:.6f})",
       res["info"]["signedR"] == -400 and abs(res["info"]["arcLength"] - 160.0) < 1e-3)
    ok("straight on to an arc: ends at the arc's far end on its own radius",
       near(els[-1]["endNode"], F, 1e-6) and els[-1]["radius"] == 900.0)
    ok(f"straight on to an arc: chain holds ({chain_holds(els)})", chain_holds(els) is None)

r1, r2, L = 900.0, -700.0, 70.0
A, bA = arc_step(P0, 20.0, 250.0, r1)
S1, bS1 = trans_step(A, bA, L, r1, None)
S2 = along(S1, bS1, 120.0)
B, bB = trans_step(S2, bS1, L, None, r2)
C, bC = arc_step(B, bB, 200.0, r2)
res = splice_payload({"dep": pick(P0, A, bA, r1), "arr": arrival_ahead(B, C, bC, r2), "lDep": L, "lArr": L})
ok("arcs on by a straight: no error", "error" not in res)
if "error" not in res:
    ok("arcs on by a straight: runs on", res["reverseArr"] is False)
    ok(f"arcs on by a straight: finds the straight back ({res['info']['straightLength']:.6f})",
       abs(res["info"]["straightLength"] - 120.0) < 1e-4)
    ok("arcs on by a straight: the arrival arc keeps its radius and far end",
       res["elements"][-1]["radius"] == r2 and near(res["elements"][-1]["endNode"], C, 1e-6))
    ok(f"arcs on by a straight: chain holds ({chain_holds(res['elements'])})", chain_holds(res["elements"]) is None)

for r1, r2, length, label in ((1000.0, 600.0, 120.0, "compound curve running on"), (800.0, -600.0, 150.0, "reverse curve running on")):
    A, bA = arc_step(P0, 20.0, 300.0, r1)
    B, bB = trans_step(A, bA, length, r1, r2)
    C, bC = arc_step(B, bB, 250.0, r2)
    res = splice_payload({"dep": pick(P0, A, bA, r1), "arr": arrival_ahead(B, C, bC, r2), "arcJoin": "transition"})
    ok(f"{label}: no error", "error" not in res)
    if "error" not in res:
        ok(f"{label}: runs on", res["reverseArr"] is False)
        ok(f"{label}: finds the transition length back ({res['info']['transitionLength']:.6f})",
           abs(res["info"]["transitionLength"] - length) < 1e-4)
        ok(f"{label}: arc, transition, arc with the radii", res["elements"][2]["radius"] == r2
           and near(res["elements"][-1]["endNode"], C, 1e-6))
        ok(f"{label}: chain holds ({chain_holds(res['elements'])})", chain_holds(res["elements"]) is None)

# Line 5550 (EPSG 5678): track .00046 ends on 15 m of R 510 at a bearing of
# 102.5°, .00253 runs on 150 m further at 115.6° — one way, a
# continuation. Folding the straight in backwards asked for nearly a U-turn.
dep_5550 = {"start": [4468124.249792, 5333465.913663], "end": [4468138.953721783, 5333462.876345586],
            "bearing": 102.51457363522997, "radius": 510.0}
arr_5550 = {"start": [4468280.554942, 5333410.790463], "end": [4468321.738641341, 5333391.050201301],
            "bearing": 115.60943487690275, "radius": None}
res = splice_payload({"dep": dep_5550, "arr": arr_5550, "radius": 700})
ok("line 5550: R 700 runs on from the arc to the straight", "error" not in res and res["reverseArr"] is False)
if "error" not in res:
    ok("line 5550: re-shaped arc, new arc, lengthened straight",
       [(e["elementType"], e["role"]) for e in res["elements"]] == [(1, "dep"), (1, "new"), (0, "arr")])
    ok("line 5550: ends at the straight's far end",
       near(res["elements"][-1]["endNode"], arr_5550["end"], 1e-6))
    ok(f"line 5550: chain holds ({chain_holds(res['elements'])})", chain_holds(res["elements"]) is None)
ok("line 5550: R 500 does not fit",
   splice_payload({"dep": dep_5550, "arr": arr_5550, "radius": 500}).get("error") == "splice_error_no_fit")


# ── the Regellänge, solved with the chain (AP S.3) ───────────────────────────
# Project SBSS, 2026-10-07: an arc R 410 / 80 mm and a straight joined by a new
# arc R 750 / 45 mm at 80 km/h. Into the new arc the transition runs from a
# compound curve (Δu 35 mm: 10·80·35/1000 = 28.0 m), out of it into the
# straight (Δu 45 mm: 36.0 m) — known only once the hand of the new arc is.
A, bA = arc_step(P0, 90.0, 120.0, 410.0)
B, bB = trans_step(A, bA, 28.0, 410.0, 750.0)
C, bC = arc_step(B, bB, 150.0, 750.0)
D, bD = trans_step(C, bC, 36.0, 750.0, None)
E, F = along(D, bD, 20.0), along(D, bD, 220.0)
sbss_arc = {**pick(P0, arc_step(P0, 90.0, 115.0, 410.0)[0], arc_step(P0, 90.0, 115.0, 410.0)[1], 410.0),
            "cant": 80, "speed": 80}
sbss_straight = {**pick(F, E, (bD + 180.0) % 360.0), "speed": 80}
sbss = {"radius": 750, "cant": 45, "speed": 80, "lDep": 60, "lArr": 60, "modeDep": "regular", "modeArr": "regular"}
for label, req in (("SBSS", {**sbss, "dep": sbss_arc, "arr": sbss_straight}),
                   ("SBSS clicked the other way", {**sbss, "dep": sbss_straight, "arr": sbss_arc})):
    res = splice_payload(req)
    ok(f"{label}: no error", "error" not in res)
    if "error" in res:
        continue
    k_arc = 0 if req["dep"] is sbss_arc else 1
    lengths = res["lengths"]
    ok(f"{label}: the Regellänge into the new arc is 28.0 m ({lengths[k_arc]['length']})",
       lengths[k_arc]["mode"] == "regular" and lengths[k_arc]["length"] == 28.0)
    ok(f"{label}: …set by LP.UB.03", [b["id"] for b in lengths[k_arc]["regularBy"] if b["binding"]] == ["LP.UB.03"])
    ok(f"{label}: out of it into the straight 36.0 m ({lengths[1 - k_arc]['length']})",
       lengths[1 - k_arc]["length"] == 36.0)
    ok(f"{label}: finds the arc that was built (R 750, 150 m)",
       abs(res["info"]["arcLength"] - 150.0) < 1e-3 and abs(res["info"]["signedR"]) == 750)
    trs = [e for e in res["elements"] if e["elementType"] == 2]
    ok(f"{label}: the chain carries those lengths", sorted(e["length"] for e in trs) == [28.0, 36.0])
    ok(f"{label}: chain holds ({chain_holds(res['elements'])})", chain_holds(res["elements"]) is None)
res = splice_payload({**sbss, "modeDep": "minimum", "modeArr": "minimum", "dep": sbss_arc, "arr": sbss_straight})
ok("SBSS at the Mindestlänge: 22.4 and 28.8 m",
   "error" not in res and [x["length"] for x in res["lengths"]] == [22.4, 28.8])
res = splice_payload({**sbss, "modeArr": "fixed", "lArr": 50, "dep": sbss_arc, "arr": sbss_straight})
ok("SBSS, the arrival fixed at 50 m: kept, the departure still 28.0 m",
   "error" not in res and [x["length"] for x in res["lengths"]] == [28.0, 50.0]
   and res["lengths"][1]["mode"] == "fixed")
res = splice_payload({**sbss, "speed": 0, "dep": sbss_arc, "arr": sbss_straight})
ok("SBSS without a speed: the lengths as given, no rule to say otherwise",
   "error" not in res and [x["length"] for x in res["lengths"]] == [60.0, 60.0]
   and res["lengths"][0]["regular"] is None)
res = splice_payload({**sbss, "modeDep": "fixed", "modeArr": "fixed", "lDep": 400, "lArr": 400,
                      "dep": sbss_arc, "arr": sbss_straight})
ok("SBSS with 400 m transitions: no fit, the rules' lengths all the same (28.0 and 36.0 m)",
   "error" in res and [x.get("regular") for x in res.get("lengths", [])] == [28.0, 36.0]
   and [x.get("minimum") for x in res["lengths"]] == [22.4, 28.8])
res = splice_payload({**sbss, "radius": 20000, "dep": sbss_straight, "arr": sbss_arc})
ok("SBSS at R 20000: no fit even without transitions, the reverse curve the stricter (100.0 m)",
   "error" in res and [x.get("regular") for x in res.get("lengths", [])] == [36.0, 100.0])
res = splice_payload({**sbss, "lDep": 0, "lArr": 0, "radius": 20000, "dep": sbss_arc, "arr": sbss_straight})
ok("…without transitions: none offered", "error" in res and all(x.get("regular") is None for x in res["lengths"]))


# ── what would fit, where nothing does (AP S.5) ──────────────────────────────
res = splice_payload({"dep": dep_5550, "arr": arr_5550, "radius": 500})
r_min = res.get("params", {}).get("rMin")
ok(f"line 5550 at R 500: names the smallest radius that fits ({r_min})", r_min is not None and 500 < r_min < 700)
ok("line 5550: …which fits", "error" not in splice_payload({"dep": dep_5550, "arr": arr_5550, "radius": r_min}))
ok("line 5550: …and a metre less does not",
   "error" in splice_payload({"dep": dep_5550, "arr": arr_5550, "radius": r_min - 1}))

res = splice_payload({"dep": a, "arr": b, "radius": 300, "lDep": 400, "lArr": 400})
l_max = res.get("params", {}).get("lMax")
ok(f"corner with 400 m transitions: names the longest that fit ({l_max})", l_max is not None and 100 < l_max < 300)
ok("corner: …transitions that long fit",
   "error" not in splice_payload({"dep": a, "arr": b, "radius": 300, "lDep": l_max, "lArr": l_max}))
ok("corner: …a decimetre longer do not",
   "error" in splice_payload({"dep": a, "arr": b, "radius": 300, "lDep": l_max + 0.2, "lArr": l_max + 0.2}))

r1, r2 = 900.0, -700.0
A, bA = arc_step(P0, 20.0, 250.0, r1)
S1, bS1 = trans_step(A, bA, 70.0, r1, None)
S2 = along(S1, bS1, 120.0)
B, bB = trans_step(S2, bS1, 70.0, None, r2)
C, _ = arc_step(B, bB, 200.0, r2)
arcs_req = {"dep": pick(P0, A, bA, r1), "arr": pick(C, B, (bB + 180.0) % 360.0, -r2)}
answer = _payload({**arcs_req, "lDep": 200, "lArr": 200})
l_max = answer.get("requested", {}).get("params", {}).get("lMax")
ok(f"arcs by a straight, transitions of 200 m: says they do not fit, and the longest that do ({l_max})",
   answer.get("requested", {}).get("error") == "splice_error_clothoid_too_long" and l_max is not None and 70 <= l_max < 200)
ok("…and offers the one transition from arc to arc instead",
   [x["arcJoin"] for x in answer.get("solutions", [])] == ["transition"])
ok("arcs by a straight: …which fit",
   "error" not in splice_payload({**arcs_req, "lDep": l_max, "lArr": l_max}))

# Two arcs joined over a straight, asked for one transition from arc to arc:
# the geometry has a straight between them, so no transition fits — the
# straight comes as the other way to join them, with transitions at the
# Regellänge where none were asked for (Entscheidung 183).
answer = _payload({**arcs_req, "arcJoin": "transition", "speed": 100,
                   "dep": {**arcs_req["dep"], "speed": 100, "cant": 40},
                   "arr": {**arcs_req["arr"], "speed": 100, "cant": 40}})
sols = answer.get("solutions", [])
ok("arcs asked for one transition where only a straight fits: the straight is offered",
   len(sols) >= 1 and sols[0]["arcJoin"] == "straight" and sols[0]["alternative"] is True)
if sols:
    ok("…with transitions at the Regellänge", [x["mode"] for x in sols[0]["lengths"]] == ["regular", "regular"]
       and all(x["length"] > 0 for x in sols[0]["lengths"]))
    ok(f"…chain holds ({chain_holds(sols[0]['elements'])})", chain_holds(sols[0]["elements"]) is None)

# A compound curve joined directly, the transition far too short for 120 km/h:
# the straight between the two arcs is the other way, judged on its own.
A, bA = arc_step(P0, 20.0, 300.0, 1000.0)
B, bB = trans_step(A, bA, 30.0, 1000.0, 600.0)
C, _ = arc_step(B, bB, 250.0, 600.0)
answer = _payload({"dep": {**pick(P0, A, bA, 1000.0), "speed": 120, "cant": 60},
                   "arr": {**pick(C, B, (bB + 180.0) % 360.0, -600.0), "speed": 120, "cant": 100},
                   "arcJoin": "transition", "speed": 120})
sols = answer.get("solutions", [])
direct = [x for x in sols if x.get("arcJoin") == "transition"]
ok("compound curve, a transition too short: found, and judged an error",
   len(direct) == 1 and direct[0]["worst"] == "error" and abs(direct[0]["info"]["transitionLength"] - 30.0) < 1e-3)
ok("…every solution ranked by what is found first",
   [x["worst"] for x in sols] == sorted([x["worst"] for x in sols], key=lambda w: ["ok", "hint", "warning", "approval", "special_case", "error"].index(w)))


# ── a transition at the end of its track (AP S.7) ───────────────────────────
# The pick is the point the transition ends in: no length, the bearing and the
# curvature there, joined at that end only. Whatever is built from it is new;
# the transition stays.
T0, bT0 = trans_step(P0, 90.0, 60.0, None, 500.0)          # a track ending in R 500
end_in_arc = {"start": list(T0), "end": list(T0), "bearing": bT0, "radius": 500.0, "joinAt": "end"}
# Built on from there: 50 m more of R 500, then 150 m of R 800 the other way, then a straight.
on_arc, b_on = arc_step(T0, bT0, 50.0, 500.0)
arc_end, b_arc = arc_step(on_arc, b_on, 150.0, -800.0)
far = along(arc_end, b_arc, 30.0)
off = {"start": list(far), "end": list(along(far, b_arc, 200.0)), "bearing": b_arc, "radius": None}
answer = _payload({"dep": off, "arr": end_in_arc, "radius": 800})
sol = answer.get("solutions", [{}])[0]
ok("a track ending in a transition into R 500: joined at that end only, whichever was clicked first",
   "error" not in answer and sol.get("depPick") == 1 and sol.get("reverseDep") is False)
if "error" not in answer:
    els = sol["elements"]
    ok("…the chain starts where the transition ends, on its curvature, and finds what was built",
       near(els[0]["startNode"], T0, 1e-6) and abs(turn(els[0]["bearing"], bT0)) < 1e-6
       and els[0]["elementType"] == 1 and els[0]["radius"] == 500.0 and abs(els[0]["length"] - 50.0) < 1e-3
       and abs(sol["info"]["arcLength"] - 150.0) < 1e-3)
    ok(f"…and holds ({chain_holds(els)})", chain_holds(els) is None)
T1, bT1 = trans_step(P0, 90.0, 60.0, 400.0, None)          # a track ending out of a curve
end_straight = {"start": list(T1), "end": list(T1), "bearing": bT1, "radius": None, "joinAt": "end"}
corner_arr = {"start": list(along(along(T1, bT1, 300.0), bT1 - 90.0, -150.0)),
              "end": list(along(along(T1, bT1, 300.0), bT1 - 90.0, -400.0)), "bearing": (bT1 + 90.0) % 360.0,
              "radius": None}
answer = _payload({"dep": end_straight, "arr": corner_arr, "radius": 200})
sol = answer.get("solutions", [{}])[0]
ok("a track ending in a transition out of a curve: a corner from its end",
   "error" not in answer and sol.get("depPick") == 0 and near(sol["elements"][0]["startNode"], T1, 1e-6)
   and chain_holds(sol["elements"]) is None)
answer = _payload({"dep": {**end_straight, "joinAt": "start"}, "arr": corner_arr, "radius": 200})
ok("…never joined backwards into the transition", "error" in answer
   or all(x["ends"][0] == "start" for x in answer["solutions"]))


# ── a transition on one side only, and each side its own shape ───────────────
res = splice_payload({"dep": a, "arr": b, "radius": 300, "lDep": 60, "lArr": 0})
ok("corner, transition on the departure only: 0 2 1 0",
   "error" not in res and [e["elementType"] for e in res["elements"]] == [0, 2, 1, 0]
   and chain_holds(res["elements"]) is None)
res = splice_payload({"dep": a, "arr": b, "radius": 300, "lDep": 60, "lArr": 40,
                      "transitionDep": "bloss", "transitionArr": "clothoid"})
ok("corner, Bloss beside the departure, clothoid beside the arrival",
   "error" not in res and [e.get("transitionType") for e in res["elements"] if e["elementType"] == 2] == ["bloss", "clothoid"]
   and chain_holds(res["elements"]) is None)
# The shapes belong to the picks, not to which one the solution departs from.
res = splice_payload({"dep": c, "arr": a, "radius": 300, "lDep": 40, "lArr": 60,
                      "transitionDep": "clothoid", "transitionArr": "bloss"})
if "error" not in res:
    a_role = "dep" if res["depPick"] == 1 else "arr"
    els = res["elements"]
    k = next(i for i, e in enumerate(els) if e["role"] == a_role)
    beside_a = els[k + 1] if a_role == "dep" else els[k - 1]
    ok("corner, clicked the other way: the Bloss stays beside its pick",
       beside_a["elementType"] == 2 and beside_a["transitionType"] == "bloss" and beside_a["length"] == 60
       and chain_holds(els) is None)
else:
    ok("corner, clicked the other way: the Bloss stays beside its pick", False)

# Two arcs over a straight, a Bloss curve of 70 m out of the first and a
# clothoid of 50 m into the second: the straight between is found back.
L1, L2 = 70.0, 50.0
A, bA = arc_step(P0, 20.0, 250.0, r1)
S1, bS1 = trans_step(A, bA, L1, r1, None, "bloss")
S2 = along(S1, bS1, 120.0)
B, bB = trans_step(S2, bS1, L2, None, r2)
C, _ = arc_step(B, bB, 200.0, r2)
arcs_mixed = {"dep": pick(P0, A, bA, r1), "arr": pick(C, B, (bB + 180.0) % 360.0, -r2),
              "lDep": L1, "lArr": L2, "transitionDep": "bloss", "transitionArr": "clothoid"}
res = splice_payload(arcs_mixed)
ok("arcs by a straight, Bloss and clothoid: the straight found back",
   "error" not in res and abs(res["info"]["straightLength"] - 120.0) < 1e-4
   and [e.get("transitionType") for e in res["elements"] if e["elementType"] == 2] == ["bloss", "clothoid"]
   and chain_holds(res["elements"]) is None)
# The same with the second transition left out.
B0 = S2
C0, _ = arc_step(B0, bS1, 200.0, r2)
res = splice_payload({**arcs_mixed, "arr": pick(C0, B0, (bS1 + 180.0) % 360.0, -r2), "lArr": 0})
ok("arcs by a straight, a Bloss curve on the first side only: 1 2 0 1, the straight found back",
   "error" not in res and [e["elementType"] for e in res["elements"]] == [1, 2, 0, 1]
   and abs(res["info"]["straightLength"] - 120.0) < 1e-4 and chain_holds(res["elements"]) is None)

# An arc and a straight: a Bloss curve out of the old arc, none onto the straight.
A, bA = arc_step(P0, 20.0, 300.0, 900.0)
B, bB = trans_step(A, bA, 80.0, 900.0, -400.0, "bloss")
D, bD = arc_step(B, bB, 160.0, -400.0)
E = along(D, bD, 200.0)
res = splice_payload({"dep": pick(P0, A, bA, 900.0), "arr": pick(E, D, (bD + 180.0) % 360.0), "radius": 400,
                      "lDep": 80, "lArr": 0, "transitionDep": "bloss"})
ok("arc to straight, a Bloss curve on the arc's side only: the arc of 160 m found back",
   "error" not in res and res["info"]["signedR"] == -400 and abs(res["info"]["arcLength"] - 160.0) < 1e-3
   and [e["elementType"] for e in res["elements"]] == [1, 2, 1, 0] and res["elements"][1]["transitionType"] == "bloss"
   and chain_holds(res["elements"]) is None)
try:
    splice_payload({"dep": a, "arr": b, "radius": 300, "lDep": 60, "transitionDep": "spiral"})
    ok("an unknown shape: refused", False)
except ValueError:
    ok("an unknown shape: refused", True)


# ── what a malformed request does ────────────────────────────────────────────
try:
    splice_payload({"dep": {"start": [0, 0]}, "arr": b, "radius": 300})
    ok("a pick without its end: refused", False)
except (ValueError, KeyError, TypeError):
    ok("a pick without its end: refused", True)

print()
print("FAILED: " + ", ".join(FAILED) if FAILED else "all passed")
sys.exit(1 if FAILED else 0)
