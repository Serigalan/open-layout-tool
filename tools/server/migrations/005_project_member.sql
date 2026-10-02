-- Who may see and edit a project besides its creator and the admins (decision
-- 127, replacing "every user sees every project" of decision 99). Templates
-- stay open to everyone: branching off one is what they are for.
CREATE TABLE project_member (
  project_id TEXT    NOT NULL REFERENCES project(id),
  user_id    INTEGER NOT NULL REFERENCES user(id),
  added_by   INTEGER REFERENCES user(id),
  added_at   TEXT    NOT NULL,
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX project_member_user ON project_member(user_id);

-- Nobody loses a project they have already worked on: whoever wrote a
-- revision or made a variant of one stays on it.
INSERT OR IGNORE INTO project_member (project_id, user_id, added_by, added_at)
SELECT DISTINCT p.id, w.user_id, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM project p
JOIN (SELECT project_id, author_id AS user_id FROM revision
      UNION SELECT project_id, created_by FROM variant) w ON w.project_id = p.id
WHERE p.template = 0 AND w.user_id <> p.created_by;
