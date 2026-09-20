"""HTTP service around `optimize_payload` — the optimizer as it runs on the server.

    POST /optimize   body: the panel's payload, answer: optimize_payload's result
    POST /mdb        body: an Access file, answer: its Satzarten as JSON
    GET  /health     so the panel can say "no server" before the user clicks

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

from .api import optimize_payload
from .mdb import MdbError, convert as mdb_convert

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
MAX_CONCURRENT = int(os.environ.get("OLT_OPTIMIZER_WORKERS", "2"))
# An Access file is a whole database, not a payload — the delivered test file is
# 33 MB, so this limit is its own and much larger than the optimizer's.
MAX_MDB_BODY = int(os.environ.get("OLT_MDB_MAX_BODY", str(128 * 1024 * 1024)))

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


def run_isolated(payload, timeout=TIMEOUT):
    """Run one optimization under a deadline, in a process that can be killed.

    fork keeps this cheap: numpy and scipy are already imported in the parent,
    so the child starts with them in place instead of loading them again.
    """
    ctx = multiprocessing.get_context("fork")
    rx, tx = ctx.Pipe(duplex=False)
    proc = ctx.Process(target=_child, args=(tx, payload), daemon=True)
    proc.start()
    tx.close()                      # the parent's copy, or poll() never ends
    try:
        # Read before join: a large result fills the pipe buffer and the child
        # blocks in send() until it is drained.
        if not rx.poll(timeout):
            raise ServiceError(504, "timeout")
        try:
            ok, value = rx.recv()
        except EOFError:
            raise ServiceError(500, "internal") from None
    finally:
        if proc.is_alive():
            proc.terminate()
        proc.join(5)
        rx.close()
    if ok:
        return value
    if value.startswith("__internal__"):
        raise ServiceError(500, "internal", value[len("__internal__"):])
    raise ServiceError(422, "unsupported_topology", value)


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
    try:
        return {
            "track": track,
            "corridor_cm": float(data.get("corridorCm", 50.0)),
            "uf": float(data.get("uf", 130.0)),
            "uebergang": str(data.get("uebergang", "auto")),
            "per_curve": bool(data.get("perCurve", False)),
            "maxiter": max(1, min(MAX_ITER, int(data.get("maxiter", 100)))),
            "seed": int(data.get("seed", 1)),
            "target_element_idx": data.get("targetElementIdx"),
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
        if self.path.rstrip("/") in ("/health", ""):
            self._respond(200, {"status": "ok"})
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

    def do_POST(self):                                         # noqa: N802
        route = self.path.rstrip("/")
        if route == "/mdb":
            try:
                self._do_mdb()
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
