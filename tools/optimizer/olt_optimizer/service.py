"""HTTP service around `optimize_payload` — the optimizer as it runs on the server.

    POST /optimize        body: the panel's payload, answer: optimize_payload's result
    POST /splice          body: two picked elements and the splice settings,
                          answer: splice_payload's chain (or its error key) —
                          "Elemente verbinden", AP 12.4
    POST /mdb             body: an Access file, answer: its Satzarten as JSON
    POST /terrain         body: {"lnglat": [[lng, lat], ...]} (or, as first
                          built, {"points": [[e, n], ...]} in EPSG:25832),
                          answer: {"heights": [...], "sources": [...]} from
                          the Länder's DGM1, null where none has the point
    GET  /health          so the panel can say "no server" before the user clicks
    GET  /regelwerke      the rule catalogues a run may be held to: id, name and
                          the catalogue's own version, plus `catalogHash` over
                          every catalogue file the service reads (the app
                          compares it with its own bundled copies)
    GET  /regelwerke/<id> what a run is held to under that catalogue, per level
                          (Regelwert, Ermessensgrenze) — the numbers the service
                          really computes with, so a service deployed from an
                          older commit than the app shows as one

Failures travel as `{"error": <key>}` with an HTTP status; the client turns the
key into a sentence. Two guards keep one request from taking the service down:
a cap on the body, and a wall-clock deadline. The deadline needs the run in a
process of its own — CPU-bound Python cannot be interrupted from another thread,
and `joint_optimize` with a high `maxiter` runs for minutes.
"""

import json
import multiprocessing
import os
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .api import optimize_payload, variants_for
from .grenzen import DEFAULT_STUFE, STUFEN, grenzen_for
from .mdb import MdbError, convert as mdb_convert
from .regelwerk import DEFAULT_REGELWERK_ID, catalog_hash, list_regelwerke
from .splice import splice_payload
from .terrain import sample as terrain_sample, to_lnglat

HOST = os.environ.get("OLT_OPTIMIZER_HOST", "127.0.0.1")
PORT = int(os.environ.get("OLT_OPTIMIZER_PORT", "8099"))
# The page is served from another origin than this service, so the browser asks
# first. Only the origins named here are answered.
ORIGINS = tuple(o.strip() for o in os.environ.get(
    "OLT_OPTIMIZER_ORIGINS",
    "https://open-layout-tool.org,https://www.open-layout-tool.org,"
    "https://online.open-layout-tool.org",
).split(",") if o.strip())
TIMEOUT = float(os.environ.get("OLT_OPTIMIZER_TIMEOUT", "120"))
MAX_BODY = int(os.environ.get("OLT_OPTIMIZER_MAX_BODY", str(4 * 1024 * 1024)))
# Requests at a time, not processes: an `auto` run forks one child per profile
# variant and so occupies two cores while it lasts.
MAX_CONCURRENT = int(os.environ.get("OLT_OPTIMIZER_WORKERS", "2"))
# An Access file is a whole database, not a payload — the delivered test file is
# 33 MB, so this limit is its own and much larger than the optimizer's.
MAX_MDB_BODY = int(os.environ.get("OLT_MDB_MAX_BODY", str(128 * 1024 * 1024)))

# Points per terrain request: a cross section asks for a few hundred, a whole
# station's gradient for a few thousand.
MAX_TERRAIN_POINTS = int(os.environ.get("OLT_TERRAIN_MAX_POINTS", "20000"))

# A splice request is two elements and a few numbers.
MAX_SPLICE_BODY = 64 * 1024

MAX_ITER = 150
MAX_ELEMENTS = 2000

_slots = threading.BoundedSemaphore(MAX_CONCURRENT)


class ServiceError(Exception):
    """A failure with an HTTP status and the key the client translates."""

    def __init__(self, status, code, message=None):
        super().__init__(code)
        self.status = status
        self.code = code
        self.message = message


def _child(pipe, payload):
    try:
        pipe.send((True, optimize_payload(**payload)))
    except ValueError as exc:
        pipe.send((False, str(exc)))
    except Exception as exc:                                   # noqa: BLE001
        pipe.send((False, f"__internal__{exc}"))
    finally:
        pipe.close()


def _spawn(ctx, load):
    """Start one run in its own process; returns (process, receiving end)."""
    rx, tx = ctx.Pipe(duplex=False)
    proc = ctx.Process(target=_child, args=(tx, load), daemon=True)
    proc.start()
    tx.close()                      # the parent's copy, or poll() never ends
    return proc, rx


def run_isolated(payload, timeout=TIMEOUT):
    """Run one optimization under a deadline, in processes that can be killed.

    `uebergang: 'auto'` is up to two runs that know nothing of each other — the
    ramps as they lie, and all of them Bloss where the level admits Bloss
    (api.variants_for: at the Ermessensgrenze) — of which the faster wins.
    They go side by side, one process each: the same answer for half the wait.
    fork keeps that cheap, numpy and scipy being already imported in the
    parent, so a child starts with them in place instead of loading them again.
    """
    ctx = multiprocessing.get_context("fork")
    grenzen = grenzen_for(payload.get("regelwerk") or DEFAULT_REGELWERK_ID,
                          payload.get("grenzwert") or DEFAULT_STUFE)
    try:
        variants = variants_for(payload.get("uebergang", "auto"), grenzen)
    except ValueError as exc:
        raise ServiceError(422, "unsupported_topology", str(exc)) from None
    running = [_spawn(ctx, {**payload, "uebergang": name}) for name in variants]

    deadline = time.monotonic() + timeout
    answers = []
    try:
        for _, rx in running:
            # Read before join: a large result fills the pipe buffer and the
            # child blocks in send() until it is drained.
            if not rx.poll(max(0.0, deadline - time.monotonic())):
                raise ServiceError(504, "timeout")
            try:
                answers.append(rx.recv())
            except EOFError:
                raise ServiceError(500, "internal") from None
    finally:
        for proc, rx in running:
            if proc.is_alive():
                proc.terminate()
            proc.join(5)
            rx.close()

    for ok, value in answers:
        if not ok:
            if value.startswith("__internal__"):
                raise ServiceError(500, "internal", value[len("__internal__"):])
            raise ServiceError(422, "unsupported_topology", value)
    # The faster variant wins and the first one holds a tie — `vNeu` is what
    # `optimize_payload` scores its own variants by, so this is its choice.
    best = answers[0][1]
    for _, value in answers[1:]:
        if value["vNeu"] > best["vNeu"] + 1e-9:
            best = value
    return best


def _as_payload(body):
    """The panel's JSON turned into optimize_payload's arguments."""
    try:
        data = json.loads(body)
    except (ValueError, UnicodeDecodeError):
        raise ServiceError(400, "invalid_payload") from None
    if not isinstance(data, dict):
        raise ServiceError(400, "invalid_payload")
    track = data.get("track")
    if not isinstance(track, dict) or not isinstance(track.get("elements"), list):
        raise ServiceError(400, "invalid_payload")
    if len(track["elements"]) > MAX_ELEMENTS:
        raise ServiceError(413, "too_large")
    regelwerk = data.get("regelwerk")
    # Checked here, not left to optimize_payload's ValueError: an unknown
    # regelwerk id is a bad request (400), not the unsupported-topology 422 a
    # bare ValueError from deeper in would otherwise be read as.
    if regelwerk is not None and not any(rw["id"] == regelwerk for rw in list_regelwerke()):
        raise ServiceError(400, "invalid_regelwerk", regelwerk)
    grenzwert = data.get("grenzwert", DEFAULT_STUFE)
    if grenzwert not in STUFEN:
        raise ServiceError(400, "invalid_grenzwert", str(grenzwert))
    try:
        return {
            "track": track,
            "corridor_cm": float(data.get("corridorCm", 50.0)),
            "grenzwert": grenzwert,
            "uebergang": str(data.get("uebergang", "auto")),
            "per_curve": bool(data.get("perCurve", False)),
            "maxiter": max(1, min(MAX_ITER, int(data.get("maxiter", 100)))),
            "seed": int(data.get("seed", 1)),
            "target_element_idx": data.get("targetElementIdx"),
            "v_max": float(data["vMax"]) if data.get("vMax") else None,
            "regelwerk": regelwerk,
        }
    except (TypeError, ValueError):
        raise ServiceError(400, "invalid_payload") from None


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "olt-optimizer"

    def _cors(self):
        origin = self.headers.get("Origin")
        if origin and origin in ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")

    def _respond(self, status, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):                                      # noqa: N802
        self.send_response(204)
        self._cors()
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):                                          # noqa: N802
        route = self.path.rstrip("/")
        if route in ("/health", ""):
            self._respond(200, {"status": "ok"})
        elif route == "/regelwerke":
            self._respond(200, {"regelwerke": list_regelwerke(), "catalogHash": catalog_hash()})
        elif route.startswith("/regelwerke/"):
            rw_id = route[len("/regelwerke/"):]
            listed = next((rw for rw in list_regelwerke() if rw["id"] == rw_id), None)
            if listed is None:
                self._respond(404, {"error": "not_found"})
            else:
                self._respond(200, {**listed, "grenzwerte": {
                    stufe: grenzen_for(rw_id, stufe).describe() for stufe in STUFEN}})
        else:
            self._respond(404, {"error": "not_found"})

    def _read_body(self, limit):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            raise ServiceError(400, "invalid_payload") from None
        if length > limit:
            raise ServiceError(413, "too_large")
        return self.rfile.read(length)

    def _do_mdb(self):
        """An uploaded Access file, converted and then removed again.

        The file leaves the user's machine to get here, so it lives exactly as
        long as the conversion does — written to a private temp file, deleted in
        `finally` whatever happens.
        """
        body = self._read_body(MAX_MDB_BODY)
        if not body:
            raise ServiceError(400, "invalid_payload")
        fd, path = tempfile.mkstemp(prefix="olt-mdb-", suffix=".mdb")
        try:
            with os.fdopen(fd, "wb") as fh:
                fh.write(body)
            if not _slots.acquire(timeout=TIMEOUT):
                raise ServiceError(503, "busy")
            try:
                started = time.monotonic()
                result = mdb_convert(path)
            finally:
                _slots.release()
        except MdbError as exc:
            status = {"not_a_database": 400, "no_records": 422, "timeout": 504}.get(exc.code, 500)
            if exc.code == "internal":
                self.log_message("mdb failure: %s", exc.message or "?")
                raise ServiceError(500, "internal", exc.message) from None
            raise ServiceError(status, exc.code, exc.message) from None
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass
        self.log_message("mdb %d bytes → %s in %.1fs",
                         len(body), result["counts"], time.monotonic() - started)
        self._respond(200, result)

    def _do_terrain(self):
        """Ground heights for the points of the body, from the Länder's DGM1.

        Not held to the optimizer's slots: a request is a tile download at worst
        and a lookup otherwise, and waiting behind a two-minute optimizer run
        would make the cross section wait for nothing.
        """
        try:
            data = json.loads(self._read_body(MAX_BODY))
        except (ValueError, UnicodeDecodeError):
            raise ServiceError(400, "invalid_payload") from None
        data = data if isinstance(data, dict) else {}
        lnglat, points = data.get("lnglat"), data.get("points")
        given = lnglat if isinstance(lnglat, list) else points
        if not isinstance(given, list):
            raise ServiceError(400, "invalid_payload")
        if len(given) > MAX_TERRAIN_POINTS:
            raise ServiceError(413, "too_large")
        if not isinstance(lnglat, list):
            def back(p):
                try:
                    return to_lnglat(float(p[0]), float(p[1]))
                except (TypeError, ValueError, IndexError):
                    return None
            lnglat = [back(p) for p in points]
        started = time.monotonic()
        heights, sources = terrain_sample(lnglat)
        self.log_message("terrain %d points (%d answered) in %.1fs", len(lnglat),
                         sum(h is not None for h in heights), time.monotonic() - started)
        self._respond(200, {"heights": heights, "sources": sources})

    def _do_splice(self):
        """A splice is a few milliseconds of geometry: answered in this thread, no
        child process and no slot. One that does not fit is an answer, not a
        failure — it comes back with 200 and its error key."""
        body = self._read_body(MAX_SPLICE_BODY)
        try:
            payload = json.loads(body.decode("utf-8"))
            result = splice_payload(payload)
        except (ValueError, KeyError, TypeError, UnicodeDecodeError):
            raise ServiceError(400, "invalid_payload")
        self._respond(200, result)

    def do_POST(self):                                         # noqa: N802
        route = self.path.rstrip("/")
        if route == "/splice":
            try:
                self._do_splice()
            except ServiceError as exc:
                self._respond(exc.status, {"error": exc.code})
            except Exception:                                  # noqa: BLE001
                self._respond(500, {"error": "internal"})
            return
        if route in ("/mdb", "/terrain"):
            try:
                self._do_mdb() if route == "/mdb" else self._do_terrain()
            except ServiceError as exc:
                answer = {"error": exc.code}
                if exc.message and exc.code != "internal":
                    answer["message"] = exc.message
                self._respond(exc.status, answer)
            except Exception:                                  # noqa: BLE001
                self._respond(500, {"error": "internal"})
            return
        if route != "/optimize":
            self._respond(404, {"error": "not_found"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            self._respond(400, {"error": "invalid_payload"})
            return
        if length > MAX_BODY:
            self._respond(413, {"error": "too_large"})
            return
        try:
            payload = _as_payload(self.rfile.read(length))
            if not _slots.acquire(timeout=TIMEOUT):
                raise ServiceError(503, "busy")
            try:
                started = time.monotonic()
                result = run_isolated(payload)
            finally:
                _slots.release()
        except ServiceError as exc:
            # `message` names the topology the optimizer will not take — that
            # belongs in front of the user. An internal failure does not; it
            # goes to the log and the client gets the bare key.
            answer = {"error": exc.code}
            if exc.code == "internal":
                self.log_message("internal failure: %s", exc.message or "?")
            elif exc.message:
                answer["message"] = exc.message
            self._respond(exc.status, answer)
            return
        except Exception:                                      # noqa: BLE001
            self._respond(500, {"error": "internal"})
            return
        self.log_message("optimize %d elements in %.1fs",
                         len(payload["track"]["elements"]), time.monotonic() - started)
        self._respond(200, result)

    def log_message(self, fmt, *args):
        print(f"[{self.log_date_time_string()}] {fmt % args}", flush=True)


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"olt-optimizer on http://{HOST}:{PORT} "
          f"(timeout {TIMEOUT:.0f}s, {MAX_CONCURRENT} parallel)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
