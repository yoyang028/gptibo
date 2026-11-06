-- Agent storefronts share the main platform's catalog, orders and account identity.
CREATE TABLE partner_store_settings (
  partner_id TEXT PRIMARY KEY REFERENCES partners(id),
  settings TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(settings)),
  version INTEGER NOT NULL DEFAULT 0,
  change_id TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
ALTER TABLE partner_prices ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1));

CREATE TABLE partner_payout_accounts (
  partner_id TEXT PRIMARY KEY REFERENCES partners(id),
  phone TEXT NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  change_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
