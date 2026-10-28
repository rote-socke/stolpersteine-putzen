CREATE TABLE groups (
  id         TEXT PRIMARY KEY,           -- g_<random>
  name       TEXT NOT NULL,
  name_key   TEXT NOT NULL UNIQUE,       -- lower-cased name, for case-insensitive uniqueness
  token_hash TEXT NOT NULL UNIQUE,       -- SHA-256 hex of the token
  created_at INTEGER NOT NULL
);

-- A row exists only for on_the_way and cleaned; open locations have no row.
CREATE TABLE location_state (
  location_id TEXT PRIMARY KEY,
  status      TEXT NOT NULL CHECK (status IN ('open', 'on_the_way', 'cleaned')),
  group_id    TEXT REFERENCES groups(id),
  updated_at  INTEGER NOT NULL
);
CREATE INDEX location_state_group ON location_state(group_id);

CREATE TABLE notes (
  location_id TEXT PRIMARY KEY,
  text        TEXT NOT NULL,
  group_id    TEXT REFERENCES groups(id),
  updated_at  INTEGER NOT NULL
);
