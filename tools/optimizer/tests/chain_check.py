"""What every test of a constructed chain asks of it: each element true to
its own figures, each junction closed and without a kink. Shared by
verify_splice.py and verify_align.py."""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from olt_optimizer.geometry import _arc_forward, transition_end          # noqa: E402


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
