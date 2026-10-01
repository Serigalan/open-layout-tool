-- The image a revision names (its record's imageHash), kept beside the packed
-- record so the project list can show it without unpacking anything.
ALTER TABLE revision ADD COLUMN image_hash TEXT;
