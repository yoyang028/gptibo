-- Central credentials and operator-controlled publishing. No sales open by migration.
CREATE TABLE sms_settings (
  id TEXT PRIMARY KEY CHECK(id='grizzly'),
  api_secret TEXT NOT NULL DEFAULT '',
  key_hash TEXT NOT NULL DEFAULT '',
  checked_key_hash TEXT NOT NULL DEFAULT '',
  cny_per_usd TEXT NOT NULL DEFAULT '',
  projects TEXT NOT NULL,
  balance_usd TEXT,
  quotes TEXT NOT NULL DEFAULT '{}',
  checked_at INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,
  change_id TEXT NOT NULL DEFAULT ''
);
INSERT INTO sms_settings(id,projects) VALUES('grizzly','[{"service":"dr","priceCents":1580,"maxPriceUsd":"","visible":true,"selling":false},{"service":"acz","priceCents":1980,"maxPriceUsd":"","visible":true,"selling":false},{"service":"go","priceCents":2580,"maxPriceUsd":"","visible":true,"selling":false}]');
ALTER TABLE grizzly_activations ADD COLUMN country TEXT;
ALTER TABLE grizzly_activations ADD COLUMN supplier_cancelled_at INTEGER;
ALTER TABLE grizzly_activations ADD COLUMN supplier_refund_usd TEXT;
ALTER TABLE grizzly_activations ADD COLUMN supplier_refund_reference TEXT;
ALTER TABLE grizzly_activations ADD COLUMN supplier_refund_confirmed_at INTEGER;
CREATE TABLE sms_allocation_attempts (
  order_id TEXT NOT NULL REFERENCES orders(id),
  country TEXT NOT NULL CHECK(country IN ('187','12')),
  state TEXT NOT NULL CHECK(state IN ('requested','no_numbers','received','unknown','rejected')),
  quoted_usd TEXT NOT NULL,
  max_price_usd TEXT NOT NULL,
  activation_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(order_id,country)
);
CREATE TABLE sms_supplier_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  kind TEXT NOT NULL CHECK(kind IN ('purchase','cancel','refund-confirmed')),
  amount_usd TEXT,
  reference TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  UNIQUE(order_id,kind,reference)
);
