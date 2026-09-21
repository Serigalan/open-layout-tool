"""Reading, parsing and writing of the app's tracks-JSON export.

The export (Datenaustausch → Tracks exportieren) contains one object per track
with scalar elements only (no display geometry): startNode/endNode [E, N] in
the track's native CRS (`epsg`), bearings in degrees, lengths in metres. The
re-import rebuilds the display geometry from these scalars.
"""

import json
import math

from .geometry import (
    dir_of, sample_transition, sample_arc, transition_end, as_points,
    arc_center, arc_sweep, arc_bearing_at, RAD2DEG,
)


def load_tracks(path):
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    return data if isinstance(data, list) else [data]


def save_tracks(path, tracks):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(tracks, fh, ensure_ascii=False, indent=2)


def find_track(tracks, ident):
    matches = [t for t in tracks if t.get("id") == ident or t.get("name") == ident]
    if not matches:
        raise SystemExit(f"Track '{ident}' nicht gefunden. Verfügbar: "
                         + ", ".join(t.get("name") or t.get("id", "?") for t in tracks))
    return matches[0]


def is_straight(el):
    return el.get("radius") is None and el.get("elementType") != 2


def is_transition(el):
    return el.get("elementType") == 2


def is_arc(el):
    return el.get("radius") is not None


def is_switch_element(el):
    """Is this element part of a turnout's own route? (switchModel.js)"""
    return bool(el.get("switchBranch"))


def _bearing_from_nodes(el):
    (s_e, s_n), (e_e, e_n) = el["startNode"], el["endNode"]
    return (math.atan2(e_e - s_e, e_n - s_n) * RAD2DEG) % 360.0


def _element_ref_points(el):
    """Sample points of one original element (native CRS plane)."""
    s_e, s_n = el["startNode"]
    e_e, e_n = el["endNode"]
    if is_arc(el):
        return sample_arc(s_e, s_n, e_e, e_n, el["radius"])
    if is_transition(el):
        profile = "bloss" if el.get("transitionType") == "bloss" else "clothoid"
        return sample_transition(s_e, s_n, el.get("bearing", _bearing_from_nodes(el)),
                                 el["length"], el.get("r1"), el.get("r2"), profile)
    return [(s_e, s_n), (e_e, e_n)]


def _ref_polyline(els, start, end):
    pts = []
    for i in range(start, end + 1):
        part = _element_ref_points(els[i])
        pts.extend(part[1:] if pts else part)
    return pts


def _arc_sweep_mag(el):
    (s_e, s_n), (e_e, e_n) = el["startNode"], el["endNode"]
    ac = arc_center(s_e, s_n, e_e, e_n, el["radius"])
    if ac is None:
        return 0.0
    return abs(arc_sweep(s_e, s_n, e_e, e_n, ac[0], ac[1], el["radius"]))


class _Unreadable(Exception):
    """A stretch that cannot be fitted between two tangents, and why not."""


def _next_straight(els, i, last):
    """Index of the first straight at or after `i` (at most `last`, a straight)."""
    while i <= last and not is_straight(els[i]):
        i += 1
    return i


def _read_group(els, entry_idx, i, last):
    """Read straight - [T] - arc (- [T] - arc)* - [T] - straight starting at `i`.

    Returns (group, exit_idx). Raises `_Unreadable` with a sentence for the user
    when the sequence is not one that can be fitted between two tangents.
    """
    arc_idxs = []
    t_idxs = []
    if is_transition(els[i]):
        t_idxs.append(i)
        i += 1
    else:
        t_idxs.append(None)
    while True:
        if i > last or not is_arc(els[i]):
            raise _Unreadable("Ein Übergangsbogen muss in einen Bogen laufen.")
        arc_idxs.append(i)
        i += 1
        if i <= last and is_transition(els[i]):
            t_idxs.append(i)
            i += 1
            if i <= last and is_arc(els[i]):
                continue
            break
        t_idxs.append(None)
        if i <= last and is_arc(els[i]):
            continue
        break
    if i > last or not is_straight(els[i]):
        raise _Unreadable("Bögen müssen zwischen Geraden liegen.")
    if len({els[k]["radius"] > 0 for k in arc_idxs}) > 1:
        raise _Unreadable("S-Bögen ohne Zwischengerade werden nicht unterstützt.")
    return _build_group(els, entry_idx, arc_idxs, t_idxs, i), i


def parse_groups(track, skipped=None):
    """Split a track into curve groups: straight - [T] - arc (- [T] - arc)* - [T] - straight.

    Compound curves (Korbbögen: several same-side arcs, optionally with
    transitions between them) form one group.

    Read is the stretch between the first straight and the last, and within it
    only what fits the shape above. A track may begin or end in a curve, or
    carry an S-curve, a reversing transition or a lone transition between two
    straights somewhere in the middle — none of those has two tangents to be
    fitted between. What cannot be read is stepped over to the next straight and
    stays exactly as it lies, while the curves around it are optimized as usual.
    One unreadable stretch used to throw the whole track away, and on an
    imported Strecke that is most of them.

    skipped: an optional list, filled with (from, to, why) for each stretch
    stepped over — so the caller can say that part of the track was left alone
    instead of quietly handing back half an answer.

    Raises SystemExit only when nothing at all can be read.
    """
    els = track.get("elements") or []
    straights = [i for i, el in enumerate(els) if is_straight(el)]
    if len(straights) < 2:
        raise SystemExit("Track braucht mindestens zwei Geraden mit einem Bogen dazwischen.")
    first, last = straights[0], straights[-1]

    groups = []
    gaps = []
    entry_idx = first
    i = first + 1
    while i <= last:
        if is_straight(els[i]):
            entry_idx = i
            i += 1
            continue
        try:
            group, exit_idx = _read_group(els, entry_idx, i, last)
        except _Unreadable as why:
            # On to the next straight; that one starts the next group, and what
            # was stepped over keeps its geometry.
            nxt = _next_straight(els, i, last)
            gaps.append((i, nxt - 1, str(why)))
            entry_idx = nxt
            i = nxt + 1
            continue
        groups.append(group)
        entry_idx = exit_idx
        i = exit_idx + 1

    if skipped is not None:
        skipped.extend(gaps)
    if not groups:
        raise SystemExit("Keine optimierbaren Bögen gefunden."
                         + (f" {gaps[0][2]}" if gaps else ""))
    return groups


def _build_group(els, entry_idx, arc_idxs, t_idxs, exit_idx):
    entry, exit_ = els[entry_idx], els[exit_idx]
    b1 = _bearing_from_nodes(entry)
    b2 = _bearing_from_nodes(exit_)
    trans = [els[k] if k is not None else None for k in t_idxs]
    return {
        "entry_idx": entry_idx, "arc_idxs": arc_idxs, "t_idxs": t_idxs, "exit_idx": exit_idx,
        "p1": tuple(entry["startNode"]), "d1": dir_of(b1), "b1": b1,
        "p2": tuple(exit_["endNode"]), "d2": dir_of(b2), "b2": b2,
        "arcs": [{
            "r_alt": abs(els[k]["radius"]),
            # Cant is stored signed (following the curve); the solver works with
            # magnitudes and the sign is re-applied in _arc_element_seg.
            "u_alt": abs(els[k].get("cant") or 0.0),
            "sweep_alt": _arc_sweep_mag(els[k]),
        } for k in arc_idxs],
        "types": ["bloss" if (t or {}).get("transitionType") == "bloss" else "clothoid" for t in trans],
        "has_t": [t is not None for t in trans],
        # The ramps as they lie. Reproducing the group means re-fitting it with
        # these, not with the lengths the ramp rule would ask for — otherwise
        # the "existing" state comes out somewhere the existing track is not.
        "t_len": [float((t or {}).get("length") or 0.0) for t in trans],
        # The curve part is what the run re-cants; the bounding straights carry
        # no cant of their own and are shared with the neighbouring groups, so a
        # turnout on one of them is not this group's business.
        "on_switch": any(is_switch_element(el) for el in els[entry_idx + 1:exit_idx]),
        # Both are measured against every candidate the run tries, so they are
        # put into their measuring form here, once, and not there, every time.
        "ref_poly": as_points(_ref_polyline(els, entry_idx, exit_idx)),
        "ref_curve_pts": as_points(_ref_polyline(els, entry_idx + 1, exit_idx - 1)),
    }


# ── Building the optimized element chain ─────────────────────────────────────

def _straight_element(frm, to, epsg, speed=0, cant=None):
    length = math.hypot(to[0] - frm[0], to[1] - frm[1])
    el = {
        "elementType": 0, "epsg": epsg,
        "startNode": [frm[0], frm[1]], "endNode": [to[0], to[1]],
        "bearing": (math.atan2(to[0] - frm[0], to[1] - frm[1]) * RAD2DEG) % 360.0,
        "length": length, "absLength": length, "speed": speed,
    }
    if cant is not None:
        el["cant"] = cant
    return el


def _transition_element(start, bearing, length, r1, r2, profile, epsg, speed):
    e_e, e_n, end_bearing = transition_end(start[0], start[1], bearing, length, r1, r2, profile)
    return {
        "elementType": 2, "transitionType": profile, "r1": r1, "r2": r2, "epsg": epsg,
        "startNode": [start[0], start[1]], "endNode": [e_e, e_n],
        "bearing": bearing, "endBearing": end_bearing,
        "length": length, "absLength": length, "speed": speed,
    }


def _arc_element_seg(seg, epsg, speed, cant):
    """`cant` is a magnitude; it is signed here from the fitted curve direction."""
    s, e = seg["start"], seg["end"]
    length = abs(seg["sweep"] * seg["signed_r"])
    signed_cant = (-1.0 if seg["signed_r"] < 0 else 1.0) * abs(cant)
    return {
        "elementType": 1, "epsg": epsg, "radius": seg["signed_r"],
        "startNode": [s[0], s[1]], "endNode": [e[0], e[1]],
        "bearing": seg["bearing"], "endBearing": seg["end_bearing"],
        "length": length, "absLength": length, "speed": speed, "cant": signed_cant,
    }


def build_elements(track, groups, solutions, shifts):
    """Assemble the optimized element chain.

    solutions: per group {fit, us, v, ...} or None (group kept unchanged);
    shifts: straight index → lateral shift of that straight's line.
    """
    els = track["elements"]
    epsg = track.get("epsg")

    cuts = {}
    group_first = {}
    group_members = {}
    in_group = set()
    for gi, (g, sol) in enumerate(zip(groups, solutions)):
        members = set(g["arc_idxs"]) | {k for k in g["t_idxs"] if k is not None}
        group_first[min(members)] = gi
        group_members[gi] = members
        in_group |= members
        if sol is None:
            continue
        cuts.setdefault(g["entry_idx"], {})["end"] = sol["fit"]["cl_start"]
        cuts.setdefault(g["exit_idx"], {})["start"] = sol["fit"]["cl_end"]

    out = []
    for i, el in enumerate(els):
        if is_straight(el):
            cut = cuts.get(i)
            s = shifts.get(i, 0.0)
            d = dir_of(_bearing_from_nodes(el))
            normal = (-d[1], d[0])
            frm = cut.get("start") if cut else None
            to = cut.get("end") if cut else None
            if frm is None:
                frm = (el["startNode"][0] + s * normal[0], el["startNode"][1] + s * normal[1])
            if to is None:
                to = (el["endNode"][0] + s * normal[0], el["endNode"][1] + s * normal[1])
            out.append(_straight_element(frm, to, epsg, el.get("speed", 0), el.get("cant")))
            continue
        gi = group_first.get(i)
        if gi is None:
            if i in in_group:
                continue         # emitted at its group's first index
            out.append(dict(el))  # before the first straight or after the last
            continue
        g, sol = groups[gi], solutions[gi]
        if sol is None:                        # unchanged group: copy originals
            for k in sorted(group_members[gi]):
                out.append(dict(els[k]))
            continue
        speed = math.floor(sol["v"])
        arc_no = 0
        for seg in sol["fit"]["segments"]:
            if seg["kind"] == "transition":
                out.append(_transition_element(seg["start"], seg["bearing"], seg["L"],
                                               seg["r1"], seg["r2"], seg["type"], epsg, speed))
            else:
                out.append(_arc_element_seg(seg, epsg, speed, sol["us"][arc_no]))
                arc_no += 1

    running = 0.0
    for el in out:
        running += el["length"]
        el["absLength"] = running
    return out
