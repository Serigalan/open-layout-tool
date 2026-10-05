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
import pathlib
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
    ok("GET /regelwerke listet db-ril-800-0110",
       isinstance(body, dict)
       and any(rw["id"] == "db-ril-800-0110" for rw in body.get("regelwerke", [])))
    ok("GET /regelwerke nennt die Katalogversion der Datei",
       body["regelwerke"][0].get("version") == json.loads(
           (pathlib.Path(__file__).resolve().parents[3] / "src" / "constraints" / "db-ril-800-0110.json")
           .read_text(encoding="utf-8"))["catalog"]["katalog_version"])
    status, body, _ = call(BASE, "/regelwerke/db-ril-800-0110")
    ok("GET /regelwerke/db-ril-800-0110 nennt, woran ein Lauf je Stufe gehalten ist",
       status == 200 and body.get("id") == "db-ril-800-0110"
       and set(body.get("grenzwerte", {})) == {"reg", "discretion"}
       and body["grenzwerte"]["reg"]["uMaxWeiche"] == 100.0
       and body["grenzwerte"]["discretion"]["uMaxWeiche"] == 120.0
       and body["grenzwerte"]["discretion"]["ufMax"] == [130.0, 150.0])
    status, body, _ = call(BASE, "/regelwerke/nicht-vorhanden")
    ok("GET /regelwerke/<unbekannt> → 404", status == 404 and body == {"error": "not_found"})

    # ── 1c) Splice (AP 12.4) ──────────────────────────────────────────────────
    east = {"start": [500000.0, 5600000.0], "end": [500200.0, 5600000.0], "bearing": 90.0, "radius": None}
    north = {"start": [500400.0, 5600100.0], "end": [500400.0, 5600700.0], "bearing": 0.0, "radius": None}
    status, body, _ = call(BASE, "/splice", {"dep": east, "arr": north, "radius": 300, "lDep": 60, "lArr": 60})
    ok("POST /splice: Bogen zwischen zwei Geraden mit Übergangsbögen",
       status == 200 and [e["elementType"] for e in body.get("elements", [])] == [0, 2, 1, 2, 0])
    status, body, _ = call(BASE, "/splice", {"dep": east, "arr": north, "radius": 2000})
    ok("POST /splice: passt nicht → 200 mit Fehlerschlüssel und größtem Radius",
       status == 200 and body.get("error") == "splice_error_dep_too_large" and body["params"].get("rMax") == 400)
    status, body, _ = call(BASE, "/splice", {"dep": {"start": [0, 0]}, "arr": north, "radius": 300})
    ok("POST /splice: unvollständige Wahl → 400 invalid_payload", status == 400 and body == {"error": "invalid_payload"})

    # ── 1d) Trassieren aus Achspunkten (AP 12.5) ──────────────────────────────
    # 100 m nach Osten, ein Viertelkreis R 300 nach links, 100 m nach Norden — alle 0,5 m ein Punkt.
    axis = [[500000.0 + 0.5 * i, 5600000.0] for i in range(200)]
    axis += [[500100.0 + 300 * math.sin(a / 300), 5600000.0 + 300 * (1 - math.cos(a / 300))]
             for a in (0.5 * i for i in range(1, int(150 * math.pi / 0.5)))]
    axis += [[500400.0, 5600300.0 + 0.5 * i] for i in range(200)]
    status, body, _ = call(BASE, "/align", {"points": axis})
    ok("POST /align: Gerade, Bogen R 300 links, Gerade",
       status == 200 and body.get("error") is None and len(body["straights"]) == 2
       and len(body["curves"]) == 1 and abs(body["curves"][0]["radius"] + 300) < 0.5
       and [e["elementType"] for e in body["elements"]] == [0, 1, 0] and body["max"] < 0.002)
    status, body, _ = call(BASE, "/align", {"points": axis, "straights": []})
    ok("POST /align: ohne Gerade → 200 mit Fehlerschlüssel und Krümmungsbild",
       status == 200 and body.get("error") == "align_error_no_straight" and len(body["kappa"]) == len(axis))
    status, body, _ = call(BASE, "/align", {"points": "nein"})
    ok("POST /align: keine Punkte → 400 invalid_payload", status == 400 and body == {"error": "invalid_payload"})

    # ── 2) Korbbogen über die Leitung (AP 4.2 durch den Dienst) ──────────────
    track = korbbogen_track()
    started = time.monotonic()
    # 1 m Korridor: am Regelwert (10·v·Δu, dazu der Fehlbetragssprung) lässt
    # dieser Korbbogen in 50 cm kaum Spielraum — 0,1 km/h, zu wenig, um zu
    # sehen, dass über die Leitung wirklich gerechnet wurde.
    status, body, _ = call(BASE, "/optimize", {"track": track, "corridorCm": 100,
                                               "uebergang": "auto", "maxiter": 40})
    took = time.monotonic() - started
    ok("POST /optimize antwortet 200", status == 200)
    ok("Antwort trägt den vollen Vertrag",
       isinstance(body, dict)
       and set(body) >= {"elements", "report", "variant", "vBestand", "vBaseline", "vNeu",
                        "shifts", "skipped", "regelwerk", "regelwerkVersion", "grenzwert"})
    ok("Antwort nennt das verwendete Regelwerk und die Stufe (Vorgabe: Regelwert)",
       body.get("regelwerk") == "db-ril-800-0110" and body.get("grenzwert") == "reg")
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
       all(r["offsetCm"] <= 100.0 + 1e-6 for r in body["report"] if r["changed"]))
    ok("Elementkette schließt (Knoten < 1 mm)",
       all(math.hypot(b["startNode"][0] - a["endNode"][0], b["startNode"][1] - a["endNode"][1]) < 1e-3
           for a, b in zip(body["elements"], body["elements"][1:])))
    ok("Track-Enden bleiben liegen",
       math.hypot(body["elements"][0]["startNode"][0] - P1[0],
                  body["elements"][0]["startNode"][1] - P1[1]) < 1e-6
       and math.hypot(body["elements"][-1]["endNode"][0] - KP2[0],
                      body["elements"][-1]["endNode"][1] - KP2[1]) < 1e-6)
    print(f"   Lauf über HTTP: {took:.1f}s, {len(body['elements'])} Elemente")

    # `auto` rechnet jede Variante, die die Stufe zulässt, als eigenen
    # Kindprozess. Am Regelwert gibt es keine Blossbögen (LP.UB.02), also ist
    # `auto` dort genau der Bestand — dieselbe Rechnung, nicht bloß dieselbe Zahl.
    st, single, _ = call(BASE, "/optimize", {"track": track, "corridorCm": 100,
                                             "uebergang": "bestand", "maxiter": 40})
    ok("auto liefert genau die Bestandsvariante",
       st == 200 and body["variant"] == single["variant"] == "Bestand"
       and json.dumps(body["elements"]) == json.dumps(single["elements"])
       and json.dumps(body["report"]) == json.dumps(single["report"]))
    st, bd, _ = call(BASE, "/optimize", {"track": track, "corridorCm": 50,
                                         "uebergang": "bloss", "maxiter": 40})
    ok("Bloss am Regelwert ausdrücklich verlangt → 422 mit Grund (LP.UB.02)",
       st == 422 and bd.get("error") == "unsupported_topology" and "LP.UB.02" in bd.get("message", ""))

    # Die Ermessensgrenze über die Leitung: nie langsamer, und so ausgewiesen.
    # `auto` rechnet dort beide Varianten nebeneinander (Bloss ist zugelassen)
    # und muss dasselbe liefern wie die bessere, einzeln gerechnet.
    st, erm, _ = call(BASE, "/optimize", {"track": track, "corridorCm": 100, "grenzwert": "discretion",
                                          "uebergang": "auto", "maxiter": 40})
    ok(f"Ermessensgrenze: {erm.get('vNeu', 0):.1f} ≥ Regelwert {body['vNeu']:.1f} km/h, als solche genannt",
       st == 200 and erm["grenzwert"] == "discretion" and erm["vNeu"] >= body["vNeu"] - 1e-6)
    singles = {}
    for name in ("bestand", "bloss"):
        st, bd, _ = call(BASE, "/optimize", {"track": track, "corridorCm": 100, "grenzwert": "discretion",
                                             "uebergang": name, "maxiter": 40})
        singles[name] = bd if st == 200 else None
    better = max((b for b in singles.values() if b), key=lambda b: b["vNeu"], default=None)
    ok("Ermessensgrenze: auto liefert genau die bessere Einzelvariante",
       better is not None and all(singles.values()) and erm["variant"] == better["variant"]
       and json.dumps(erm["elements"]) == json.dumps(better["elements"]))
    print("   Ermessensgrenze einzeln: "
          + ", ".join(f"{k} {v['vNeu']:.2f}" for k, v in singles.items() if v)
          + f" | auto wählt {erm['variant']} ({erm['vNeu']:.2f})")

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

    status, body, _ = call(BASE, "/optimize", {"track": track, "grenzwert": "approval"})
    ok("unbekannte Grenzwertstufe → 400 invalid_grenzwert",
       status == 400 and body == {"error": "invalid_grenzwert", "message": "approval"})

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

# ── 6) Gelände: DGM1 der Länder, ohne Netz geprüft ──────────────────────────
import io as _io          # noqa: E402
import tempfile           # noqa: E402
import zipfile            # noqa: E402

from olt_optimizer import terrain                                   # noqa: E402


def xyz_tile(ek, nk, half, z_of):
    """Ein kleines Kachelarchiv wie Thüringen es liefert: 10 × 10 Zellen,
    Zellmitten auf halben (2020–2025) oder ganzen Metern (2014–2019)."""
    off = 0.5 if half else 0.0
    lines = [f"{ek * 1000 + c + off:.2f} {nk * 1000 + 9 - r + off:.2f} {z_of(c, r):.2f}"
             for r in range(10) for c in range(10)]
    buf = _io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("kachel.xyz", "\n".join(lines))
        zf.writestr("kachel.meta", "EPSG-Code Lage: 25832")
    return buf.getvalue()


tile = terrain.parse_xyz(b"10.5 21.5 100\n11.5 21.5 102\n10.5 20.5 104\n11.5 20.5 -9999", "t")
ok("XYZ: Raster aus den Koordinaten, Nordzeile zuerst",
   tile.grid.shape == (2, 2) and tile.x0 == 10.5 and tile.y0 == 21.5 and tile.grid[1, 0] == 104)
ok("XYZ: Zellmitte trifft ihren Wert", tile.height(10.5, 21.5) == 100)
ok("XYZ: bilinear zwischen zwei Zellen", abs(tile.height(11.0, 21.5) - 101) < 1e-9)
ok("XYZ: kein Wert, wo eine Nachbarzelle keine Daten hat", tile.height(11.4, 20.6) is None)

fetched = []
archives = {
    # 2020–2025 hat die Kachel 600/5600, nur 2014–2019 hat 601/5600.
    "dgm1_32_600_5600_1_th_2020-2025.zip": xyz_tile(600, 5600, True, lambda c, r: 200 + c),
    "dgm1_601_5600_1_th_2014-2019.zip": xyz_tile(601, 5600, False, lambda c, r: 300 + r),
}


def fake_fetch(url):
    fetched.append(url)
    return archives.get(url.rsplit("/", 1)[-1])


def ll(e, n, crs=25832):
    return list(terrain.to_lnglat(e, n, crs))


FRANCE = ll(300_000.0, 5_300_000.0)       # in keinem Land, das eine Quelle hat

with tempfile.TemporaryDirectory() as cache:
    store = terrain.TileStore(cache_dir=cache, fetch=fake_fetch)
    heights, sources = terrain.sample([ll(600_003.5, 5_600_005.5), ll(601_002.0, 5_600_007.0),
                                       ll(602_000.5, 5_600_000.5), FRANCE, ["x", None]], store)
    ok("DGM1: Punkt aus dem jüngsten Jahrgang", abs(heights[0] - 203.0) < 0.01
       and sources[0] == "dgm1-th 2020-2025")
    ok("DGM1: älterer Jahrgang, wo der jüngste die Kachel nicht hat", abs(heights[1] - 302.0) < 0.01
       and sources[1] == "dgm1-th 2014-2019")
    ok("DGM1: keine Höhe, wo kein Land die Kachel hat", heights[2] is None and sources[2] is None)
    count = len(fetched)
    terrain.sample([FRANCE], store)
    ok("DGM1: außerhalb der Länder wird gar nicht erst gefragt",
       heights[3] is None and len(fetched) == count)
    ok("DGM1: unlesbarer Punkt → null statt Fehler", heights[4] is None)
    terrain.sample([ll(600_004.5, 5_600_004.5), ll(602_000.5, 5_600_000.5)], store)
    ok("DGM1: geladene und fehlende Kacheln werden nicht erneut geholt", len(fetched) == count)
    fresh = terrain.TileStore(cache_dir=cache, fetch=fake_fetch)
    terrain.sample([ll(600_004.5, 5_600_004.5)], fresh)
    ok("DGM1: Plattenablage überlebt den Neustart", len(fetched) == count)

# Das Kachelraster: Baden-Württemberg legt 2-km-Kacheln auf ungerade Kilometer Ost.
bw, sn = terrain.SOURCES_BY_ID["dgm1-bw"], terrain.SOURCES_BY_ID["dgm1-sn"]
ok("Kachelraster: BW-Kachel beginnt auf ungeradem Kilometer Ost, geradem Nord",
   bw.tile_of(513_500, 5_403_500) == (513, 5402) and bw.tile_of(512_999, 5_402_000) == (511, 5402))
ok("Kachelraster: Sachsen auf geraden Kilometern", sn.tile_of(411_999.9, 5_655_000) == (410, 5654))


def geotiff(grid, left, top, point=False, nodata="-9999"):
    """Ein GeoTIFF, wie Bayern oder Brandenburg es liefern: 1 m, Kopfpunkt links oben."""
    import tifffile
    keys = (1, 1, 0, 1, 1025, 0, 1, 2 if point else 1)
    buf = _io.BytesIO()
    tifffile.imwrite(buf, np.asarray(grid, dtype=np.float32), compression="lzw", extratags=[
        (33550, "d", 3, (1.0, 1.0, 0.0), True),
        (33922, "d", 6, (0.0, 0.0, 0.0, float(left), float(top), 0.0), True),
        (34735, "H", len(keys), keys, True),
        (42113, "s", 0, nodata, True),
    ])
    return buf.getvalue()


import numpy as np        # noqa: E402

t = terrain.parse_tif(geotiff([[10, 11], [12, -9999]], 1000, 2002), "t")
ok("GeoTIFF: Kopfpunkt ist die Pixelecke, Raster nach Zellmitten",
   t.x0 == 1000.5 and t.y0 == 2001.5 and t.height(1000.5, 2001.5) == 10)
ok("GeoTIFF: Nodata wird zu keinem Wert", t.height(1001.4, 2000.6) is None)
t = terrain.parse_tif(geotiff([[10, 11], [12, 13]], 1000, 2002, point=True), "t")
ok("GeoTIFF: PixelIsPoint legt die Zellmitte auf den Kopfpunkt", t.x0 == 1000.0 and t.y0 == 2002.0)

# Ein Punkt im Grenzstreifen Thüringen/Bayern: Thüringens Kachel hat dort keine
# Daten (jenseits der Grenze), also antwortet Bayern.
by = terrain.SOURCES_BY_ID["dgm1-by"]
point = ll(640_500.5, 5_570_500.5)                 # bei Coburg, beide Kästen
ek, nk = by.tile_of(*terrain._to_plane(25832, *point))
nan_tile = xyz_tile(640, 5570, True, lambda c, r: -9999)
by_tile = geotiff(np.full((1000, 1000), 321.0), ek * 1000, nk * 1000 + 1000)
border = {"dgm1_32_640_5570_1_th_2020-2025.zip": nan_tile, f"{ek}_{nk}.tif": by_tile}
with tempfile.TemporaryDirectory() as cache:
    store = terrain.TileStore(cache_dir=cache, fetch=lambda url: border.get(url.rsplit("/", 1)[-1]))
    heights, sources = terrain.sample([point], store)
    ok("DGM1: jenseits der Landesgrenze antwortet das Nachbarland",
       heights == [321.0] and sources == ["dgm1-by"])

with tempfile.TemporaryDirectory() as cache:
    proc3, BASE3 = start_server(OLT_TERRAIN_CACHE=cache)
    try:
        status, body, _ = call(BASE3, "/terrain", {"lnglat": [FRANCE]})
        ok("/terrain: Punkt außerhalb jeder Quelle → null",
           status == 200 and body == {"heights": [None], "sources": [None]})
        status, body, _ = call(BASE3, "/terrain", {"points": [[300_000.0, 5_300_000.0]]})
        ok("/terrain: die alte Form in EPSG:25832 wird weiter verstanden",
           status == 200 and body == {"heights": [None], "sources": [None]})
        status, body, _ = call(BASE3, "/terrain", {"punkte": []})
        ok("/terrain: ohne Punktliste → 400 invalid_payload",
           status == 400 and body == {"error": "invalid_payload"})
        status, body, _ = call(BASE3, "/terrain", {"lnglat": [[0, 0]] * 20001})
        ok("/terrain: zu viele Punkte → 413 too_large",
           status == 413 and body == {"error": "too_large"})
    finally:
        proc3.terminate()
        proc3.wait(10)

print()
if FAILED:
    print(f"{len(FAILED)} FEHLGESCHLAGEN:")
    for label in FAILED:
        print("  - " + label)
    raise SystemExit(1)
print("Alle Dienstprüfungen bestanden.")
