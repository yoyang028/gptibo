CREATE TABLE product_artwork (
  product_id TEXT PRIMARY KEY,
  settings TEXT NOT NULL CHECK (json_valid(settings)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at INTEGER NOT NULL,
  change_id TEXT NOT NULL
);
