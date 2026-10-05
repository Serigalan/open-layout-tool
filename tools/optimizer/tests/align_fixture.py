"""Writes src/test/fixtures/align_answer.json: a real answer of the alignment
fit for the app's own tests (src/utils/alignmentFit.test.js), so the app's half
— the new track from the answer, the diagram, the report — is tested against
what the service really says. Run again after changing alignment_fit.py:

    WEBSITE/.venv/bin/python tools/optimizer/tests/align_fixture.py
"""

import json
import os
import pathlib
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from olt_optimizer.alignment_fit import align_payload, chain_from, chain_points  # noqa: E402

# 80 m straight, 30 m clothoid into R 400 left for 60 m, 30 m out, 80 m straight;
# a point every metre, a millimetre of scatter, in DB_REF GK4 (EPSG 5684).
pieces = chain_from((4467300.0, 5333800.0), 110.0, [
    ("straight", 80, None), ("transition", 30, (None, -400.0)), ("arc", 60, -400.0),
    ("transition", 30, (-400.0, None)), ("straight", 80, None)])
poly, _ = chain_points(pieces)
along = np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(poly, axis=0).T))])
st = np.arange(0.0, along[-1], 1.0)
pts = np.stack([np.interp(st, along, poly[:, 0]), np.interp(st, along, poly[:, 1])], axis=1)
pts += np.random.default_rng(7).normal(0.0, 0.001, pts.shape)
request = {"points": [[round(e, 4), round(n, 4)] for e, n in pts], "station0": 35.5}
answer = align_payload(request)
out = pathlib.Path(__file__).resolve().parents[3] / "src" / "test" / "fixtures" / "align_answer.json"
out.write_text(json.dumps({"epsg": 5684, "request": request, "answer": answer}) + "\n", encoding="utf-8")
print(f"{out}: {len(answer['elements'])} elements, curves {[(c['radius'], c['l1'], c['l2']) for c in answer['curves']]}")
