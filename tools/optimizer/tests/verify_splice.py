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
from olt_optimizer.splice import splice_payload                          # noqa: E402

FAILED = []


def ok(label, cond):
    print(("PASS " if cond else "FAIL ") + label)
    if not cond:
        FAILED.append(label)


def near(a, b, tol):
    return math.hypot(a[0] - b[0], a[1] - b[1]) < tol


def turn(a, b):
    return ((b - a + 180.0) % 360.0 + 360.0) % 360.0 - 180.0


def chain_holds(els, tol=1e-4):
    """Each element true to its figures, each junction closed and without a kink."""
    for i, el in enumerate(els):
        s, e, b, length = el["startNode"], el["endNode"], el["bearing"], el["length"]
        if el["elementType"] == 0:
            end = (s[0] + length * math.sin(math.radians(b)), s[1] + length * math.cos(math.radians(b)))
            end_b = b
        elif el["elementType"] == 1:
            end, end_b = _arc_forward(s[0], s[1], b, el["radius"], length / abs(el["radius"]))
        else:
            x, y, end_b = transition_end(s[0], s[1], b, length, el["r1"], el["r2"], el["transitionType"])
            end = (x, y)
        if not near(end, e, tol):
            return f"element {i} ends {math.hypot(end[0] - e[0], end[1] - e[1]):.6f} m off its endNode"
        if abs(turn(end_b, el.get("endBearing", b))) > 1e-4:
            return f"element {i} end bearing off by {turn(end_b, el.get('endBearing', b)):.6f}°"
        if i + 1 < len(els):
            nxt = els[i + 1]
            if not near(e, nxt["startNode"], 1e-6):
                return f"gap after element {i}"
            if abs(turn(el.get("endBearing", b), nxt["bearing"])) > 1e-4:
                return f"kink after element {i}: {turn(el.get('endBearing', b), nxt['bearing']):.6f}°"
    return None


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
ok("corner, arrival folded in: ends at the arrival's start",
   near(res["elements"][-1]["endNode"], c["start"], 1e-9) and chain_holds(res["elements"]) is None)


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
    ok("straight to arc: starts on the straight, ends on the arc run backwards",
       els[0]["elementType"] == 0 and els[-1]["radius"] == -900.0)
    ok("straight to arc: from the straight's start to the arc's start",
       near(els[0]["startNode"], E, 1e-6) and near(els[-1]["endNode"], P0, 1e-6))
    ok(f"straight to arc: chain holds ({chain_holds(els)})", chain_holds(els) is None)

A, bA, D, bD, E = mixed_chain(ld=0.0, la=0.0)
res = splice_payload({"dep": pick(P0, A, bA, 900.0), "arr": pick(E, D, (bD + 180.0) % 360.0), "radius": 400})
ok("arc to straight without transitions: three elements", "error" not in res and len(res["elements"]) == 3)
ok(f"arc to straight without transitions: chain holds ({chain_holds(res.get('elements', []))})",
   "error" not in res and chain_holds(res["elements"]) is None)


# ── what a malformed request does ────────────────────────────────────────────
try:
    splice_payload({"dep": {"start": [0, 0]}, "arr": b, "radius": 300})
    ok("a pick without its end: refused", False)
except (ValueError, KeyError, TypeError):
    ok("a pick without its end: refused", True)

print()
print("FAILED: " + ", ".join(FAILED) if FAILED else "all passed")
sys.exit(1 if FAILED else 0)
