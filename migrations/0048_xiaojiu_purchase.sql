CREATE TABLE xiaojiu_api_controls (
  credential_hash TEXT PRIMARY KEY,
  paused INTEGER NOT NULL DEFAULT 0 CHECK(paused IN (0,1)),
  retry_at INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL DEFAULT 0,
  requests INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT NOT NULL DEFAULT '',
  lease_until INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE shop_order_details ADD COLUMN supplier_error TEXT NOT NULL DEFAULT '';
ALTER TABLE shop_order_details ADD COLUMN supplier_attempted INTEGER NOT NULL DEFAULT 0 CHECK(supplier_attempted IN (0,1));
