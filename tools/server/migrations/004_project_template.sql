-- A template project (start page "Templates"): everyone branches a variant of
-- their own off it, only an admin changes its root variants or the project.
ALTER TABLE project ADD COLUMN template INTEGER NOT NULL DEFAULT 0;
