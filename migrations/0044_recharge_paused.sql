-- A paused vendor task never grants permission to create another attempt.
ALTER TABLE recharge_redemptions ADD COLUMN paused INTEGER NOT NULL DEFAULT 0 CHECK(paused IN (0,1));
-- Local rejected requests do not necessarily consume a vendor attempt number.
ALTER TABLE recharge_redemptions ADD COLUMN remote_attempt_no INTEGER CHECK(remote_attempt_no > 0);
-- A per-insertion claim keeps duplicate concurrent webhook deliveries from
-- repeatedly waking the same order inside a D1 atomic batch.
ALTER TABLE recharge_webhooks ADD COLUMN delivery_claim TEXT;
