-- Same-family reference only: no shared price, supplier or order identity is
-- inferred from a similar name or duration.
ALTER TABLE hanfolk_product_links ADD COLUMN related_plan_id TEXT REFERENCES catalog_plans(id);
ALTER TABLE hanfolk_product_links ADD COLUMN match_note TEXT NOT NULL DEFAULT '';
