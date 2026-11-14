-- A separate stable append sequence preserves every original ledger row and
-- avoids sorting same-millisecond or backdated events by random text IDs.
CREATE TABLE member_ledger_sequence (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_id TEXT NOT NULL UNIQUE REFERENCES member_reward_ledger(id)
);
INSERT INTO member_ledger_sequence(ledger_id) SELECT id FROM member_reward_ledger ORDER BY rowid;
CREATE TRIGGER member_ledger_sequence_insert AFTER INSERT ON member_reward_ledger BEGIN
  INSERT INTO member_ledger_sequence(ledger_id) VALUES (NEW.id);
END;
CREATE TRIGGER member_ledger_sequence_no_update BEFORE UPDATE ON member_ledger_sequence BEGIN SELECT RAISE(ABORT,'Ledger sequence is append-only'); END;
CREATE TRIGGER member_ledger_sequence_no_delete BEFORE DELETE ON member_ledger_sequence BEGIN SELECT RAISE(ABORT,'Ledger sequence is append-only'); END;
CREATE TABLE member_reward_audits (
  grant_id TEXT PRIMARY KEY REFERENCES member_reward_grants(id),
  state TEXT NOT NULL DEFAULT 'unchecked' CHECK(state IN ('unchecked','matched','difference')),
  differences TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(differences)),
  snapshot TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(snapshot)),
  fingerprint TEXT NOT NULL DEFAULT '',
  grant_version INTEGER NOT NULL DEFAULT -1,
  checked_at INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX member_reward_audit_due ON member_reward_audits(checked_at);
