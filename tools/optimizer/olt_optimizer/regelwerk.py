"""Loading and checking regelwerke — the constants a railway administration
sets, as data instead of code (AP R.2). See ROADMAP.md, "Regelwerk und Physik
als lesbare JSON".

Not everything a run needs is a regelwerk value: SAMPLE_SAGITTA, the window
search's population/budget constants and the rest of geometry.py/optimize.py's
own tuning stay literals there — they are numerics the search is built around,
not something a railway administration sets, and change only with the code.

The files live inside the package (`olt_optimizer/regelwerke/*.json`), not
beside it, so `pip install tools/optimizer` ships them — see the package-data
entry in pyproject.toml. A regelwerk id is untrusted input once it comes from
a request; `load_regelwerk` only ever opens a name it already listed, never
one built from the argument directly, so it cannot be pointed outside the
directory.
"""

import json
from pathlib import Path

REGELWERKE_DIR = Path(__file__).resolve().parent / "regelwerke"
DEFAULT_REGELWERK_ID = "db-ril-800-0110"

# The regelwerk keys `optimize.py` reads from `params`, and where each comes
# from in the JSON. `verify.py`'s drift check walks this same map in both
# directions — every path here must resolve, and (bar the two informational
# entries below, which document something the code deliberately does not
# read) every numeric entry in the file must be reachable from here.
_PATHS = {
    "u_max": "ueberhoehung.u_max.wert",
    "u_step": "ueberhoehung.u_step.wert",
    "u_max_switch": "weiche.u_max.wert",
    "uf_max_switch": "weiche.uf_max.wert",
    "min_length_coeff": "mindestlaenge.koeffizient.wert",
    "r_step": "baubarkeitsraster.radius_schritt.wert",
    "r_min": "baubarkeitsraster.radius_min.wert",
    "l_step": "baubarkeitsraster.laenge_schritt.wert",
}
_RAMP_PATHS = {"clothoid": "rampenregel.faktor_klothoide.wert",
              "bloss": "rampenregel.faktor_bloss.wert"}
# Present in the file, deliberately absent from `_PATHS`/`_RAMP_PATHS`: the
# switch exception is a decision a designer writes down for one element, not
# headroom a run may help itself to (see geometry.py), and an existing
# alignment is exempt from the ramp rule by definition, not by a value a run
# could read differently. Both are documentation the drift check must still
# find — just not values it feeds into `params`.
_INFORMATIONAL_PATHS = ("weiche.ausnahme_120", "bestand.unterliegt_rampenregel")


class RegelwerkError(Exception):
    """An unknown regelwerk id, or a file that does not parse as one."""


def _get(regelwerk, dotted):
    node = regelwerk
    for part in dotted.split("."):
        node = node[part]
    return node


def list_regelwerke():
    """[{id, name, version, gueltigAb}, ...], one per file in regelwerke/."""
    out = []
    for path in sorted(REGELWERKE_DIR.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        out.append({"id": data["id"], "name": data["name"],
                    "version": data["version"], "gueltigAb": data["gueltig_ab"]})
    return out


def load_regelwerk(regelwerk_id=None):
    """The full regelwerk dict for `regelwerk_id`, or the default when None."""
    wanted = regelwerk_id or DEFAULT_REGELWERK_ID
    # Resolved against the directory listing, not opened by the id directly —
    # `wanted` may be exactly what a request sent.
    known = {rw["id"]: rw for rw in list_regelwerke()}
    if wanted not in known:
        raise RegelwerkError(f"unbekanntes Regelwerk: {wanted}")
    path = REGELWERKE_DIR / f"{wanted}.json"
    return json.loads(path.read_text(encoding="utf-8"))


def params_from_regelwerk(regelwerk):
    """The regelwerk's values, flattened to the keys `optimize.py` reads from
    `params`. Kept to one place so a second regelwerk only has to supply the
    same JSON shape, not touch any code."""
    values = {key: _get(regelwerk, path) for key, path in _PATHS.items()}
    values["ramp_factor"] = {name: _get(regelwerk, path) for name, path in _RAMP_PATHS.items()}
    return values
