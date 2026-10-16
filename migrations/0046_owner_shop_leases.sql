-- Each lease has its own identity, including requests in the same millisecond.
ALTER TABLE shop_order_details ADD COLUMN lease_token TEXT NOT NULL DEFAULT '';
ALTER TABLE owner_order_notifications ADD COLUMN lease_token TEXT NOT NULL DEFAULT '';
