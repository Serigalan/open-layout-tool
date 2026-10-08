-- Point clouds on the server (phase 13, AP 13.1). A cloud belongs to a
-- project and is seen by everyone who sees the project; changing anything
-- about it is the admins' and the users' with the right below (decision 203).
ALTER TABLE user ADD COLUMN can_edit_clouds INTEGER NOT NULL DEFAULT 0;

-- One delivery: the file as uploaded, then the levels of detail made from it.
-- status: uploading → queued → processing → ready, or failed on the way.
-- crs NULL is a cloud in a local system ("Lokal / unbekannt", decision 214).
-- levels holds per level what its index says of it (points, bytes, tiles …);
-- the tiles themselves lie in files under OLT_SERVER_CLOUDS.
CREATE TABLE point_cloud (
  id          TEXT    PRIMARY KEY,
  project_id  TEXT    NOT NULL REFERENCES project(id),
  name        TEXT    NOT NULL,
  file_name   TEXT    NOT NULL,
  file_size   INTEGER NOT NULL,
  format      TEXT    NOT NULL CHECK (format IN ('las', 'laz', 'e57')),
  crs         INTEGER,
  height_epsg INTEGER NOT NULL,
  status      TEXT    NOT NULL CHECK (status IN ('uploading', 'queued', 'processing', 'ready', 'failed')),
  received    INTEGER NOT NULL DEFAULT 0,
  sha256      TEXT,
  keep_raw    INTEGER NOT NULL DEFAULT 0,
  source_points INTEGER NOT NULL DEFAULT 0,
  points      INTEGER,
  bytes       INTEGER NOT NULL DEFAULT 0,
  rgb         INTEGER NOT NULL DEFAULT 0,
  bounds      TEXT,
  levels      TEXT    NOT NULL DEFAULT '[]',
  progress    REAL,
  error       TEXT,
  created_by  INTEGER NOT NULL REFERENCES user(id),
  created_at  TEXT    NOT NULL,
  ready_at    TEXT
);
CREATE INDEX point_cloud_project ON point_cloud(project_id);

-- The queue of the service olt-cloudjobs (AP 13.3).
CREATE TABLE cloud_job (
  id          INTEGER PRIMARY KEY,
  cloud_id    TEXT    NOT NULL REFERENCES point_cloud(id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL,
  status      TEXT    NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
  created_by  INTEGER NOT NULL REFERENCES user(id),
  created_at  TEXT    NOT NULL,
  started_at  TEXT,
  finished_at TEXT,
  error       TEXT
);
CREATE INDEX cloud_job_status ON cloud_job(status);

-- The history of a cloud's re-referencing (decision 211, AP 13.12–13.15): a
-- spatial Helmert transformation with what it was found from; at most one
-- entry per cloud is active.
CREATE TABLE point_cloud_transform (
  id          INTEGER PRIMARY KEY,
  cloud_id    TEXT    NOT NULL REFERENCES point_cloud(id) ON DELETE CASCADE,
  matrix      TEXT    NOT NULL,
  params      TEXT    NOT NULL DEFAULT '{}',
  pairs       TEXT    NOT NULL DEFAULT '[]',
  residuals   TEXT    NOT NULL DEFAULT '{}',
  reference_cloud_id TEXT,
  active      INTEGER NOT NULL DEFAULT 0,
  created_by  INTEGER NOT NULL REFERENCES user(id),
  created_at  TEXT    NOT NULL
);
CREATE INDEX point_cloud_transform_cloud ON point_cloud_transform(cloud_id);
