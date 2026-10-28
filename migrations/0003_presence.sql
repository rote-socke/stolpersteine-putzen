-- Opt-in live positions: only the latest position per device, ignored after 10 minutes
-- and deleted on later writes. No history.
CREATE TABLE presence (
  device_id  TEXT PRIMARY KEY,
  group_id   TEXT NOT NULL REFERENCES groups(id),
  lat        REAL,
  lon        REAL,
  accuracy   REAL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX presence_group ON presence(group_id);
