"""Access database (DB ASCII interface, Satzarten 11–41) → the import payload.

The browser cannot read an Access file, so the conversion runs here (ROADMAP
decision 11). This module does no fachliche interpretation: it lifts the tables
that matter out of the database and hands them over under short names. What the
values mean — element types, Bauformen, Lagesysteme — is decided in
`src/utils/mdbImport.js`, where it is testable without a database.

Reading is done with `mdb-export` from mdbtools, one child process per table.
"""

import csv
import io
import os
import shutil
import subprocess

# Access files start with this; checked before a child process is started so a
# wrong upload fails here instead of inside mdbtools.
MAGIC = b"\x00\x01\x00\x00Standard Jet DB"
MAGIC_ACE = b"\x00\x01\x00\x00Standard ACE DB"

TIMEOUT = float(os.environ.get("OLT_MDB_TIMEOUT", "180"))


class MdbError(Exception):
    """Conversion failed; `code` is the key the client translates."""

    def __init__(self, code, message=None):
        super().__init__(code)
        self.code = code
        self.message = message


def _tool():
    path = shutil.which("mdb-export")
    if not path:
        raise MdbError("internal", "mdb-export not installed")
    return path


def _rows(path, table):
    """One table as dicts. A table the file does not have yields nothing."""
    try:
        proc = subprocess.run(
            [_tool(), path, table],
            capture_output=True, timeout=TIMEOUT, check=False,
        )
    except subprocess.TimeoutExpired:
        raise MdbError("timeout") from None
    if proc.returncode != 0:
        return []
    text = proc.stdout.decode("utf-8", errors="replace")
    return list(csv.DictReader(io.StringIO(text)))


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _int(v, default=0):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return default


def _txt(v):
    return (v or "").strip()


def convert(path):
    """The payload `parseMdbPayload` consumes."""
    with open(path, "rb") as fh:
        head = fh.read(len(MAGIC))
    if head not in (MAGIC, MAGIC_ACE):
        raise MdbError("not_a_database")

    points = [
        {"pad": _txt(r.get("PAD")), "sys": _txt(r.get("LSYS")),
         "y": _num(r.get("Y")), "x": _num(r.get("X"))}
        for r in _rows(path, "X_ASC12_PL")
    ]
    points = [p for p in points if p["pad"] and p["y"] is not None and p["x"] is not None]

    elements = [
        {"pad1": _txt(r.get("PAD1")), "pad2": _txt(r.get("PAD2")),
         "sys": _txt(r.get("ELSYS")), "typ": _int(r.get("ELTYP"), -1),
         "p1": _num(r.get("ELPAR1")), "p2": _num(r.get("ELPAR2")),
         "p3": _num(r.get("ELPAR3")), "ariwi": _num(r.get("ELARIWI")),
         "err": _int(r.get("ErrStatus"))}
        for r in _rows(path, "X_ASC21_EL")
    ]

    cants = [
        {"pad1": _txt(r.get("PAD1")), "pad2": _txt(r.get("PAD2")),
         "typ": _int(r.get("EUTYP"), -1), "p1": _num(r.get("EUPAR1")),
         "p2": _num(r.get("EUPAR2")), "p3": _num(r.get("EUPAR3")),
         "err": _int(r.get("ErrStatus"))}
        for r in _rows(path, "X_ASC23_EU")
    ]

    # A Gleisabschnitt names its elements through an ordered list of point
    # addresses in a child table, linked by the parser's running number.
    chains = {}
    for r in _rows(path, "X_ASC33_GS_L"):
        key = _txt(r.get("ParseLfdNr"))
        chains.setdefault(key, []).append((_int(r.get("LfdNr")), _txt(r.get("L"))))
    tracks = []
    for r in _rows(path, "X_ASC33_GS"):
        key = _txt(r.get("ParseLfdNr"))
        chain = [pad for _, pad in sorted(chains.get(key, [])) if pad]
        tracks.append({
            "id": key,
            "a": _txt(r.get("AKNOTEN")), "e": _txt(r.get("EKNOTEN")),
            "strecke": _txt(r.get("STRECKE")), "gleis": _txt(r.get("GLEISNR")),
            "richtung": _int(r.get("STRRIKZ"), 0),
            "chain": chain,
            "err": _int(r.get("ErrStatus")),
        })

    nodes = [
        {"knoten": r.get("KNOTEN") or "", "typ": _int(r.get("KNTYP"), -1),
         "pad": _txt(r.get("PAD")), "form": _txt(r.get("KNBE")),
         "nb": [_txt(r.get(k)) for k in ("KN0", "KN1", "KN2", "KN3")],
         "err": _int(r.get("ErrStatus"))}
        for r in _rows(path, "X_ASC31_KN")
    ]

    if not elements and not nodes:
        raise MdbError("no_records")

    return {
        "points": points,
        "elements": elements,
        "cants": cants,
        "tracks": tracks,
        "nodes": nodes,
        "counts": {
            "points": len(points), "elements": len(elements), "cants": len(cants),
            "tracks": len(tracks), "nodes": len(nodes),
        },
    }
