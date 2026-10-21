"""Solving a switch connection — "Weichenverbindung lösen" (Paket WV, Entscheidungen 357–358).

The app's dialog lays a switch connection (two turnouts facing each other on
two tracks, one or more elements between their branches) with the toe of the
first turnout on a slider; the second turnout and the element between follow.
Where no position of the slider gives a connection that keeps the rules, it
asks here. This search may move **both** toes on the elements they were picked
on, independently, and choose **one to three elements** between the branches —
straights, arcs and transitions, a transition running between the curvatures
of its neighbours as in the dialog (Entscheidung 305).

The turnout geometry is not computed here (Entscheidung 358): the app samples
both branch ends over the elements, for every form its speed falls back
through, and sends them with the limits its dialog holds the middle to. Each
sample is a point, a tangent and a curvature at B1E (first turnout) or B2A
(second), in the direction the connection runs; this module interpolates them
and closes a chain of elements between the two:

    chain(B1E(s1), pieces) = B2A(s2)        position and tangent, three equations

over s1, s2 and the open values of the pieces — lengths, and the curvature of
each arc — held to

* l_min (LP.EL.01) for every element, a straight counted with a straight end
  piece of the branch it runs on from (Entscheidung 356);
* the comparison radius (LP.KS.01) at every joint with a jump in curvature,
  1/|Δκ| at least the Ermessensgrenze; under the Regelwert is a hint, which
  the search avoids where it can;
* the cant deficiency of every piece at the cant of the middle — the mean of
  both turnouts' cant at the ldS — and those two cants agreeing;
* each turnout where its own checks hold (the samples' `ok`).

SLSQP from a few starts per sequence of elements; among what closes, per
sequence the one nearest the click (s1 = 0), with the gentlest curvature and
the shortest length as tie-breakers. Answers best first: without a hint before
with one, fewer elements before more, nearer the click before farther away.
The app solves an adopted answer again with its own geometry.
"""

import bisect
import math
import time

import numpy as np
from scipy.interpolate import CubicSpline
from scipy.optimize import least_squares, minimize

# The sequences of middle elements tried, fewest first. A lone straight or a
# lone transition has a single value and cannot be solved in the dialog
# (two open values beside the second toe), two straights in a row are one.
TEMPLATES = (
    ("arc",),
    ("arc", "arc"), ("straight", "arc"), ("arc", "straight"),
    ("transition", "arc"), ("arc", "transition"), ("transition", "transition"),
    ("straight", "transition"), ("transition", "straight"),
    ("arc", "straight", "arc"), ("transition", "straight", "transition"),
    ("transition", "arc", "transition"), ("arc", "transition", "arc"),
    ("arc", "arc", "arc"), ("straight", "arc", "straight"),
)

# Shorter than this an element is none [m] (the app's MID_ROOM).
ROOM = 1e-3
# Curvatures this close are one [1/m] (the app's SAME_CURVATURE).
SAME_K = 1e-6
# An arc's curvature is a variable in 1/km, so it weighs like a length.
K_SCALE = 1e3
# The sharpest arc searched [1/m].
K_MAX = 1 / 50.0
# How close a solution has to close [m, rad] — the app closes it to 1e-8 m again.
CLOSE_POS = 1e-4
CLOSE_ANGLE = 1e-6
# Margins kept inside the limits, so the app's own rounding — and the values
# it rounds when it adopts an answer — stay on the right side.
CANT_DEF_MARGIN = 0.5
CANT_TOL_MARGIN = 0.05
LENGTH_MARGIN = 0.01        # [m] above l_min
RW_MARGIN = 1e-3            # relative, above the Ermessensgrenze
# The middle elements together at most this long [m]: past it a connection is
# a stretch of new line, not a crossover (Entscheidung 357).
MAX_LENGTH = 200.0
# The whole search may take this long [s].
DEADLINE = 25.0
# This many answers at most.
MAX_SOLUTIONS = 8

GL_X, GL_W = np.polynomial.legendre.leggauss(16)


class BranchEnd:
    """One turnout's branch end over its toe station, interpolated from the
    app's samples: position, tangent and curvature smooth (one element under
    the turnout), the end run and the cant at the ldS piecewise linear, and the
    stretches where the turnout keeps its own checks. Evaluated by hand from
    the spline's pieces — the search asks a few hundred thousand times."""

    def __init__(self, samples):
        pts = sorted((p for p in samples if p is not None), key=lambda p: p["s"])
        if len(pts) < 2:
            raise ValueError("samples")
        s = np.array([float(p["s"]) for p in pts])
        if np.any(np.diff(s) <= 0):
            raise ValueError("samples")
        psi = np.unwrap(np.array([float(p["psi"]) for p in pts]))
        spline = CubicSpline(s, np.column_stack([
            [float(p["x"]) for p in pts], [float(p["y"]) for p in pts], psi]))
        self.s = s.tolist()
        # Per interval, per quantity (x, y, psi): the cubic's four coefficients.
        self._cubic = np.transpose(spline.c, (1, 2, 0)).tolist()
        self._kappa = [float(p["kappa"]) for p in pts]
        self._tail = [float(p.get("tail") or 0.0) for p in pts]
        self._cant = [float(p.get("cantLds") or 0.0) for p in pts]
        ok = [bool(p.get("ok")) for p in pts]
        self.intervals = []
        start = None
        for i, good in enumerate(ok + [False]):
            if good and start is None:
                start = i
            elif not good and start is not None:
                self.intervals.append((self.s[start], self.s[i - 1]))
                start = None

    def at(self, s):
        """(x, y, psi, kappa, tail, cantLds) at toe station s."""
        i = min(max(bisect.bisect_right(self.s, s) - 1, 0), len(self.s) - 2)
        d = s - self.s[i]
        x, y, psi = ((((a * d) + b) * d + c) * d + e for a, b, c, e in self._cubic[i])
        u = min(max(d / (self.s[i + 1] - self.s[i]), 0.0), 1.0)

        def lin(v):
            return v[i] + (v[i + 1] - v[i]) * u
        return x, y, psi, lin(self._kappa), lin(self._tail), lin(self._cant)


def piece_end(x, y, psi, length, k0, k1):
    """The end of a piece of linearly running curvature k0 → k1 laid from (x, y) on psi."""
    if abs(k1 - k0) < 1e-12:
        turn = k0 * length
        if abs(turn) < 1e-9:
            return x + length * math.cos(psi), y + length * math.sin(psi), psi
        return (x + (math.sin(psi + turn) - math.sin(psi)) / k0,
                y - (math.cos(psi + turn) - math.cos(psi)) / k0, psi + turn)
    t = (GL_X + 1.0) * (length / 2.0)
    theta = psi + k0 * t + (k1 - k0) * t * t / (2.0 * length)
    w = GL_W * (length / 2.0)
    return (x + float(np.dot(w, np.cos(theta))), y + float(np.dot(w, np.sin(theta))),
            psi + (k0 + k1) / 2.0 * length)


def _wrap(a):
    return (a + math.pi) % (2.0 * math.pi) - math.pi


class Template:
    """One sequence of middle elements and its variables: s1, s2, then per
    element its length and, for an arc, its curvature in 1/km."""

    def __init__(self, types):
        self.types = types
        self.slots = []                      # (element, 'length' | 'k')
        for i, kind in enumerate(types):
            self.slots.append((i, "length"))
            if kind == "arc":
                self.slots.append((i, "k"))

    def pieces(self, z, k_start, k_end):
        """[(length, k0, k1)] of the elements for the variables z (math-signed)."""
        values = {slot: z[2 + j] for j, slot in enumerate(self.slots)}
        parts = []
        for i, kind in enumerate(self.types):
            length = values[(i, "length")]
            k = values[(i, "k")] / K_SCALE if kind == "arc" else 0.0
            parts.append((kind, length, k))

        def k_of(j):
            if j < 0:
                return k_start
            if j >= len(parts):
                return k_end
            return 0.0 if parts[j][0] == "transition" else parts[j][2]

        out = []
        for i, (kind, length, k) in enumerate(parts):
            if kind == "transition":
                out.append((length, k_of(i - 1), k_of(i + 1)))
            else:
                out.append((length, k, k))
        return out


class Problem:
    """The connection between two branch ends under the dialog's limits."""

    def __init__(self, first, second, limits, speed):
        self.first, self.second = first, second
        self.speed = speed
        self.l_min = float(limits.get("lMin") or 0.0)
        reg, disc = limits.get("rwReg"), limits.get("rwDiscretion")
        self.k_reg = 1.0 / float(reg) if reg else None
        self.k_disc = 1.0 / (float(disc) * (1.0 + RW_MARGIN)) if disc else None
        self.max_def = float(limits.get("maxCantDef") or 0.0)
        self.def_coeff = float(limits.get("cantDefCoeff") or 11.8)
        self.cant_tol = float(limits.get("cantTol") or 1.0)
        self.max_length = float(limits.get("maxLength") or MAX_LENGTH)
        self._last = None

    def state(self, tpl, z):
        b1 = self.first.at(z[0])
        b2 = self.second.at(z[1])
        pieces = tpl.pieces(z, b1[3], b2[3])
        x, y, psi = b1[0], b1[1], b1[2]
        for length, k0, k1 in pieces:
            x, y, psi = piece_end(x, y, psi, max(length, ROOM), k0, k1)
        return b1, b2, pieces, (x, y, psi)

    def residual(self, tpl, z, state=None):
        _, b2, pieces, (x, y, psi) = state or self.state(tpl, z)
        scale = max(10.0, sum(abs(p[0]) for p in pieces))
        return np.array([x - b2[0], y - b2[1], _wrap(psi - b2[2]) * scale])

    def joints(self, tpl, b1, b2, pieces):
        """The jumps in curvature at the joints of the middle elements (signed Δκ)."""
        types = ("branch",) + tpl.types + ("branch",)
        ks = [(b1[3], b1[3])] + [(p[1], p[2]) for p in pieces] + [(b2[3], b2[3])]
        out = []
        for j in range(len(pieces) + 1):
            if types[j] == "transition" or types[j + 1] == "transition":
                continue
            out.append(ks[j + 1][0] - ks[j][1])
        return out

    def runs(self, tpl, b1, b2, pieces):
        """Each element's length as LP.EL.01 reads it: a straight at either
        end runs on into a straight end piece of the branch."""
        out = []
        n = len(pieces)
        for i, (length, _, _) in enumerate(pieces):
            run = length
            if tpl.types[i] == "straight":
                if i == 0 and abs(b1[3]) < SAME_K:
                    run += b1[4]
                if i == n - 1 and abs(b2[3]) < SAME_K:
                    run += b2[4]
            out.append(run)
        return out

    def deficiency(self, k, cant):
        """The cant deficiency of curvature k (math-signed) at the signed cant —
        the app's computeCantDefSigned with the project radius −1/k."""
        return self.def_coeff * self.speed ** 2 * abs(k) + cant * math.tanh(k * 1e5)

    def inequalities(self, tpl, z, state=None, scaled=False):
        """The limits as values ≥ 0 — with `scaled`, each brought to about one
        per unit that matters (a metre, a curvature step of 1e-4/m, 10 mm of
        deficiency, a millimetre of cant), as the penalty of the first phase
        weighs them."""
        b1, b2, pieces, _ = state or self.state(tpl, z)
        g, w = [], []
        if self.l_min > 0:
            g += [run - self.l_min - LENGTH_MARGIN for run in self.runs(tpl, b1, b2, pieces)]
            w += [1.0] * len(pieces)
        if self.k_disc is not None:
            for dk in self.joints(tpl, b1, b2, pieces):
                g += [self.k_disc - dk, self.k_disc + dk]
                w += [1e4, 1e4]
        cant = (b1[5] + b2[5]) / 2.0
        if self.max_def > 0:
            for _, k0, k1 in pieces:
                g += [self.max_def - CANT_DEF_MARGIN - self.deficiency(k, cant) for k in (k0, k1)]
                w += [0.1, 0.1]
        diff = b1[5] - b2[5]
        g += [self.cant_tol - CANT_TOL_MARGIN - diff, self.cant_tol - CANT_TOL_MARGIN + diff]
        w += [1.0, 1.0]
        g.append(self.max_length - sum(p[0] for p in pieces))
        w.append(0.1)
        g = np.array(g)
        return g * np.array(w) if scaled else g

    def penalty(self, tpl, z):
        """The first phase as least squares: the miss at the second branch,
        what the limits are short of (with a margin), and weakly, the wish to
        stand near the click on gentle curves."""
        st = self.state(tpl, z)
        b1, b2, pieces, _ = st
        miss = self.residual(tpl, z, st) * 100.0
        short = np.maximum(0.0, 0.01 - self.inequalities(tpl, z, st, scaled=True)) * 10.0
        bend = sum((k0 * k0 + k0 * k1 + k1 * k1) / 3.0 * length for length, k0, k1 in pieces)
        wish = np.array([z[0] / 500.0, math.sqrt(max(bend, 0.0) * 10.0)])
        return np.concatenate([miss, short, wish])

    def objective(self, tpl, z, state=None):
        b1, b2, pieces, _ = state or self.state(tpl, z)
        bend = sum((k0 * k0 + k0 * k1 + k1 * k1) / 3.0 * length for length, k0, k1 in pieces)
        total = sum(p[0] for p in pieces)
        out = (z[0] / 50.0) ** 2 + 1e3 * bend + total / 1000.0
        if self.k_reg is not None:
            for dk in self.joints(tpl, b1, b2, pieces):
                over = abs(dk) - self.k_reg
                if over > 0:
                    out += 1e8 * over * over
        return out


    def bundle(self, tpl, z):
        """Objective, closure and limits at z with their derivatives, by
        forward differences from one evaluation per variable — the three share
        every evaluation, which scipy's own differences would repeat."""
        z = np.asarray(z, dtype=float)
        key = (tpl.types, z.tobytes())
        if self._last is not None and self._last[0] == key:
            return self._last[1]

        def values(at):
            st = self.state(tpl, at)
            return (self.objective(tpl, at, st), self.residual(tpl, at, st),
                    self.inequalities(tpl, at, st))
        f0, r0, g0 = values(z)
        n = len(z)
        df, dr, dg = np.empty(n), np.empty((len(r0), n)), np.empty((len(g0), n))
        for j in range(n):
            h = 1e-7 * max(1.0, abs(z[j]))
            zj = z.copy()
            zj[j] += h
            f1, r1, g1 = values(zj)
            df[j] = (f1 - f0) / h
            dr[:, j] = (r1 - r0) / h
            dg[:, j] = (g1 - g0) / h
        out = (f0, df, r0, dr, g0, dg)
        self._last = (key, out)
        return out

def _guess_s2(problem, s1, interval):
    """Where the second toe starts: the station whose branch end lies on the
    ray an arc from B1E would end along — the dialog's closed construction."""
    b1 = problem.first.at(s1)
    best, best_f = None, None
    for s2 in np.linspace(interval[0], interval[1], max(2, int((interval[1] - interval[0]) / 0.5) + 1)):
        b2 = problem.second.at(float(s2))
        dx, dy = b2[0] - b1[0], b2[1] - b1[1]
        mid = b1[2] + _wrap(b2[2] - b1[2]) / 2.0
        along = dx * math.cos(mid) + dy * math.sin(mid)
        if along <= 0:
            continue
        f = abs(-dx * math.sin(mid) + dy * math.cos(mid))
        if best_f is None or f < best_f:
            best, best_f = float(s2), f
    return best


def _starts(tpl, problem, s1, s2):
    b1 = problem.first.at(s1)
    b2 = problem.second.at(s2)
    chord = math.hypot(b2[0] - b1[0], b2[1] - b1[1])
    turn = _wrap(b2[2] - b1[2])
    n = len(tpl.types)
    each = max(chord / n, ROOM * 10)
    k_turn = turn / max(chord, 1.0)
    arcs = [i for i, kind in enumerate(tpl.types) if kind == "arc"]
    gentle = 1.0 / 1000.0
    patterns = [{i: k_turn for i in arcs}]
    if len(arcs) >= 2:
        # Reverse curves either way round: an S flatter or steeper than the branches.
        for sign in (1.0, -1.0):
            patterns.append({i: (sign if j % 2 == 0 else -sign) * gentle + k_turn for j, i in enumerate(arcs)})
    elif arcs:
        patterns.append({i: 0.0 for i in arcs})
    out = []
    for pattern in patterns:
        z = [s1, s2]
        for i, field in tpl.slots:
            z.append(each if field == "length" else pattern[i] * K_SCALE)
        out.append(np.array(z))
    return out


def _feasible(tpl, problem, z):
    """Does z close the connection and keep every limit?"""
    r = problem.residual(tpl, z)
    scale = max(10.0, sum(z[2 + j] for j, (_, f) in enumerate(tpl.slots) if f == "length"))
    if math.hypot(r[0], r[1]) > CLOSE_POS or abs(r[2]) / scale > CLOSE_ANGLE:
        return False
    return bool(np.min(problem.inequalities(tpl, z)) >= -1e-7)


def _solve(tpl, problem, interval1, interval2, start):
    """Two phases: least squares finds a point that closes within the limits
    (robust from a start that is neither), SLSQP then moves it along what
    closes to the best place by the objective. The polished point where it
    holds, else the first phase's, else None."""
    bounds = [interval1, interval2]
    for _, field in tpl.slots:
        bounds.append((ROOM, MAX_LENGTH) if field == "length" else (-K_MAX * K_SCALE, K_MAX * K_SCALE))
    lo = np.array([b[0] for b in bounds])
    hi = np.array([b[1] for b in bounds])
    # least_squares wants a box with room: a fixed toe (a node) stays where it is.
    fixed = hi - lo < 1e-9
    free = ~fixed

    def full(v):
        z = lo.copy()
        z[free] = v
        return z
    x0 = np.clip(np.asarray(start, dtype=float), lo, hi)[free]
    try:
        first = least_squares(lambda v: problem.penalty(tpl, full(v)), x0,
                              bounds=(lo[free], hi[free]), method="trf", x_scale="jac",
                              xtol=1e-12, ftol=1e-12, gtol=1e-12, max_nfev=200)
    except (ValueError, FloatingPointError, ZeroDivisionError):
        return None
    z = full(first.x)
    r = problem.residual(tpl, z)
    if math.hypot(r[0], r[1]) > 1e-2:
        return None
    try:
        res = minimize(
            lambda z: problem.bundle(tpl, z)[0], z, method="SLSQP", bounds=bounds,
            jac=lambda z: problem.bundle(tpl, z)[1],
            constraints=[{"type": "eq", "fun": lambda z: problem.bundle(tpl, z)[2],
                          "jac": lambda z: problem.bundle(tpl, z)[3]},
                         {"type": "ineq", "fun": lambda z: problem.bundle(tpl, z)[4],
                          "jac": lambda z: problem.bundle(tpl, z)[5]}],
            options={"maxiter": 60, "ftol": 1e-10})
        if _feasible(tpl, problem, res.x):
            return res.x
    except (ValueError, FloatingPointError, ZeroDivisionError):
        pass
    return z if _feasible(tpl, problem, z) else None


def _answer(tpl, problem, z, form_index, label):
    b1, b2, pieces, _ = problem.state(tpl, z)
    hints = []
    rw_min = None
    for dk in problem.joints(tpl, b1, b2, pieces):
        if abs(dk) > SAME_K:
            rw = 1.0 / abs(dk)
            rw_min = rw if rw_min is None else min(rw_min, rw)
            if problem.k_reg is not None and abs(dk) > problem.k_reg + 1e-12:
                hints.append(rw)
    out_pieces = []
    for (length, k0, _), kind in zip(pieces, tpl.types):
        out_pieces.append({"type": kind, "length": float(length),
                           "kappa": float(k0) if kind == "arc" else None})
    return {
        "form": form_index, "label": label, "template": list(tpl.types),
        "s1": float(z[0]), "s2": float(z[1]), "pieces": out_pieces,
        "hints": hints, "rwMin": rw_min, "score": float(problem.objective(tpl, z)),
    }


def _rank(sol):
    return (bool(sol["hints"]), len(sol["pieces"]), round(abs(sol["s1"]), 1), sol["score"])


def solve(payload, deadline=DEADLINE):
    """The solutions for one request — see crossover_payload."""
    speed = float(payload.get("speed") or 0)
    if not speed > 0:
        raise ValueError("speed")
    limits = payload.get("limits") or {}
    forms = payload.get("forms")
    if not isinstance(forms, list) or not forms:
        raise ValueError("forms")
    started = time.monotonic()
    for form_index, form in enumerate(forms):
        try:
            first, second = BranchEnd(form.get("first") or []), BranchEnd(form.get("second") or [])
        except (ValueError, TypeError):
            continue
        problem = Problem(first, second, limits, speed)
        # Where the search starts: each stretch the first turnout may stand on,
        # nearest the click first, its toe as near the click as it allows, and
        # the stretch of the second turnout that holds the closed
        # construction's s2 there (or lies nearest to it).
        whole = (second.s[0], second.s[-1])
        starts = []
        for i1 in sorted(first.intervals, key=lambda iv: max(0.0, iv[0], -iv[1])):
            s1 = min(max(0.0, i1[0]), i1[1])
            s2 = _guess_s2(problem, s1, whole)
            if s2 is None or not second.intervals:
                continue
            i2 = min(second.intervals, key=lambda iv: max(0.0, iv[0] - s2, s2 - iv[1]))
            starts.append((i1, i2, s1, min(max(s2, i2[0]), i2[1])))
        best = {}
        for types in TEMPLATES:
            tpl = Template(types)
            for i1, i2, s1, s2 in starts:
                for start in _starts(tpl, problem, s1, s2):
                    if time.monotonic() - started > deadline:
                        break
                    z = _solve(tpl, problem, i1, i2, start)
                    if z is None:
                        continue
                    sol = _answer(tpl, problem, z, form_index, form.get("label"))
                    if types not in best or _rank(sol) < _rank(best[types]):
                        best[types] = sol
        if best:
            return sorted(best.values(), key=_rank)[:MAX_SOLUTIONS]
    return []


def crossover_payload(payload):
    """The answer to `POST /crossover`.

    Body: {"speed": km/h, "limits": {"lMin", "rwReg", "rwDiscretion" [m],
    "maxCantDef" [mm], "cantDefCoeff", "cantTol" [mm]}, "forms": [{"label",
    "first": [sample], "second": [sample]}]} — the forms in the order the
    speed falls back through; a sample {s, x, y [m], psi [rad], kappa [1/m],
    tail [m], cantLds [mm], ok} as the app's crossoverRequest makes it.

    Answers {"solutions": [{form, label, template, s1, s2, pieces: [{type,
    length, kappa}], hints: [r_w under the Regelwert], rwMin, score}]} best
    first, from the first form that has any — or {"error": "no_solution"}.
    """
    if not isinstance(payload, dict):
        raise ValueError("payload")
    solutions = solve(payload)
    if not solutions:
        return {"error": "no_solution"}
    return {"solutions": solutions}
