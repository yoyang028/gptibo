-- Wholesale is enabled only on its own deployment and database.
CREATE TABLE wholesale_wallets (
  partner_id TEXT PRIMARY KEY REFERENCES partners(id),
  balance_cents INTEGER NOT NULL DEFAULT 0 CHECK(typeof(balance_cents)='integer' AND balance_cents BETWEEN 0 AND 1000000000)
);
CREATE TABLE wholesale_products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '数字商品',
  price_cents INTEGER NOT NULL CHECK(typeof(price_cents)='integer' AND price_cents BETWEEN 1 AND 10000000),
  fulfillment TEXT NOT NULL CHECK(fulfillment IN ('stock','manual')),
  active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE TABLE wholesale_orders (
  id TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL REFERENCES partners(id),
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES wholesale_products(id),
  product_name TEXT NOT NULL,
  product_version INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK(typeof(quantity)='integer' AND quantity BETWEEN 1 AND 100),
  amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer' AND amount_cents BETWEEN 1 AND 100000000 AND amount_cents=unit_price_cents*quantity),
  fulfillment TEXT NOT NULL CHECK(fulfillment IN ('stock','manual')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','fulfilled','refunded')),
  buyer_note TEXT NOT NULL DEFAULT '',
  delivery_cipher TEXT,
  handling_note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(partner_id,request_key)
);
CREATE INDEX wholesale_orders_partner ON wholesale_orders(partner_id,created_at DESC,id);
CREATE TABLE wholesale_stock (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES wholesale_products(id),
  content_cipher TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  order_id TEXT REFERENCES wholesale_orders(id),
  created_at INTEGER NOT NULL,
  UNIQUE(content_hash)
);
CREATE INDEX wholesale_stock_available ON wholesale_stock(product_id,order_id,created_at,id);
CREATE TABLE wholesale_topups (
  id TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL REFERENCES partners(id),
  request_key TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer' AND amount_cents BETWEEN 1 AND 10000000),
  payment_reference TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  receipt TEXT NOT NULL DEFAULT '',
  handling_note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  handled_at INTEGER,
  UNIQUE(partner_id,request_key)
);
CREATE UNIQUE INDEX wholesale_topup_receipt ON wholesale_topups(lower(receipt)) WHERE status='approved';
CREATE INDEX wholesale_topups_partner ON wholesale_topups(partner_id,created_at DESC,id);
CREATE TABLE wholesale_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_id TEXT NOT NULL REFERENCES partners(id),
  kind TEXT NOT NULL CHECK(kind IN ('topup','purchase','refund')),
  reference_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer' AND amount_cents<>0),
  balance_cents INTEGER NOT NULL CHECK(balance_cents>=0),
  created_at INTEGER NOT NULL,
  UNIQUE(kind,reference_id)
);
CREATE INDEX wholesale_ledger_partner ON wholesale_ledger(partner_id,id DESC);
CREATE TABLE wholesale_api_keys (
  id TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL REFERENCES partners(id),
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  auth_version INTEGER NOT NULL,
  credential_version TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX wholesale_keys_owner ON wholesale_api_keys(partner_id,created_at DESC);

-- One SQL insert reserves stock, debits the wallet, and records the ledger.
-- ABORT rolls all of them back on any failed condition, including concurrency.
CREATE TRIGGER wholesale_purchase AFTER INSERT ON wholesale_orders BEGIN
  SELECT CASE WHEN NEW.status<>'pending' OR NOT EXISTS(SELECT 1 FROM partners WHERE id=NEW.partner_id AND active=1) THEN RAISE(ABORT,'wholesale_account_unavailable') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM wholesale_products WHERE id=NEW.product_id AND active=1 AND version=NEW.product_version AND price_cents=NEW.unit_price_cents AND fulfillment=NEW.fulfillment) THEN RAISE(ABORT,'wholesale_product_changed') END;
  INSERT INTO wholesale_wallets(partner_id) VALUES(NEW.partner_id) ON CONFLICT DO NOTHING;
  UPDATE wholesale_wallets SET balance_cents=balance_cents-NEW.amount_cents WHERE partner_id=NEW.partner_id AND balance_cents>=NEW.amount_cents;
  SELECT CASE WHEN changes()<>1 THEN RAISE(ABORT,'wholesale_insufficient_balance') END;
  UPDATE wholesale_stock SET order_id=NEW.id WHERE NEW.fulfillment='stock' AND id IN (SELECT id FROM wholesale_stock WHERE product_id=NEW.product_id AND order_id IS NULL ORDER BY created_at,id LIMIT NEW.quantity);
  SELECT CASE WHEN NEW.fulfillment='stock' AND (SELECT COUNT(*) FROM wholesale_stock WHERE order_id=NEW.id)<>NEW.quantity THEN RAISE(ABORT,'wholesale_insufficient_stock') END;
  INSERT INTO wholesale_ledger(partner_id,kind,reference_id,amount_cents,balance_cents,created_at) SELECT NEW.partner_id,'purchase',NEW.id,-NEW.amount_cents,balance_cents,NEW.created_at FROM wholesale_wallets WHERE partner_id=NEW.partner_id;
  UPDATE wholesale_orders SET status='fulfilled' WHERE id=NEW.id AND fulfillment='stock';
END;
CREATE TRIGGER wholesale_order_immutable BEFORE UPDATE ON wholesale_orders WHEN
  NEW.partner_id<>OLD.partner_id OR NEW.request_key<>OLD.request_key OR NEW.request_hash<>OLD.request_hash OR NEW.product_id<>OLD.product_id OR NEW.product_name<>OLD.product_name OR NEW.product_version<>OLD.product_version OR NEW.unit_price_cents<>OLD.unit_price_cents OR NEW.quantity<>OLD.quantity OR NEW.amount_cents<>OLD.amount_cents OR NEW.fulfillment<>OLD.fulfillment OR NEW.buyer_note<>OLD.buyer_note OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'wholesale_order_immutable'); END;
CREATE TRIGGER wholesale_order_transition BEFORE UPDATE OF status ON wholesale_orders WHEN NEW.status<>OLD.status AND NOT ((OLD.status='pending' AND NEW.status IN ('fulfilled','refunded')) OR (OLD.status='fulfilled' AND NEW.status='refunded'))
BEGIN SELECT RAISE(ABORT,'wholesale_invalid_transition'); END;
CREATE TRIGGER wholesale_refund AFTER UPDATE OF status ON wholesale_orders WHEN NEW.status='refunded' AND OLD.status<>'refunded' BEGIN
  UPDATE wholesale_wallets SET balance_cents=balance_cents+NEW.amount_cents WHERE partner_id=NEW.partner_id;
  INSERT INTO wholesale_ledger(partner_id,kind,reference_id,amount_cents,balance_cents,created_at) SELECT NEW.partner_id,'refund',NEW.id,NEW.amount_cents,balance_cents,NEW.updated_at FROM wholesale_wallets WHERE partner_id=NEW.partner_id;
  INSERT INTO admin_audit(id,target_id,action,note,created_at) VALUES('wholesale-refund:'||NEW.id,NEW.id,'wholesale-refund',NEW.handling_note,NEW.updated_at);
  -- Delivered stock stays assigned forever; refunded credentials are never resold.
END;
CREATE TRIGGER wholesale_topup_immutable BEFORE UPDATE ON wholesale_topups WHEN OLD.status<>'pending' OR NEW.partner_id<>OLD.partner_id OR NEW.amount_cents<>OLD.amount_cents OR NEW.request_key<>OLD.request_key OR NEW.payment_reference<>OLD.payment_reference OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'wholesale_topup_already_handled'); END;
CREATE TRIGGER wholesale_credit AFTER UPDATE OF status ON wholesale_topups WHEN NEW.status='approved' BEGIN
  SELECT CASE WHEN length(trim(NEW.receipt))<6 THEN RAISE(ABORT,'wholesale_receipt_required') END;
  INSERT INTO wholesale_wallets(partner_id) VALUES(NEW.partner_id) ON CONFLICT DO NOTHING;
  UPDATE wholesale_wallets SET balance_cents=balance_cents+NEW.amount_cents WHERE partner_id=NEW.partner_id;
  INSERT INTO wholesale_ledger(partner_id,kind,reference_id,amount_cents,balance_cents,created_at) SELECT NEW.partner_id,'topup',NEW.id,NEW.amount_cents,balance_cents,NEW.handled_at FROM wholesale_wallets WHERE partner_id=NEW.partner_id;
END;
CREATE TRIGGER wholesale_topup_audit AFTER UPDATE OF status ON wholesale_topups WHEN NEW.status<>'pending' BEGIN
  INSERT INTO admin_audit(id,target_id,action,note,created_at) VALUES('wholesale-topup:'||NEW.id,NEW.id,'wholesale-topup-'||NEW.status,NEW.handling_note,NEW.handled_at);
END;
CREATE TRIGGER wholesale_ledger_no_update BEFORE UPDATE ON wholesale_ledger BEGIN SELECT RAISE(ABORT,'wholesale_ledger_immutable'); END;
CREATE TRIGGER wholesale_ledger_no_delete BEFORE DELETE ON wholesale_ledger BEGIN SELECT RAISE(ABORT,'wholesale_ledger_immutable'); END;
