-- Users and their sessions (AP 10.4). A user is never deleted, only
-- deactivated: revisions name their author for good.
CREATE TABLE user (
  id                   INTEGER PRIMARY KEY,
  login                TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  name                 TEXT    NOT NULL,
  password_hash        TEXT    NOT NULL,
  role                 TEXT    NOT NULL CHECK (role IN ('admin', 'user')),
  active               INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT    NOT NULL,
  last_login_at        TEXT
);

-- The token itself never reaches the database, only its hash.
CREATE TABLE session (
  token_hash   TEXT    PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES user(id),
  created_at   TEXT    NOT NULL,
  last_seen_at TEXT    NOT NULL,
  expires_at   TEXT    NOT NULL
);
CREATE INDEX session_user ON session(user_id);
