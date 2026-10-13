"""Writes src/local/splice/serviceAnswers.json: what the service answers to
splices without transitions, for the local build's simplified splice
(src/local/splice/localSplice.js, decision 293) to be held against
(localSplice.test.js). The geometries are those of the property bench
(verify_splice_props.py) — two straights, an arc and a straight, two arcs over
a straight — asked without transitions, in every way a user can ask them: both
click orders, each track stored in either direction. Run again after changing
splice.py:

    .venv/bin/python tools/optimizer/tests/local_splice_fixture.py [--n 10] [--seed 7]

With --check it writes nothing and fails where the service now answers other
than the file says — splice.py changed in a way the local splice has not
followed (CI runs it so).
"""

import argparse
import json
import os
import pathlib
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from olt_optimizer.splice import splice_payload                                       # noqa: E402
from verify_splice_props import case_arc_straight, case_arcs_straight, case_straights, flipped, service_pick  # noqa: E402

FAMILIES = [case_straights, case_arc_straight, case_arcs_straight]


def trimmed(answer):
    """What the local splice is compared on: the solutions joined the way asked
    for (not the service's alternative of one transition from arc to arc), each
    by its ends, direction, cost and chain — or the error with what would fit."""
    plain = [s for s in answer.get("solutions", []) if not s.get("alternative")]
    if not plain:
        err = answer.get("requested") or answer
        return {"error": err["error"], "params": {k: v for k, v in err.get("params", {}).items() if k in ("rMax", "rMin")}}
    return {"solutions": [{
        "ends": s["ends"], "depPick": s["depPick"], "reverseDep": s["reverseDep"], "reverseArr": s["reverseArr"],
        "rebuilt": s["rebuilt"],
        "elements": [{k: el[k] for k in ("elementType", "role", "startNode", "endNode", "radius") if k in el}
                     for el in s["elements"]],
    } for s in plain]}


def differs(old, new, path="answer"):
    """Where two answers part, beyond the rounding of another platform: nodes
    and lengths to 1e-6, a radius that would fit to the metre — or None."""
    if isinstance(old, dict) and isinstance(new, dict):
        if old.keys() != new.keys():
            return f"{path}: {sorted(old)} != {sorted(new)}"
        for k in old:
            tol = 1.0 if k in ("rMax", "rMin") else None
            d = differs(old[k], new[k], f"{path}.{k}") if tol is None else (
                None if abs(old[k] - new[k]) <= tol else f"{path}.{k}: {old[k]} != {new[k]}")
            if d:
                return d
        return None
    if isinstance(old, list) and isinstance(new, list):
        if len(old) != len(new):
            return f"{path}: {len(old)} != {len(new)} entries"
        return next((d for i, (a, b) in enumerate(zip(old, new)) if (d := differs(a, b, f"{path}[{i}]"))), None)
    if isinstance(old, float) or isinstance(new, float):
        return None if abs(old - new) <= 1e-6 * max(1.0, abs(old)) else f"{path}: {old} != {new}"
    return None if old == new else f"{path}: {old!r} != {new!r}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=10)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    rng = random.Random(args.seed)
    cases = []
    for family in FAMILIES:
        made = 0
        while made < args.n:
            case = family(rng)
            if case is None:
                continue
            made += 1
            req = {**case["req"], "lDep": 0, "lArr": 0, "arcJoin": "straight"}
            dep, arr = case["dep"], case["arr"]
            for way, (p, q) in {"asBuilt": (dep, arr), "clickedBack": (arr, dep),
                                "depStoredBack": (flipped(dep), arr), "arrStoredBack": (dep, flipped(arr))}.items():
                request = {**req, "dep": service_pick(p), "arr": service_pick(q)}
                cases.append({"name": f"{case['kind']} #{made} {way}", "request": request,
                              "answer": trimmed(splice_payload(request))})
            if req["radius"]:
                # A radius far too large: what would fit instead.
                request = {**req, "radius": req["radius"] * 15, "dep": service_pick(dep), "arr": service_pick(arr)}
                cases.append({"name": f"{case['kind']} #{made} tooLarge", "request": request,
                              "answer": trimmed(splice_payload(request))})
    path = pathlib.Path(__file__).resolve().parents[3] / "src" / "local" / "splice" / "serviceAnswers.json"
    if args.check:
        stored = json.loads(path.read_text(encoding="utf-8"))
        problems = [f"{new['name']}: {d}" for old, new in zip(stored, cases)
                    if (d := differs(old["request"], new["request"], "request") or differs(old["answer"], new["answer"]))]
        if len(stored) != len(cases):
            problems.append(f"{len(stored)} cases stored, {len(cases)} made")
        if problems:
            print("The service answers other than src/local/splice/serviceAnswers.json — splice.py changed;"
                  " follow it in src/local/splice/localSplice.js and write the file again:")
            print("\n".join(f"  {p}" for p in problems[:10]))
            sys.exit(1)
        print(f"local splice answers: {len(cases)} cases as stored")
        return
    path.write_text(json.dumps(cases, separators=(",", ":")) + "\n", encoding="utf-8")
    print("wrote", path, len(cases), "cases,", sum("error" in c["answer"] for c in cases), "errors")


if __name__ == "__main__":
    main()
