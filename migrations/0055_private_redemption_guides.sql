-- Redemption instructions are private delivery data, separate from catalog JSON.
CREATE TABLE shop_redemption_guides (
  product_id TEXT PRIMARY KEY REFERENCES catalog_plans(id),
  encrypted_content TEXT NOT NULL,
  product_version INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Preserve the guide associated with the purchased specification, even if the
-- owner changes the product's instructions after an order is created.
ALTER TABLE shop_order_details ADD COLUMN redemption_guide TEXT NOT NULL DEFAULT '';
