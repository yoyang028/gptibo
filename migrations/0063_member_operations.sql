CREATE TABLE member_order_reconciliations (
  order_id TEXT PRIMARY KEY REFERENCES orders(id),
  state TEXT NOT NULL DEFAULT 'unchecked' CHECK(state IN ('unchecked','matched','difference','expected','error')),
  differences TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(differences)),
  local_snapshot TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(local_snapshot)),
  upstream_snapshot TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(upstream_snapshot)),
  fingerprint TEXT NOT NULL DEFAULT '',
  checked_at INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX member_reconciliation_due ON member_order_reconciliations(checked_at);
CREATE INDEX member_reconciliation_state ON member_order_reconciliations(state,checked_at);
CREATE TABLE member_operation_events (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  target_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  note TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(details)),
  created_at INTEGER NOT NULL
);
CREATE INDEX member_operation_history ON member_operation_events(category,target_id,created_at);
CREATE TRIGGER member_operation_no_update BEFORE UPDATE ON member_operation_events BEGIN SELECT RAISE(ABORT,'Operation history is append-only'); END;
CREATE TRIGGER member_operation_no_delete BEFORE DELETE ON member_operation_events BEGIN SELECT RAISE(ABORT,'Operation history is append-only'); END;
