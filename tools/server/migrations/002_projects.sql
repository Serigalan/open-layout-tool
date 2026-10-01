-- Projects, their variants and the revisions of those (AP 10.5).
-- Deleting is soft: a project gets deleted_at, a variant archived.
CREATE TABLE project (
  id          TEXT    PRIMARY KEY,
  title       TEXT    NOT NULL,
  description TEXT,
  created_by  INTEGER NOT NULL REFERENCES user(id),
  created_at  TEXT    NOT NULL,
  deleted_at  TEXT
);

-- A revision is immutable: the whole dehydrated record (gzip), the id log of
-- the splits and joins it brought, and the keys of the validation errors it
-- already had — what a later revision on top of it is measured against.
CREATE TABLE revision (
  id              INTEGER PRIMARY KEY,
  project_id      TEXT    NOT NULL REFERENCES project(id),
  number          INTEGER NOT NULL,
  variant_id      TEXT    NOT NULL,
  parent_id       INTEGER REFERENCES revision(id),
  merge_parent_id INTEGER REFERENCES revision(id),
  author_id       INTEGER NOT NULL REFERENCES user(id),
  created_at      TEXT    NOT NULL,
  message         TEXT    NOT NULL DEFAULT '',
  schema_version  INTEGER NOT NULL,
  payload         BLOB    NOT NULL,
  remaps          TEXT    NOT NULL DEFAULT '[]',
  error_keys      TEXT    NOT NULL DEFAULT '[]',
  UNIQUE (project_id, number)
);
CREATE INDEX revision_project ON revision(project_id);

CREATE TABLE variant (
  id                TEXT    PRIMARY KEY,
  project_id        TEXT    NOT NULL REFERENCES project(id),
  name              TEXT    NOT NULL,
  parent_variant_id TEXT    REFERENCES variant(id),
  head_revision_id  INTEGER NOT NULL REFERENCES revision(id),
  created_by        INTEGER NOT NULL REFERENCES user(id),
  created_at        TEXT    NOT NULL,
  archived          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX variant_project ON variant(project_id);

-- Images, by the SHA-256 of their bytes: a revision names the hash, and an
-- image that stays the same is stored once however many revisions carry it.
CREATE TABLE blob (
  hash       TEXT    PRIMARY KEY,
  mime       TEXT    NOT NULL,
  size       INTEGER NOT NULL,
  data       BLOB    NOT NULL,
  created_by INTEGER REFERENCES user(id),
  created_at TEXT    NOT NULL
);
