ALTER TABLE shop_coupon_uses ADD COLUMN code_snapshot TEXT;

-- Only recover historical codes whose coupon version still matches the order.
UPDATE shop_coupon_uses AS u
SET code_snapshot = (
  SELECT c.code FROM shop_coupons c WHERE c.id=u.coupon_id AND c.version=u.coupon_version
)
WHERE EXISTS(SELECT 1 FROM shop_coupons c WHERE c.id=u.coupon_id AND c.version=u.coupon_version);

CREATE TRIGGER shop_coupon_code_snapshot AFTER INSERT ON shop_coupon_uses BEGIN
  UPDATE shop_coupon_uses SET code_snapshot = (
    SELECT code FROM shop_coupons WHERE id=NEW.coupon_id AND version=NEW.coupon_version
  ) WHERE order_id=NEW.order_id;
END;
