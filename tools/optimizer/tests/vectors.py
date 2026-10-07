"""The shared test vectors (src/constraints/tests/) against the Python side.

The app (ruleExpr.js, trassierungCheck.js, rules/transitionLength.js) and this
package (ruleexpr.py, olt_optimizer/pruefung.py, grenzen.transition_lengths)
implement the same expression language, the same catalogue check and the same
shortest transition lengths twice. The vectors are one set of cases both have
to answer alike; the app's half is src/utils/ruleExpr.vectors.test.js,
src/utils/trassierungCheck.vectors.test.js and
src/utils/rules/transitionLength.vectors.test.js.

    python tests/vectors.py        (exit code 1 on the first difference)
"""

import json
import math
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from olt_optimizer.grenzen import transition_lengths              # noqa: E402
from olt_optimizer.regelwerk import CONSTRAINTS_DIR, load_katalog  # noqa: E402
from olt_optimizer.ruleexpr import ExprError, eval_expr            # noqa: E402
from olt_optimizer.pruefung import check_track                              # noqa: E402

VECTORS = CONSTRAINTS_DIR / "tests"

FNS = {
    "min": min,
    "max": max,
    "abs": abs,
    "round_to": lambda x, step: math.floor(x / step + 0.5) * step,
}

failures = []


def expressions():
    data = json.loads((VECTORS / "expressions.json").read_text(encoding="utf-8"))
    for case in data["cases"]:
        src, scope = case["src"], case.get("scope", {})
        try:
            got = eval_expr(src, scope, FNS)
        except ExprError:
            got = "<error>"
        want = "<error>" if case.get("error") else case["value"]
        same = got == want if not isinstance(want, float) else (
            isinstance(got, (int, float)) and abs(got - want) <= 1e-9 * max(1, abs(want)))
        if isinstance(want, bool) or isinstance(got, bool):
            same = type(got) is type(want) and got == want
        if not same:
            failures.append(f"expression {src!r}: want {want!r}, got {got!r}")
    return len(data["cases"])


def checks():
    data = json.loads((VECTORS / "checks.json").read_text(encoding="utf-8"))
    katalog = load_katalog(data["catalogue"])
    for chain in data["chains"]:
        got = sorted([list(f) for f in check_track(katalog, chain["elements"])],
                     key=lambda f: json.dumps(f, separators=(",", ":"), ensure_ascii=False))
        want = sorted(chain["findings"], key=lambda f: json.dumps(f, separators=(",", ":"), ensure_ascii=False))
        if got != want:
            missing = [f for f in want if f not in got]
            extra = [f for f in got if f not in want]
            failures.append(f"chain {chain['name']!r}: missing {missing[:5]}, extra {extra[:5]}")
    return len(data["chains"])


def lengths():
    data = json.loads((VECTORS / "transition_lengths.json").read_text(encoding="utf-8"))
    for case in data["cases"]:
        got = transition_lengths(case["prev"], case["next"], case["r1"], case["type"], case["speed"],
                                 data["catalogue"])
        for key in ("regular", "minimum"):
            if got[key] != case[key] and not (got[key] is not None and case[key] is not None
                                              and abs(got[key] - case[key]) < 1e-9):
                failures.append(f"transition {case['name']!r}: {key} want {case[key]}, got {got[key]}")
            rows = [[b["id"], b["length"], b["binding"]] for b in got[f"{key}By"]]
            want = case[f"{key}By"]
            if len(rows) != len(want) or any(a[0] != b[0] or abs(a[1] - b[1]) > 1e-6 or a[2] != b[2]
                                             for a, b in zip(rows, want)):
                failures.append(f"transition {case['name']!r}: {key}By want {want}, got {rows}")
    return len(data["cases"])


if __name__ == "__main__":
    n_expr = expressions()
    n_chain = checks()
    n_len = lengths()
    for f in failures:
        print("FAIL", f)
    print(f"{n_expr} expressions, {n_chain} chains, {n_len} transition lengths: "
          f"{'ok' if not failures else f'{len(failures)} failing'}")
    sys.exit(1 if failures else 0)
