-- Long runs over a project's clouds on the server (phase 13, AP 13.7): the
-- clearance check along a whole track and the trace of a track's rail heads.
-- The browser sends what they need of its working copy — the track, the
-- guide — in params; the clouds they read are the project's ready ones on the
-- server, their ids kept in clouds. What they find is kept in result until
-- the run is old (decision 238).
-- status: queued → running → done, or failed or cancelled on the way.
CREATE TABLE cloud_run (
  id          INTEGER PRIMARY KEY,
  project_id  TEXT    NOT NULL REFERENCES project(id),
  kind        TEXT    NOT NULL CHECK (kind IN ('clearance', 'trace')),
  status      TEXT    NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  subject     TEXT    NOT NULL DEFAULT '{}',
  params      TEXT    NOT NULL,
  clouds      TEXT    NOT NULL DEFAULT '[]',
  progress    REAL,
  result      TEXT,
  error       TEXT,
  created_by  INTEGER NOT NULL REFERENCES user(id),
  created_at  TEXT    NOT NULL,
  started_at  TEXT,
  finished_at TEXT
);
CREATE INDEX cloud_run_project ON cloud_run(project_id, id);
CREATE INDEX cloud_run_status ON cloud_run(status);
