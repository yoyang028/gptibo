-- Provision empty primary-shop membership tables. Existing member, order and
-- ledger records remain in their original tables. The scoped Worker reuses the
-- same business statements, constraints, and append-only triggers in both shops.

-- Consumer identity is deliberately separate from CRM, reseller and admin identities.
-- These tables belong exclusively to store-3. Another shop must use its own models.
CREATE TABLE member_platform_user (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  emailVerified INTEGER NOT NULL DEFAULT 0 CHECK(emailVerified IN (0,1)),
  image TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE TABLE member_platform_session (
  id TEXT PRIMARY KEY,
  expiresAt INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  userId TEXT NOT NULL REFERENCES member_platform_user(id) ON DELETE CASCADE
);
CREATE INDEX member_platform_session_user ON member_platform_session(userId);
CREATE INDEX member_platform_session_expiry ON member_platform_session(expiresAt);
CREATE TABLE member_platform_account (
  id TEXT PRIMARY KEY,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES member_platform_user(id) ON DELETE CASCADE,
  accessToken TEXT,
  refreshToken TEXT,
  idToken TEXT,
  accessTokenExpiresAt INTEGER,
  refreshTokenExpiresAt INTEGER,
  scope TEXT,
  password TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  UNIQUE(providerId,accountId)
);
CREATE INDEX member_platform_account_user ON member_platform_account(userId);
CREATE TABLE member_platform_verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt INTEGER NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX member_platform_verification_identifier ON member_platform_verification(identifier);

CREATE TABLE member_platform_profiles (
  id TEXT PRIMARY KEY REFERENCES member_platform_user(id),
  store_id TEXT NOT NULL DEFAULT 'platform' CHECK(store_id='platform'),
  invite_code TEXT NOT NULL UNIQUE,
  frozen INTEGER NOT NULL DEFAULT 0 CHECK(frozen IN (0,1)),
  version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE member_platform_order_promotions (
  order_id TEXT PRIMARY KEY REFERENCES orders(id),
  store_id TEXT NOT NULL CHECK(store_id='platform'),
  member_id TEXT REFERENCES member_platform_profiles(id),
  referrer_id TEXT REFERENCES member_platform_profiles(id),
  invite_code TEXT NOT NULL DEFAULT '',
  customer_key TEXT NOT NULL,
  original_cents INTEGER NOT NULL CHECK(original_cents>0),
  newcomer_cents INTEGER NOT NULL DEFAULT 0 CHECK(newcomer_cents IN (0,500)),
  reward_cents INTEGER NOT NULL DEFAULT 0 CHECK(reward_cents>=0),
  other_cents INTEGER NOT NULL DEFAULT 0 CHECK(other_cents>=0),
  cash_cents INTEGER NOT NULL CHECK(cash_cents>=0),
  refund_observed_cents INTEGER NOT NULL DEFAULT 0 CHECK(refund_observed_cents>=0),
  supply_cents INTEGER NOT NULL CHECK(supply_cents>=0),
  supplier_snapshot TEXT NOT NULL CHECK(json_valid(supplier_snapshot)),
  request_hash TEXT NOT NULL,
  review_status TEXT NOT NULL CHECK(review_status IN ('none','required','approved','rejected')),
  review_note TEXT NOT NULL DEFAULT '',
  risk_flags TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(risk_flags)),
  procurement_status TEXT NOT NULL CHECK(procurement_status IN ('ready','awaiting_supplier')),
  allocation_status TEXT NOT NULL DEFAULT 'reserved' CHECK(allocation_status IN ('reserved','captured','released','restored')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK(original_cents=newcomer_cents+reward_cents+other_cents+cash_cents),
  CHECK(newcomer_cents=0 OR reward_cents=0),
  CHECK(reward_cents=0 OR member_id IS NOT NULL)
);
CREATE INDEX member_platform_promotion_owner ON member_platform_order_promotions(member_id,created_at);
CREATE INDEX member_platform_promotion_review ON member_platform_order_promotions(review_status,created_at);
CREATE INDEX member_platform_promotion_referrer ON member_platform_order_promotions(referrer_id,created_at);
CREATE TABLE member_platform_first_purchases (
  store_id TEXT NOT NULL CHECK(store_id='platform'),
  customer_key TEXT NOT NULL,
  order_id TEXT NOT NULL UNIQUE REFERENCES member_platform_order_promotions(order_id),
  PRIMARY KEY(store_id,customer_key)
);
CREATE TABLE member_platform_reward_grants (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL CHECK(store_id='platform'),
  member_id TEXT NOT NULL REFERENCES member_platform_profiles(id),
  source_order_id TEXT NOT NULL UNIQUE REFERENCES member_platform_order_promotions(order_id),
  amount_cents INTEGER NOT NULL DEFAULT 1000 CHECK(amount_cents=1000),
  remaining_cents INTEGER NOT NULL DEFAULT 1000,
  reserved_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('pending','active','cancelled','expired','frozen')),
  delivered_at INTEGER NOT NULL,
  eligible_at INTEGER NOT NULL,
  expires_at INTEGER,
  version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  CHECK(reserved_cents>=0 AND remaining_cents>=reserved_cents AND remaining_cents<=amount_cents)
);
CREATE INDEX member_platform_reward_available ON member_platform_reward_grants(store_id,member_id,status,expires_at);
CREATE INDEX member_platform_reward_due ON member_platform_reward_grants(status,eligible_at);
CREATE TABLE member_platform_reward_allocations (
  order_id TEXT NOT NULL REFERENCES member_platform_order_promotions(order_id),
  grant_id TEXT NOT NULL REFERENCES member_platform_reward_grants(id),
  amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
  restored_cents INTEGER NOT NULL DEFAULT 0 CHECK(restored_cents>=0 AND restored_cents<=amount_cents),
  status TEXT NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','captured','released','restored')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(order_id,grant_id)
);
CREATE TABLE member_platform_reward_ledger (
  id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES member_platform_reward_grants(id),
  order_id TEXT REFERENCES orders(id),
  kind TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  remaining_after INTEGER NOT NULL,
  reserved_after INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX member_platform_ledger_grant ON member_platform_reward_ledger(grant_id,created_at);
CREATE TRIGGER member_platform_ledger_immutable_update BEFORE UPDATE ON member_platform_reward_ledger BEGIN SELECT RAISE(ABORT,'member ledger is append only'); END;
CREATE TRIGGER member_platform_ledger_immutable_delete BEFORE DELETE ON member_platform_reward_ledger BEGIN SELECT RAISE(ABORT,'member ledger is append only'); END;
CREATE TABLE member_platform_target_uses (
  order_id TEXT PRIMARY KEY REFERENCES member_platform_order_promotions(order_id),
  target_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX member_platform_targets_key ON member_platform_target_uses(target_key);
CREATE TABLE member_platform_target_claims (
  target_key TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES member_platform_order_promotions(order_id)
);
CREATE TABLE member_platform_reward_actions (
  id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES member_platform_reward_grants(id),
  expected_version INTEGER NOT NULL,
  note TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TRIGGER member_platform_reward_action_guard BEFORE INSERT ON member_platform_reward_actions BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM member_platform_reward_grants WHERE id=NEW.grant_id AND version=NEW.expected_version AND status NOT IN ('cancelled','frozen'))
    THEN RAISE(ABORT,'member reward version conflict') END;
END;
CREATE TRIGGER member_platform_reward_action_apply AFTER INSERT ON member_platform_reward_actions BEGIN
  INSERT INTO member_platform_reward_ledger
    SELECT NEW.id,id,source_order_id,CASE WHEN remaining_cents=amount_cents AND reserved_cents=0 THEN 'cancelled' ELSE 'frozen' END,
      CASE WHEN remaining_cents=amount_cents AND reserved_cents=0 THEN -remaining_cents ELSE 0 END,
      CASE WHEN remaining_cents=amount_cents AND reserved_cents=0 THEN 0 ELSE remaining_cents END,reserved_cents,NEW.created_at
    FROM member_platform_reward_grants WHERE id=NEW.grant_id;
  UPDATE member_platform_reward_grants SET
    status=CASE WHEN remaining_cents=amount_cents AND reserved_cents=0 THEN 'cancelled' ELSE 'frozen' END,
    remaining_cents=CASE WHEN remaining_cents=amount_cents AND reserved_cents=0 THEN 0 ELSE remaining_cents END,
    version=version+1 WHERE id=NEW.grant_id;
  UPDATE member_platform_profiles SET frozen=1,version=version+1 WHERE id IN (SELECT member_id FROM member_platform_reward_grants WHERE id=NEW.grant_id AND status='frozen');
  INSERT INTO admin_audit VALUES (NEW.id,'member-reward-revoke',NEW.grant_id,NEW.note,NEW.created_at);
END;
CREATE TABLE member_platform_review_actions (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES member_platform_order_promotions(order_id),
  expected_updated_at INTEGER NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('approved','rejected')),
  note TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TRIGGER member_platform_review_guard BEFORE INSERT ON member_platform_review_actions BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM member_platform_order_promotions p JOIN orders o ON o.id=p.order_id
    WHERE p.order_id=NEW.order_id AND p.review_status='required' AND p.updated_at=NEW.expected_updated_at
      AND o.status IN ('pending','session','failed') AND p.allocation_status IN ('reserved','captured'))
    THEN RAISE(ABORT,'member review conflict') END;
END;
CREATE TRIGGER member_platform_review_apply AFTER INSERT ON member_platform_review_actions BEGIN
  UPDATE member_platform_order_promotions SET review_status=NEW.decision,review_note=NEW.note,updated_at=NEW.created_at WHERE order_id=NEW.order_id;
  INSERT INTO admin_audit(id,action,target_id,note,created_at) VALUES (NEW.id,'member-order-review',NEW.order_id,NEW.note,NEW.created_at);
END;

-- Assertions make stale prices, identity claims and insufficient credit fail the
-- whole D1 batch. An UPDATE affecting zero rows by itself does not roll back D1.
CREATE TRIGGER member_platform_promotion_guard BEFORE INSERT ON member_platform_order_promotions BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM orders o WHERE o.id=NEW.order_id AND o.partner_id IS NULL
      AND o.owner_store_id=NEW.store_id AND o.plan IN ('plus','pro-5x','pro-20x','pro-25x')
      AND o.mode='live' AND o.is_test=0 AND o.member_promotion=1
      AND o.price_cents=CASE WHEN NEW.cash_cents=0 THEN NEW.original_cents ELSE NEW.cash_cents END
  ) THEN RAISE(ABORT,'member promotion mismatch') END;
  SELECT CASE WHEN NEW.referrer_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM member_platform_profiles p JOIN member_platform_user u ON u.id=p.id
    WHERE p.id=NEW.referrer_id AND p.invite_code=NEW.invite_code AND p.store_id=NEW.store_id AND p.frozen=0 AND u.emailVerified=1
  ) THEN RAISE(ABORT,'member invitation unavailable') END;
  SELECT CASE WHEN NEW.newcomer_cents>0 AND (NEW.referrer_id IS NULL OR EXISTS(
    SELECT 1 FROM orders old JOIN orders current ON current.id=NEW.order_id
    WHERE old.id<>current.id AND old.owner_store_id=NEW.store_id AND old.partner_id IS NULL AND old.mode='live' AND old.is_test=0
      AND lower(old.customer_email)=lower(current.customer_email) AND old.payment_status='paid' AND old.refunded_cents<old.price_cents
  )) THEN RAISE(ABORT,'member first purchase unavailable') END;
END;
CREATE TRIGGER member_platform_grant_ledger AFTER INSERT ON member_platform_reward_grants BEGIN
  INSERT INTO member_platform_reward_ledger VALUES ('grant:'||NEW.id,NEW.id,NEW.source_order_id,'grant',NEW.amount_cents,NEW.remaining_cents,NEW.reserved_cents,NEW.created_at);
END;
CREATE TRIGGER member_platform_grant_guard BEFORE INSERT ON member_platform_reward_grants BEGIN
  SELECT CASE WHEN NEW.status<>'pending' OR NEW.eligible_at<>NEW.delivered_at+86400000 OR NOT EXISTS(
    SELECT 1 FROM member_platform_order_promotions p JOIN orders o ON o.id=p.order_id JOIN member_platform_first_purchases c ON c.order_id=o.id
      JOIN member_platform_profiles m ON m.id=p.referrer_id
    WHERE p.order_id=NEW.source_order_id AND p.referrer_id=NEW.member_id AND p.store_id=NEW.store_id AND p.cash_cents>0
      AND p.review_status IN ('none','approved') AND p.allocation_status NOT IN ('released','restored') AND m.frozen=0
      AND o.mode='live' AND o.is_test=0 AND o.status='success' AND o.payment_status='paid' AND o.refund_hold=0 AND o.refunded_cents=0
  ) THEN RAISE(ABORT,'member reward source mismatch') END;
END;
CREATE TRIGGER member_platform_allocation_guard BEFORE INSERT ON member_platform_reward_allocations BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM member_platform_reward_grants g JOIN member_platform_order_promotions p ON p.order_id=NEW.order_id
      JOIN member_platform_profiles m ON m.id=p.member_id
    WHERE g.id=NEW.grant_id AND g.store_id=p.store_id AND g.member_id=p.member_id AND m.frozen=0
      AND g.status='active' AND g.expires_at>NEW.created_at AND g.remaining_cents-g.reserved_cents>=NEW.amount_cents
      AND p.allocation_status='reserved'
  ) THEN RAISE(ABORT,'member credit unavailable') END;
END;
CREATE TRIGGER member_platform_allocation_reserve AFTER INSERT ON member_platform_reward_allocations BEGIN
  UPDATE member_platform_reward_grants SET reserved_cents=reserved_cents+NEW.amount_cents,version=version+1 WHERE id=NEW.grant_id;
  INSERT INTO member_platform_reward_ledger SELECT 'reserve:'||NEW.order_id||':'||id,id,NEW.order_id,'reserve',NEW.amount_cents,remaining_cents,reserved_cents,NEW.created_at FROM member_platform_reward_grants WHERE id=NEW.grant_id;
END;
CREATE TRIGGER member_platform_allocation_transition BEFORE UPDATE OF status ON member_platform_reward_allocations WHEN OLD.status<>NEW.status BEGIN
  SELECT CASE WHEN NOT ((OLD.status='reserved' AND NEW.status IN ('captured','released')) OR (OLD.status='captured' AND NEW.status='restored'))
    THEN RAISE(ABORT,'member allocation transition') END;
  SELECT CASE WHEN NEW.status='captured' AND NOT EXISTS(
    SELECT 1 FROM member_platform_order_promotions p JOIN orders o ON o.id=p.order_id JOIN member_platform_reward_grants g ON g.id=NEW.grant_id
    JOIN member_platform_profiles m ON m.id=p.member_id
    WHERE p.order_id=NEW.order_id AND p.review_status IN ('none','approved') AND p.procurement_status='ready'
      AND o.payment_status='paid' AND o.refund_hold=0 AND o.refunded_cents=0 AND g.status NOT IN ('cancelled','frozen') AND m.frozen=0
  ) THEN RAISE(ABORT,'member capture blocked') END;
END;
CREATE TRIGGER member_platform_allocation_move AFTER UPDATE OF status ON member_platform_reward_allocations WHEN OLD.status<>NEW.status BEGIN
  UPDATE member_platform_reward_grants SET
    remaining_cents=remaining_cents+CASE WHEN NEW.status='captured' THEN -NEW.amount_cents ELSE 0 END,
    reserved_cents=reserved_cents+CASE WHEN OLD.status='reserved' THEN -NEW.amount_cents ELSE 0 END,
    version=version+1 WHERE id=NEW.grant_id;
  INSERT INTO member_platform_reward_ledger SELECT NEW.status||':'||NEW.order_id||':'||id,id,NEW.order_id,NEW.status,NEW.amount_cents,remaining_cents,reserved_cents,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM member_platform_reward_grants WHERE id=NEW.grant_id AND NEW.status<>'restored';
END;
CREATE TRIGGER member_platform_restore_guard BEFORE UPDATE OF restored_cents ON member_platform_reward_allocations WHEN OLD.restored_cents<>NEW.restored_cents BEGIN
  SELECT CASE WHEN OLD.status<>'captured' OR NEW.restored_cents<OLD.restored_cents THEN RAISE(ABORT,'member restoration mismatch') END;
END;
CREATE TRIGGER member_platform_restore_apply AFTER UPDATE OF restored_cents ON member_platform_reward_allocations WHEN OLD.restored_cents<NEW.restored_cents BEGIN
  UPDATE member_platform_reward_grants SET remaining_cents=remaining_cents+NEW.restored_cents-OLD.restored_cents,version=version+1 WHERE id=NEW.grant_id;
  INSERT INTO member_platform_reward_ledger SELECT 'restored:'||NEW.order_id||':'||id||':'||NEW.restored_cents,id,NEW.order_id,'restored',NEW.restored_cents-OLD.restored_cents,remaining_cents,reserved_cents,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM member_platform_reward_grants WHERE id=NEW.grant_id;
END;
-- A malformed/partial allocation cannot be committed even if every individual
-- allocation is valid. Insert this guard as the final statement in order creation.
CREATE TABLE member_platform_order_assertions (order_id TEXT PRIMARY KEY REFERENCES member_platform_order_promotions(order_id));
CREATE TRIGGER member_platform_order_assertion BEFORE INSERT ON member_platform_order_assertions BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM member_platform_order_promotions p WHERE p.order_id=NEW.order_id
    AND p.reward_cents=COALESCE((SELECT SUM(a.amount_cents) FROM member_platform_reward_allocations a WHERE a.order_id=p.order_id),0))
    THEN RAISE(ABORT,'member credit allocation mismatch') END;
END;

CREATE TABLE member_platform_order_reconciliations (
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
CREATE INDEX member_platform_reconciliation_due ON member_platform_order_reconciliations(checked_at);
CREATE INDEX member_platform_reconciliation_state ON member_platform_order_reconciliations(state,checked_at);
CREATE TABLE member_platform_operation_events (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  target_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  note TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(details)),
  created_at INTEGER NOT NULL
);
CREATE INDEX member_platform_operation_history ON member_platform_operation_events(category,target_id,created_at);
CREATE TRIGGER member_platform_operation_no_update BEFORE UPDATE ON member_platform_operation_events BEGIN SELECT RAISE(ABORT,'Operation history is append-only'); END;
CREATE TRIGGER member_platform_operation_no_delete BEFORE DELETE ON member_platform_operation_events BEGIN SELECT RAISE(ABORT,'Operation history is append-only'); END;

CREATE TABLE member_platform_notification_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  enabled_since INTEGER NOT NULL
);
INSERT INTO member_platform_notification_settings VALUES (1,CAST(strftime('%s','now') AS INTEGER)*1000);
CREATE TABLE member_platform_notifications (
  id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  member_id TEXT REFERENCES member_platform_profiles(id),
  mail_body TEXT NOT NULL CHECK(json_valid(mail_body)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','retry','sent','failed','unknown','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  first_attempt_at INTEGER,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  provider_id TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX member_platform_notification_due ON member_platform_notifications(status,next_attempt_at,lease_until);
CREATE INDEX member_platform_notification_feed ON member_platform_notifications(member_id,created_at);
CREATE TRIGGER member_platform_notification_payload_immutable BEFORE UPDATE ON member_platform_notifications
WHEN NEW.id<>OLD.id OR NEW.event_key<>OLD.event_key OR NEW.kind<>OLD.kind OR NEW.target_id<>OLD.target_id OR NEW.member_id IS NOT OLD.member_id OR NEW.mail_body<>OLD.mail_body OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'Notification payload is immutable'); END;

-- A separate stable append sequence preserves every original ledger row and
-- avoids sorting same-millisecond or backdated events by random text IDs.
CREATE TABLE member_platform_ledger_sequence (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_id TEXT NOT NULL UNIQUE REFERENCES member_platform_reward_ledger(id)
);
CREATE TRIGGER member_platform_ledger_sequence_insert AFTER INSERT ON member_platform_reward_ledger BEGIN
  INSERT INTO member_platform_ledger_sequence(ledger_id) VALUES (NEW.id);
END;
CREATE TRIGGER member_platform_ledger_sequence_no_update BEFORE UPDATE ON member_platform_ledger_sequence BEGIN SELECT RAISE(ABORT,'Ledger sequence is append-only'); END;
CREATE TRIGGER member_platform_ledger_sequence_no_delete BEFORE DELETE ON member_platform_ledger_sequence BEGIN SELECT RAISE(ABORT,'Ledger sequence is append-only'); END;
CREATE TABLE member_platform_reward_audits (
  grant_id TEXT PRIMARY KEY REFERENCES member_platform_reward_grants(id),
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
CREATE INDEX member_platform_reward_audit_due ON member_platform_reward_audits(checked_at);

CREATE TABLE member_platform_order_signals (
  order_id TEXT PRIMARY KEY REFERENCES orders(id),
  customer_key TEXT NOT NULL,
  member_id TEXT REFERENCES member_platform_user(id),
  ip_key TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX member_platform_signal_customer ON member_platform_order_signals(customer_key,created_at);
CREATE INDEX member_platform_signal_member ON member_platform_order_signals(member_id,created_at);
CREATE INDEX member_platform_signal_ip ON member_platform_order_signals(ip_key,created_at);
CREATE TABLE member_platform_risk_subjects (
  kind TEXT NOT NULL CHECK(kind IN ('member','customer','browser')),
  subject_key TEXT NOT NULL,
  latest_order_id TEXT NOT NULL REFERENCES orders(id),
  last_order_at INTEGER NOT NULL,
  checked_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(kind,subject_key)
);
CREATE TABLE member_platform_risk_cases (
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
CREATE INDEX member_platform_risk_case_status ON member_platform_risk_cases(status,updated_at);

-- Public aliases never replace the stable invitation IDs frozen on orders.
CREATE TABLE member_platform_invite_aliases (
  alias TEXT PRIMARY KEY COLLATE NOCASE,
  member_id TEXT NOT NULL REFERENCES member_platform_profiles(id),
  kind TEXT NOT NULL CHECK(kind IN ('default','custom')),
  created_at INTEGER NOT NULL,
  UNIQUE(member_id,kind),
  CHECK(length(alias) BETWEEN 3 AND 20 AND alias=lower(alias)
    AND alias NOT GLOB '*[^a-z0-9-]*' AND substr(alias,1,1)<>'-' AND substr(alias,-1,1)<>'-')
);
CREATE TRIGGER member_platform_alias_no_update BEFORE UPDATE ON member_platform_invite_aliases BEGIN SELECT RAISE(ABORT,'Invitation aliases are permanent'); END;
CREATE TRIGGER member_platform_alias_no_delete BEFORE DELETE ON member_platform_invite_aliases BEGIN SELECT RAISE(ABORT,'Invitation aliases are permanent'); END;
CREATE TRIGGER member_platform_alias_custom_audit AFTER INSERT ON member_platform_invite_aliases WHEN NEW.kind='custom'
BEGIN
  INSERT INTO member_platform_operation_events(id,category,target_id,action,actor,note,details,created_at)
  VALUES ('invite-alias:'||NEW.member_id,'invitation',NEW.member_id,'customize',NEW.member_id,
    '会员确认一次性自定义邀请地址',json_object('alias',NEW.alias),NEW.created_at);
END;



-- Customer records read both stores, with the order's own immutable shop.
CREATE VIEW member_all_order_promotions AS
SELECT * FROM member_order_promotions
UNION ALL
SELECT * FROM member_platform_order_promotions;

DROP VIEW owner_customer_orders;

CREATE VIEW owner_customer_orders AS
SELECT m.customer_id,o.id,o.owner_store_id store_id,json_extract(s.settings,'$.name') store_name,
  o.plan_name,o.created_at,o.status,o.payment_status,
  COALESCE(p.cash_cents,o.price_cents) total_cents,
  CASE WHEN o.payment_status='paid' THEN COALESCE(p.cash_cents,o.price_cents) ELSE 0 END paid_cents,
  MIN(CASE WHEN o.payment_status='paid' THEN COALESCE(p.cash_cents,o.price_cents) ELSE 0 END,
      MAX(o.refunded_cents,COALESCE(r.refunded_cents,0))) refunded_cents
FROM orders o JOIN owner_order_customers m ON m.email=lower(trim(o.customer_email))
JOIN owner_shop_settings s ON s.id=o.owner_store_id
LEFT JOIN member_all_order_promotions p ON p.order_id=o.id AND p.store_id=o.owner_store_id
LEFT JOIN recharge_orders r ON r.order_id=o.id
WHERE o.partner_id IS NULL AND o.mode='live' AND o.is_test=0;
