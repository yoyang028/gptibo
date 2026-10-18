-- Removed catalogue entries must not reappear in management pickers. Order and
-- CRM foreign keys may retain a disabled plan, while active product rows are deleted.
CREATE TABLE catalog_deletions (
  plan_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  reason TEXT NOT NULL,
  removed_at INTEGER NOT NULL,
  change_id TEXT NOT NULL
);
CREATE INDEX catalog_deletions_change ON catalog_deletions(change_id);
