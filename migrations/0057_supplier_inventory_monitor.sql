-- Stock synchronization never deletes an owner's products, prices or artwork.
CREATE TABLE hanfolk_sync_settings (
  id TEXT PRIMARY KEY CHECK(id='main'),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  interval_minutes INTEGER NOT NULL DEFAULT 5 CHECK(interval_minutes IN (5,10,30)),
  version INTEGER NOT NULL DEFAULT 0,
  change_id TEXT NOT NULL DEFAULT '',
  last_attempt_at INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  lease_until INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT NOT NULL DEFAULT ''
);
INSERT INTO hanfolk_sync_settings(id) VALUES('main');

CREATE TABLE hanfolk_inventory (
  local_id TEXT PRIMARY KEY REFERENCES shop_products(id),
  stock INTEGER NOT NULL CHECK(stock>=0),
  source_state TEXT NOT NULL CHECK(source_state IN ('available','replenishing','removed')),
  checked_at INTEGER NOT NULL,
  key_hash TEXT NOT NULL
);

CREATE TABLE hanfolk_sync_runs (
  id TEXT PRIMARY KEY,
  trigger TEXT NOT NULL CHECK(trigger IN ('manual','scheduled')),
  status TEXT NOT NULL CHECK(status IN ('running','success','failed','superseded')),
  started_at INTEGER NOT NULL,
  finished_at INTEGER NOT NULL DEFAULT 0,
  product_count INTEGER NOT NULL DEFAULT 0,
  variant_count INTEGER NOT NULL DEFAULT 0,
  change_count INTEGER NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT ''
);
CREATE INDEX hanfolk_sync_runs_started ON hanfolk_sync_runs(started_at DESC);
CREATE TABLE hanfolk_sync_changes (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  local_id TEXT,
  product_id INTEGER NOT NULL,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('new','stock','removed','restocked','price')),
  before_stock INTEGER,
  after_stock INTEGER,
  before_cost INTEGER,
  after_cost INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX hanfolk_sync_changes_created ON hanfolk_sync_changes(created_at DESC);
CREATE INDEX hanfolk_sync_changes_run ON hanfolk_sync_changes(run_id);
