-- Preserve the original root shop and all historical order ownership.
ALTER TABLE owner_shop_settings RENAME TO owner_shop_settings_legacy;
CREATE TABLE owner_shop_settings (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  slot INTEGER NOT NULL UNIQUE CHECK(slot BETWEEN 1 AND 3),
  settings TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(settings)),
  version INTEGER NOT NULL DEFAULT 0,
  change_id TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT 0
);
INSERT INTO owner_shop_settings SELECT id,'',1,settings,version,change_id,updated_at FROM owner_shop_settings_legacy;
DROP TABLE owner_shop_settings_legacy;
INSERT INTO owner_shop_settings(id,slug,slot,settings)
  SELECT 'store-2','store-2',2,json_set(settings,'$.name','商店二','$.brandName','商店二','$.pageTitle','商店二','$.logo','','$.headline','商店。找到适合你的服务。','$.orderCompletedEmail',json('false')) FROM owner_shop_settings WHERE id='platform';
INSERT INTO owner_shop_settings(id,slug,slot,settings)
  SELECT 'store-3','store-3',3,json_set(settings,'$.name','通用商店','$.brandName','通用商店','$.pageTitle','通用商店','$.logo','','$.headline','商店。找到适合你的服务。','$.orderCompletedEmail',json('false')) FROM owner_shop_settings WHERE id='platform';

CREATE TABLE owner_store_prices (
  store_id TEXT NOT NULL REFERENCES owner_shop_settings(id),
  plan TEXT NOT NULL REFERENCES catalog_plans(id) ON DELETE CASCADE,
  price_cents INTEGER NOT NULL CHECK(price_cents BETWEEN 1 AND 10000000),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  change_id TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(store_id,plan)
);
INSERT INTO owner_store_prices(store_id,plan,price_cents,enabled)
  SELECT s.id,c.id,c.price_cents,c.enabled FROM owner_shop_settings s CROSS JOIN catalog_plans c WHERE s.id<>'platform';
ALTER TABLE orders ADD COLUMN owner_store_id TEXT NOT NULL DEFAULT 'platform';
CREATE INDEX orders_owner_store ON orders(owner_store_id,created_at) WHERE partner_id IS NULL;

-- All-or-nothing bulk edits: a stale target rolls back the entire batch.
CREATE TABLE owner_store_edits (
  id TEXT PRIMARY KEY,
  expected TEXT NOT NULL CHECK(json_valid(expected)),
  created_at INTEGER NOT NULL
);
CREATE TRIGGER owner_store_edit_versions BEFORE INSERT ON owner_store_edits BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.expected) e
    WHERE NOT EXISTS(SELECT 1 FROM owner_shop_settings s WHERE s.id=json_extract(e.value,'$.id') AND s.version=json_extract(e.value,'$.version'))
  ) OR EXISTS (
    SELECT 1 FROM json_each(NEW.expected) e,json_each(e.value,'$.prices') p
    WHERE NOT EXISTS(SELECT 1 FROM catalog_plans c LEFT JOIN owner_store_prices sp ON sp.plan=c.id AND sp.store_id=json_extract(e.value,'$.id')
      WHERE c.id=json_extract(p.value,'$.plan') AND c.version=json_extract(p.value,'$.catalogVersion')
        AND CASE WHEN json_extract(e.value,'$.id')='platform' THEN c.version ELSE COALESCE(sp.version,0) END=json_extract(p.value,'$.version'))
  ) THEN RAISE(ABORT,'store version conflict') END;
END;

DROP TRIGGER shop_coupon_reservation;
CREATE TRIGGER shop_coupon_reservation BEFORE INSERT ON shop_coupon_uses BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM shop_coupons c JOIN orders o ON o.id=NEW.order_id
    WHERE c.id=NEW.coupon_id AND c.version=NEW.coupon_version AND json_extract(c.settings,'$.active')=1
      AND o.partner_id IS NULL AND o.customer_email=NEW.email
      AND json_extract(c.settings,'$.discount_cents')=NEW.discount_cents
      AND julianday(json_extract(c.settings,'$.starts_at'))<=julianday(o.created_at/1000,'unixepoch')
      AND julianday(json_extract(c.settings,'$.ends_at'))>julianday(o.created_at/1000,'unixepoch')
      AND EXISTS(SELECT 1 FROM json_each(c.settings,'$.targets') t WHERE json_extract(t.value,'$.storeId')=o.owner_store_id AND json_extract(t.value,'$.plan')=o.plan)
      AND (SELECT COUNT(*) FROM shop_coupon_uses u JOIN orders used ON used.id=u.order_id WHERE u.coupon_id=c.id AND used.status<>'cancelled')<json_extract(c.settings,'$.max_uses')
      AND (json_extract(c.settings,'$.once_per_email')=0 OR NOT EXISTS(SELECT 1 FROM shop_coupon_uses u JOIN orders used ON used.id=u.order_id WHERE u.coupon_id=c.id AND u.email=NEW.email AND used.status<>'cancelled'))
  ) THEN RAISE(ABORT,'coupon unavailable') END;
END;
