CREATE TABLE member_order_signals (
  order_id TEXT PRIMARY KEY REFERENCES orders(id),
  customer_key TEXT NOT NULL,
  member_id TEXT REFERENCES member_s3_user(id),
  ip_key TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX member_signal_customer ON member_order_signals(customer_key,created_at);
CREATE INDEX member_signal_member ON member_order_signals(member_id,created_at);
CREATE INDEX member_signal_ip ON member_order_signals(ip_key,created_at);
CREATE INDEX member_risk_owner_orders ON orders(owner_store_id,owner_hash,created_at);
CREATE TABLE member_risk_subjects (
  kind TEXT NOT NULL CHECK(kind IN ('member','customer','browser')),
  subject_key TEXT NOT NULL,
  latest_order_id TEXT NOT NULL REFERENCES orders(id),
  last_order_at INTEGER NOT NULL,
  checked_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(kind,subject_key)
);
INSERT OR IGNORE INTO member_risk_subjects(kind,subject_key,latest_order_id,last_order_at)
  SELECT 'member',member_id,order_id,created_at FROM member_order_promotions WHERE member_id IS NOT NULL ORDER BY created_at DESC,order_id DESC;
INSERT OR IGNORE INTO member_risk_subjects(kind,subject_key,latest_order_id,last_order_at)
  SELECT 'customer',customer_key,order_id,created_at FROM member_order_promotions ORDER BY created_at DESC,order_id DESC;
INSERT OR IGNORE INTO member_risk_subjects(kind,subject_key,latest_order_id,last_order_at)
  SELECT 'browser',owner_hash,id,created_at FROM orders WHERE owner_store_id='store-3' AND partner_id IS NULL AND mode='live' AND is_test=0
    AND plan IN ('plus','pro-5x','pro-20x','pro-25x') ORDER BY created_at DESC,id DESC;
CREATE TABLE member_risk_cases (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('member','customer','browser')),
  subject_key TEXT NOT NULL,
  latest_order_id TEXT NOT NULL REFERENCES orders(id),
  flags TEXT NOT NULL CHECK(json_valid(flags)),
  metrics TEXT NOT NULL CHECK(json_valid(metrics)),
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('open','acknowledged','resolved')),
  episode INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 0,
  last_action_id TEXT,
  first_seen_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(kind,subject_key)
);
CREATE INDEX member_risk_case_status ON member_risk_cases(status,updated_at);
