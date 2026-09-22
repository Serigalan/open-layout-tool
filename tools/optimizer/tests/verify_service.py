"""Acceptance for the HTTP service (olt_optimizer/service.py).

Starts a real server on a free port and drives it over the network: the happy
path on a compound curve (Korbbogen — the case AP 4.2 is about), the error
keys the panel translates, the deadline, and the CORS answer without which the
browser never sees any of it.

    .venv/bin/python tests/verify_service.py
"""

import json
import math
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from olt_optimizer.geometry import dir_of                              # noqa: E402
from olt_optimizer.geometry import fit_compound_group                  # noqa: E402
from olt_optimizer.track_io import (                                   # noqa: E402
    _arc_element_seg, _straight_element, _transition_element,
)

FAILED = []


def ok(label, cond):
    print(("PASS " if cond else "FAIL ") + label)
    if not cond:
        FAILED.append(label)


# ── A compound curve to send: straight – T – arc – T – arc – T – straight ────

EPSG = 25832
P1 = (600000.0, 5600000.0)
B1 = 30.0
D1 = dir_of(B1)
VERTEX = (P1[0] + 800 * D1[0], P1[1] + 800 * D1[1])
KB2 = 62.0
DK2 = dir_of(KB2)
KP2 = (VERTEX[0] + 900 * DK2[0], VERTEX[1] + 900 * DK2[1])


def korbbogen_track():
    fit = fit_compound_group(P1, D1, B1, KP2, DK2, KB2, [900, 600], [0.10], [60, 40, 60],
                             ["clothoid", "clothoid", "clothoid"])
    els = [_straight_element(P1, fit["cl_start"], EPSG, 100)]
    cants = [60, 100]
    arc_no = 0
    for seg in fit["segments"]:
        if seg["kind"] == "transition":
            els.append(_transition_element(seg["start"], seg["bearing"], seg["L"],
                                           seg["r1"], seg["r2"], seg["type"], EPSG, 100))
        else:
            els.append(_arc_element_seg(seg, EPSG, 100, cants[arc_no]))
            arc_no += 1
    els.append(_straight_element(fit["cl_end"], KP2, EPSG, 100))
    return {"id": "svc1", "name": "korb.001", "epsg": EPSG, "elements": els}


def straight_only_track():
    return {"id": "svc2", "name": "gerade.001", "epsg": EPSG,
            "elements": [_straight_element(P1, VERTEX, EPSG, 100)]}


# ── Server under test ────────────────────────────────────────────────────────

def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def start_server(**env_extra):
    port = free_port()
    env = {**os.environ, "OLT_OPTIMIZER_HOST": "127.0.0.1", "OLT_OPTIMIZER_PORT": str(port),
           "OLT_OPTIMIZER_ORIGINS": "https://open-layout-tool.org", **env_extra}
    proc = subprocess.Popen([sys.executable, "-m", "olt_optimizer.service"],
                            env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    base = f"http://127.0.0.1:{port}"
    for _ in range(100):
        try:
            urllib.request.urlopen(base + "/health", timeout=1).read()
            return proc, base
        except Exception:                                              # noqa: BLE001
            if proc.poll() is not None:
                raise SystemExit("Dienst startet nicht:\n" + proc.stdout.read().decode())
            time.sleep(0.1)
    proc.kill()
    raise SystemExit("Dienst antwortet nicht auf /health")


def call(base, path, body=None, method=None, headers=None, raw=None, timeout=180):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(base + path, data=data, method=method or ("POST" if data else "GET"))
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            payload = res.read()
            return res.status, (json.loads(payload) if payload else None), dict(res.headers)
    except urllib.error.HTTPError as exc:
        payload = exc.read()
        return exc.code, (json.loads(payload) if payload else None), dict(exc.headers)


proc, BASE = start_server()
try:
    # ── 1) Health ────────────────────────────────────────────────────────────
    status, body, _ = call(BASE, "/health")
    ok("GET /health antwortet 200 ok", status == 200 and body == {"status": "ok"})

    # ── 1b) Regelwerke (AP R.3) ───────────────────────────────────────────────
    status, body, _ = call(BASE, "/regelwerke")
    ok("GET /regelwerke antwortet 200", status == 200)
    ok("GET /regelwerke listet db-ril-800",
       isinstance(body, dict)
       and any(rw["id"] == "db-ril-800" for rw in body.get("regelwerke", [])))
    status, body, _ = call(BASE, "/regelwerke/db-ril-800")
    ok("GET /regelwerke/db-ril-800 antwortet mit dem vollen Regelwerk",
       status == 200 and body.get("id") == "db-ril-800"
       and "ueberhoehung" in body and "rampenregel" in body)
    status, body, _ = call(BASE, "/regelwerke/nicht-vorhanden")
    ok("GET /regelwerke/<unbekannt> → 404", status == 404 and body == {"error": "not_found"})

    # ── 2) Korbbogen über die Leitung (AP 4.2 durch den Dienst) ──────────────
    track = korbbogen_track()
    started = time.monotonic()
    status, body, _ = call(BASE, "/optimize", {"track": track, "corridorCm": 50, "uf": 130,
                                               "uebergang": "auto", "maxiter": 40})
    took = time.monotonic() - started
    ok("POST /optimize antwortet 200", status == 200)
    ok("Antwort trägt den vollen Vertrag",
       isinstance(body, dict)
       and set(body) >= {"elements", "report", "variant", "vBestand", "vBaseline", "vNeu",
                        "shifts", "skipped", "regelwerk"})
    ok("Antwort nennt das verwendete Regelwerk", body.get("regelwerk") == "db-ril-800")
    ok("jede geänderte Reportzeile nennt ihren Grund (AP R.4)",
       all(isinstance(r.get("grund"), dict) and r["grund"].get("regel")
          for r in body["report"] if r["changed"]))
    ok("Korbbogen bleibt eine Gruppe mit zwei Bögen",
       len({r["group"] for r in body["report"]}) == 1
       and [r["arc"] for r in body["report"]] == [1, 2]
       and all(r["arcs"] == 2 for r in body["report"]))
    ok(f"v verbessert ({body['vBestand']:.1f} → {body['vNeu']:.1f} km/h)",
       body["vNeu"] > body["vBestand"] + 1)
    ok("Überhöhungen im 5-mm-Raster",
       all(abs(r["uNeu"] / 5 - round(r["uNeu"] / 5)) < 1e-9 for r in body["report"] if r["changed"]))
    ok("Abrückung im Korridor",
       all(r["offsetCm"] <= 50.0 + 1e-6 for r in body["report"] if r["changed"]))
    ok("Elementkette schließt (Knoten < 1 mm)",
       all(math.hypot(b["startNode"][0] - a["endNode"][0], b["startNode"][1] - a["endNode"][1]) < 1e-3
           for a, b in zip(body["elements"], body["elements"][1:])))
    ok("Track-Enden bleiben liegen",
       math.hypot(body["elements"][0]["startNode"][0] - P1[0],
                  body["elements"][0]["startNode"][1] - P1[1]) < 1e-6
       and math.hypot(body["elements"][-1]["endNode"][0] - KP2[0],
                      body["elements"][-1]["endNode"][1] - KP2[1]) < 1e-6)
    print(f"   Lauf über HTTP: {took:.1f}s, {len(body['elements'])} Elemente")

    # `auto` läuft als zwei Kindprozesse nebeneinander. Es muss dasselbe
    # herauskommen wie aus der besseren der beiden einzeln gerechneten Varianten
    # — sonst wäre die Parallelität nicht bloß schneller, sondern eine andere
    # Rechnung.
    singles = {}
    for name in ("bestand", "bloss"):
        st, bd, _ = call(BASE, "/optimize", {"track": track, "corridorCm": 50, "uf": 130,
                                             "uebergang": name, "maxiter": 40})
        singles[name] = bd if st == 200 else None
    better = max((b for b in singles.values() if b), key=lambda b: b["vNeu"], default=None)
    ok("auto liefert genau die bessere Einzelvariante",
       better is not None and body["variant"] == better["variant"]
       and abs(body["vNeu"] - better["vNeu"]) < 1e-12
       and json.dumps(body["elements"]) == json.dumps(better["elements"])
       and json.dumps(body["report"]) == json.dumps(better["report"]))
    print("   Varianten einzeln: "
          + ", ".join(f"{k} {v['vNeu']:.2f}" for k, v in singles.items() if v)
          + f" | auto wählt {body['variant']} ({body['vNeu']:.2f})")

    # ── 3) Die Fehlerschlüssel, die das Panel übersetzt ──────────────────────
    status, body, _ = call(BASE, "/optimize", raw=b"{nicht json")
    ok("kaputter Body → 400 invalid_payload",
       status == 400 and body == {"error": "invalid_payload"})

    status, body, _ = call(BASE, "/optimize", {"corridorCm": 50})
    ok("Body ohne Track → 400 invalid_payload",
       status == 400 and body == {"error": "invalid_payload"})

    status, body, _ = call(BASE, "/optimize", {"track": track, "regelwerk": "nicht-vorhanden"})
    ok("unbekanntes Regelwerk → 400 invalid_regelwerk",
       status == 400 and body == {"error": "invalid_regelwerk", "message": "nicht-vorhanden"})

    status, body, _ = call(BASE, "/optimize", {"track": straight_only_track()})
    ok("nicht optimierbare Topologie → 422 mit lesbarem Satz",
       status == 422 and body.get("error") == "unsupported_topology"
       and isinstance(body.get("message"), str) and body["message"])
    print(f"   Topologie-Meldung: {body.get('message')}")

    big = {"track": {**track, "elements": track["elements"] * 500}}
    status, body, _ = call(BASE, "/optimize", big)
    ok("zu großer Track → 413 too_large", status == 413 and body == {"error": "too_large"})

    status, body, _ = call(BASE, "/nirgends")
    ok("unbekannter Pfad → 404 not_found", status == 404 and body == {"error": "not_found"})

    # ── 4) CORS — ohne die Antwort sieht der Browser nichts davon ────────────
    status, _, headers = call(BASE, "/optimize", method="OPTIONS",
                              headers={"Origin": "https://open-layout-tool.org"})
    ok("Preflight erlaubt die bekannte Herkunft",
       status == 204 and headers.get("Access-Control-Allow-Origin") == "https://open-layout-tool.org"
       and "POST" in (headers.get("Access-Control-Allow-Methods") or ""))

    status, _, headers = call(BASE, "/optimize", method="OPTIONS",
                              headers={"Origin": "https://fremde-seite.example"})
    ok("Preflight schweigt zu fremder Herkunft",
       status == 204 and headers.get("Access-Control-Allow-Origin") is None)

    status, _, headers = call(BASE, "/health", headers={"Origin": "https://open-layout-tool.org"})
    ok("Antwort trägt den CORS-Kopf",
       headers.get("Access-Control-Allow-Origin") == "https://open-layout-tool.org")
finally:
    proc.terminate()
    proc.wait(10)

# ── 5) Laufzeitdeckel: ein eigener Dienst mit 1 s Frist ─────────────────────
proc2, BASE2 = start_server(OLT_OPTIMIZER_TIMEOUT="1")
try:
    status, body, _ = call(BASE2, "/optimize", {"track": korbbogen_track(), "maxiter": 150})
    ok("Laufzeitdeckel greift → 504 timeout", status == 504 and body == {"error": "timeout"})
    status, body, _ = call(BASE2, "/health")
    ok("Dienst lebt nach dem Abbruch weiter", status == 200 and body == {"status": "ok"})
finally:
    proc2.terminate()
    proc2.wait(10)

print()
if FAILED:
    print(f"{len(FAILED)} FEHLGESCHLAGEN:")
    for label in FAILED:
        print("  - " + label)
    raise SystemExit(1)
print("Alle Dienstprüfungen bestanden.")
