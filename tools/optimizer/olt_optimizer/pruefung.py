"""The rule catalogue applied to an element chain — the app's
src/core/utils/trassierungCheck.js, ported. The shared vectors
(src/core/constraints/tests/checks.json, tests/vectors.py) hold the two alike.

The splice (splice.py, Paket S) judges the chain it proposes with it, and
finds the lengths of the transitions it inserts from the scope it fills
(grenzen.transition_lengths). For the optimizer's acceptance it is the
independent half of the check. grenzen.py derives the bounds a
run builds to; this judges what the run built, the way the app's element
table does — every rule, full scopes, severities — without asking grenzen.py
anything. A run that obeys its own bounds but lands on a finding the table
would show is exactly what it is here to catch.

Like the app it fills the scope from the elements and nothing else: a
transition's cant at its ends is its neighbours' (transitionCantEnds), the
deficiency is rounded to the millimetre (computeCantDefSigned).
"""

import math

CANT_DEF_COEFF = 11.8
CURVATURE_EPS = 1e-6
TYPE_BY_ELEMENT_TYPE = {0: "straight", 1: "circular_arc", 2: "transition_curve"}


def _is_transition(el):
    return el.get("elementType") == 2


def _form(el):
    if not _is_transition(el):
        return None
    return "bloss" if el.get("transitionType") == "bloss" else "clothoid"


def _curv(r):
    return 1.0 / r if r else 0.0


def _k_start(el):
    return _curv(el.get("r1") if _is_transition(el) else el.get("radius"))


def _k_end(el):
    return _curv(el.get("r2") if _is_transition(el) else el.get("radius"))


def _cant_ends(els, i):
    el = els[i]
    if not _is_transition(el):
        c = el.get("cant") or 0.0
        return c, c
    start = el.get("cantStart", (els[i - 1].get("cant") if i > 0 else None) or 0.0)
    end = el.get("cantEnd", (els[i + 1].get("cant") if i + 1 < len(els) else None) or 0.0)
    return start, end


def _deficiency(v, radius, cant):
    if not radius:
        return 0.0
    r = abs(radius)
    # Math.round: half up, not Python's half-to-even.
    return math.floor(CANT_DEF_COEFF * v * v / r - (cant or 0.0) * math.copysign(1.0, radius) + 0.5)


def element_scope(els, i):
    el = els[i]
    prev = els[i - 1] if i > 0 else None
    nxt = els[i + 1] if i + 1 < len(els) else None
    v = el.get("speed") or 0.0
    start, end = _cant_ends(els, i)
    du = abs(end - start)
    # Signed with the curve like the cant: across a reverse transition the
    # deficiency changes sides, and the ramp carries the sum.
    side = lambda r, c: math.copysign(1.0, r) * _deficiency(v, r, c) if r else 0.0   # noqa: E731
    duf = abs(side(el.get("r2"), end) - side(el.get("r1"), start)) if _is_transition(el) else 0.0
    return {
        "element.design_speed": v,
        "element.length": el.get("length") or 0.0,
        "element.cant": abs(el.get("cant") or 0.0),
        "element.radius": abs(el.get("radius") or 0.0),
        "element.transition_form": _form(el) or "",
        "prev.design_speed": prev["speed"] if prev and prev.get("speed") is not None else v,
        "next.design_speed": nxt["speed"] if nxt and nxt.get("speed") is not None else v,
        "physics.u_f": _deficiency(v, el["radius"], el.get("cant") or 0.0) if el.get("radius") else 0.0,
        "physics.delta_u": du,
        "physics.delta_u_f": duf,
        "physics.ramp_slope": 1000.0 * (el.get("length") or 0.0) / du if du > 0 else math.inf,
        "model.reverse_curve_straight": (
            el.get("elementType") == 0 and prev is not None and nxt is not None
            and abs(_k_end(prev)) > CURVATURE_EPS and abs(_k_start(nxt)) > CURVATURE_EPS
            and math.copysign(1, _k_end(prev)) != math.copysign(1, _k_start(nxt))),
    }


def boundary_scope(els, i):
    a, b = els[i], els[i + 1]
    step = abs(_k_end(a) - _k_start(b))
    jump = step > CURVATURE_EPS
    return {
        "prev.cant_end": _cant_ends(els, i)[1],
        "next.cant_start": _cant_ends(els, i + 1)[0],
        "prev.design_speed": a.get("speed") or 0.0,
        "next.design_speed": b.get("speed") or 0.0,
        "physics.curvature_jump": jump,
        "physics.r_w": 1.0 / step if jump else math.inf,
    }


def _in_switch(el):
    return el.get("switchId") is not None


def _apply(katalog, rules, base, in_context=None, excluded=()):
    out = []
    for rule in rules:
        if set((rule.get("applies_to") or {}).get("excludes") or []) & set(excluded):
            continue
        res = katalog.evaluate_rule(rule, base, in_context)
        if res["applied"]:
            out.append((rule["id"], res["severity"]))
    return out


def check_track(katalog, els, only=None):
    """[(where, rule id, severity)] for every rule applied to the chain.
    `only`: indices of the elements to judge (boundaries count where either
    side is one of them); all of them when None."""
    only = set(range(len(els))) if only is None else set(only)
    findings = []
    for i, el in enumerate(els):
        if i not in only or not el.get("speed"):
            continue
        etype = TYPE_BY_ELEMENT_TYPE.get(el.get("elementType"), "straight")
        ctx = (lambda cid, el=el: cid == "switch_area" and _in_switch(el))
        base = element_scope(els, i)
        for rid, sev in _apply(katalog, katalog.rules_for_element(etype, _form(el)), base, ctx):
            findings.append((f"#{i}", rid, sev))
        if _is_transition(el) and base["physics.delta_u"] > 0:
            ramp = {"model.ramp_on_transition": True, "model.ramp_form_matches": _form(el) == "clothoid"}
            for rid, sev in _apply(katalog, katalog.rules_for_scope("cant_ramp"), ramp):
                findings.append((f"#{i}", rid, sev))
    for i in range(len(els) - 1):
        a, b = els[i], els[i + 1]
        if not ({i, i + 1} & only) or not a.get("speed") or not b.get("speed"):
            continue
        internal = _in_switch(a) and _in_switch(b) and a["switchId"] == b["switchId"]
        ctx = (lambda cid, a=a, b=b: cid == "switch_area" and (_in_switch(a) or _in_switch(b)))
        for rid, sev in _apply(katalog, katalog.rules_for_scope("boundary"), boundary_scope(els, i),
                               ctx, ["switch_internal"] if internal else []):
            findings.append((f"#{i}|#{i + 1}", rid, sev))
    return findings


def new_indices(old_els, new_els, tol=1e-6):
    """The elements of `new_els` that are not simply an element of `old_els`
    passed through — what a run proposed, and so what it answers for."""
    def key(el):
        return (round(el["startNode"][0] / tol), round(el["startNode"][1] / tol),
                round(el["endNode"][0] / tol), round(el["endNode"][1] / tol),
                el.get("elementType"), el.get("radius"), el.get("speed"))
    old = {key(el) for el in old_els}
    return [i for i, el in enumerate(new_els) if key(el) not in old]
