"""Which rule catalogues a run may be held to, and loading them.

There is no copy of a regelwerk in this package any more. A run reads the
catalogue the app reads — src/constraints/db-ril-800-0110.json — and applies
it with the same expression language (katalog.py, ruleexpr.py); grenzen.py
turns it into the limits for the level a run is asked for.

`olt_optimizer/constraints` is a symlink to the repo's src/constraints/, so
the files stay where the rulebooks are maintained and still ship with
`pip install tools/optimizer`: setuptools follows the link and copies what it
points at (see the package-data entry in pyproject.toml).

A catalogue the optimizer can apply is one with `rules` — DB Ril 800.0110.
DB Ril 800.0120 (the switch forms) and physics.json live beside it and are not
listed: neither is a set of rules a curve could be optimized against.

A regelwerk id is untrusted input once it comes from a request;
`load_katalog` only ever opens a name it already listed, never one built from
the argument directly, so it cannot be pointed outside the directory.
"""

import hashlib
import json
from pathlib import Path

from .geometry import CANT_DEFICIENCY_COEFF
from .katalog import Katalog

CONSTRAINTS_DIR = Path(__file__).resolve().parent / "constraints"
DEFAULT_REGELWERK_ID = "db-ril-800-0110"


class RegelwerkError(Exception):
    """An unknown regelwerk id."""


def _catalogues():
    """{id: path} of every catalogue in the directory a run can apply."""
    found = {}
    for path in sorted(CONSTRAINTS_DIR.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data.get("catalog"), dict) and isinstance(data.get("rules"), list):
            found[data["catalog"]["id"]] = path
    return found


def catalog_hash():
    """SHA-256 over every catalogue file the package ships, in name order:
    for each file its name, a NUL, its bytes, a NUL. The app hashes its own
    bundled copies the same way (src/utils/catalogHash.js) and says so when
    the two differ — then the service is running against other rules than the
    app shows."""
    digest = hashlib.sha256()
    for path in sorted(CONSTRAINTS_DIR.glob("*.json"), key=lambda p: p.name):
        digest.update(path.name.encode("utf-8") + b"\0")
        digest.update(path.read_bytes() + b"\0")
    return digest.hexdigest()


def list_regelwerke():
    """[{id, name, version}, ...], one per catalogue a run can be held to.
    `version` is the catalogue's own katalog_version — the Ril's edition is
    deliberately not stated in the file (see its changelog)."""
    out = []
    for path in _catalogues().values():
        cat = json.loads(path.read_text(encoding="utf-8"))["catalog"]
        out.append({"id": cat["id"], "name": cat["title"], "version": cat["katalog_version"]})
    return out


def load_regelwerk(regelwerk_id=None):
    """The catalogue for `regelwerk_id` as the file states it, or the default
    when None — what GET /regelwerke/<id> answers."""
    wanted = regelwerk_id or DEFAULT_REGELWERK_ID
    # Resolved against the directory listing, not opened by the id directly —
    # `wanted` may be exactly what a request sent.
    path = _catalogues().get(wanted)
    if path is None:
        raise RegelwerkError(f"unbekanntes Regelwerk: {wanted}")
    return json.loads(path.read_text(encoding="utf-8"))


def load_katalog(regelwerk_id=None):
    """The catalogue for `regelwerk_id`, ready to apply. Its physics provider
    is the kernel's own coefficient — the one number the catalogue asks of the
    physics document (u0_factor, for the comparison radius between two rows
    of its table), and the one tests/verify.py holds to physics.json."""
    return Katalog(load_regelwerk(regelwerk_id), physics={"u0_factor": CANT_DEFICIENCY_COEFF})
