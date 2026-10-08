-- Read-only links to a project's point clouds in the 3D view: whoever has the
-- link sees the clouds and the tracks of one variant without signing in, and
-- changes nothing. The token is the link's secret; it is kept as it is, so the
-- link can be copied again from the list — what it opens lies in this
-- database anyway. cloud_ids is a JSON list of the clouds shown, NULL for all
-- ready clouds of the project as they come. A link with expires_at past, or
-- deleted (revoked), opens nothing.
CREATE TABLE share_link (
  id          INTEGER PRIMARY KEY,
  token       TEXT    NOT NULL UNIQUE,
  project_id  TEXT    NOT NULL REFERENCES project(id),
  variant_id  TEXT    REFERENCES variant(id),
  cloud_ids   TEXT,
  label       TEXT    NOT NULL DEFAULT '',
  created_by  INTEGER NOT NULL REFERENCES user(id),
  created_at  TEXT    NOT NULL,
  expires_at  TEXT
);
CREATE INDEX share_link_project ON share_link(project_id, id);
