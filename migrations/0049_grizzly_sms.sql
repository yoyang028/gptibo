-- One durable allocation attempt per shop order. Grizzly has no merchant-order
-- idempotency parameter: a lost getNumberV2 response must never buy a second number.
CREATE TABLE grizzly_activations (
  order_id TEXT PRIMARY KEY REFERENCES orders(id),
  activation_id TEXT UNIQUE,
  phone TEXT,
  code TEXT,
  state TEXT NOT NULL DEFAULT 'ready' CHECK(state IN ('ready','allocating','waiting','received','cancelled','unknown','failed','review')),
  attempted INTEGER NOT NULL DEFAULT 0 CHECK(attempted IN (0,1)),
  cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK(cancel_requested IN (0,1)),
  completed_at INTEGER,
  expires_at INTEGER,
  next_poll_at INTEGER NOT NULL DEFAULT 0,
  cost_usd TEXT,
  error TEXT NOT NULL DEFAULT '',
  lease_token TEXT NOT NULL DEFAULT '',
  lease_until INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX grizzly_poll_due ON grizzly_activations(next_poll_at) WHERE state IN ('ready','allocating','waiting','received');
-- A refund cannot race an allocation, or leave an active number usable while
-- money is returned. The buyer stops reception before requesting a refund.
CREATE TRIGGER grizzly_refund_guard BEFORE INSERT ON refund_cases
WHEN EXISTS(SELECT 1 FROM grizzly_activations g WHERE g.order_id=NEW.order_id
  AND (g.lease_until>CAST(unixepoch('subsec')*1000 AS INTEGER)
    OR g.state IN ('allocating','waiting','unknown','review')))
BEGIN SELECT RAISE(ABORT,'sms activation requires reconciliation'); END;
