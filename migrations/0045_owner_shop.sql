-- The owner's root storefront is independent of reseller accounts and prices.
CREATE TABLE owner_shop_settings (
  id TEXT PRIMARY KEY CHECK(id='platform'),
  settings TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 0,
  change_id TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT 0
);
INSERT INTO owner_shop_settings(id) VALUES ('platform');

CREATE TABLE shop_products (
  id TEXT PRIMARY KEY REFERENCES catalog_plans(id),
  public_json TEXT NOT NULL,
  api_secret TEXT NOT NULL DEFAULT '',
  api_verified_fingerprint TEXT NOT NULL DEFAULT '',
  stock_remaining INTEGER NOT NULL DEFAULT -1 CHECK(stock_remaining>=-1),
  version INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  change_id TEXT NOT NULL
);
CREATE TABLE shop_order_details (
  order_id TEXT PRIMARY KEY REFERENCES orders(id),
  product_id TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  fields TEXT NOT NULL,
  payment_claimed INTEGER NOT NULL DEFAULT 0 CHECK(payment_claimed IN (0,1)),
  payment_reference TEXT NOT NULL DEFAULT '',
  delivery_content TEXT NOT NULL DEFAULT '',
  supplier_id TEXT,
  supplier_state TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  last_checked_at INTEGER NOT NULL DEFAULT 0,
  api_secret TEXT NOT NULL DEFAULT ''
);
CREATE TABLE shop_coupons (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  settings TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  change_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE shop_coupon_uses (
  order_id TEXT PRIMARY KEY REFERENCES orders(id),
  coupon_id TEXT NOT NULL REFERENCES shop_coupons(id),
  email TEXT NOT NULL,
  coupon_version INTEGER NOT NULL,
  discount_cents INTEGER NOT NULL CHECK(discount_cents>0)
);
CREATE TABLE owner_order_notifications (
  order_id TEXT PRIMARY KEY REFERENCES orders(id),
  sent_at INTEGER,
  lease_until INTEGER NOT NULL DEFAULT 0
);
CREATE TRIGGER shop_coupon_reservation BEFORE INSERT ON shop_coupon_uses BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM shop_coupons c JOIN orders o ON o.id=NEW.order_id
    WHERE c.id=NEW.coupon_id AND c.version=NEW.coupon_version AND json_extract(c.settings,'$.active')=1
      AND o.partner_id IS NULL AND o.customer_email=NEW.email
      AND json_extract(c.settings,'$.discount_cents')=NEW.discount_cents
      AND julianday(json_extract(c.settings,'$.starts_at'))<=julianday(o.created_at/1000,'unixepoch')
      AND julianday(json_extract(c.settings,'$.ends_at'))>julianday(o.created_at/1000,'unixepoch')
      AND EXISTS(SELECT 1 FROM json_each(c.settings,'$.targets') t WHERE json_extract(t.value,'$.storeId')='platform' AND json_extract(t.value,'$.plan')=o.plan)
      AND (SELECT COUNT(*) FROM shop_coupon_uses u JOIN orders used ON used.id=u.order_id WHERE u.coupon_id=c.id AND used.status<>'cancelled')<json_extract(c.settings,'$.max_uses')
      AND (json_extract(c.settings,'$.once_per_email')=0 OR NOT EXISTS(SELECT 1 FROM shop_coupon_uses u JOIN orders used ON used.id=u.order_id WHERE u.coupon_id=c.id AND u.email=NEW.email AND used.status<>'cancelled'))
  ) THEN RAISE(ABORT,'coupon unavailable') END;
END;
