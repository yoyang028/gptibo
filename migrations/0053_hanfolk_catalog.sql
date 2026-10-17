-- Read-only supplier catalog integration; no payment or procurement enablement.
CREATE TABLE hanfolk_settings (
  id TEXT PRIMARY KEY CHECK(id='main'),
  api_secret TEXT NOT NULL DEFAULT '',
  key_hash TEXT NOT NULL DEFAULT '',
  checked_key_hash TEXT NOT NULL DEFAULT '',
  balance_cents INTEGER,
  checked_at INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,
  change_id TEXT NOT NULL DEFAULT ''
);
INSERT INTO hanfolk_settings(id) VALUES('main');
CREATE TABLE hanfolk_catalog (
  product_id INTEGER PRIMARY KEY,
  summary TEXT NOT NULL,
  detail TEXT,
  key_hash TEXT NOT NULL,
  checked_at INTEGER NOT NULL
);
CREATE TABLE hanfolk_product_links (
  local_id TEXT PRIMARY KEY REFERENCES shop_products(id),
  product_id INTEGER NOT NULL,
  sku TEXT NOT NULL,
  cost_cents INTEGER NOT NULL,
  imported_at INTEGER NOT NULL,
  source_hash TEXT NOT NULL,
  UNIQUE(product_id,sku)
);
