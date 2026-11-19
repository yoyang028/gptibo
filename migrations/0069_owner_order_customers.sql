-- Link order contacts to CRM without changing manually entered contact details.
CREATE TABLE owner_order_customers (
  email TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES crm_customers(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX owner_order_customers_customer ON owner_order_customers(customer_id,email);
CREATE INDEX crm_customers_direct_email ON crm_customers(lower(trim(email))) WHERE partner_id IS NULL AND email<>'';
CREATE INDEX orders_customer_contact ON orders(lower(trim(customer_email)),owner_store_id,created_at)
  WHERE partner_id IS NULL AND mode='live' AND is_test=0;

INSERT INTO crm_customers(id,partner_id,name,email,source,created_at,updated_at)
SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-a'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
  NULL,e.email,e.email,'店铺下单',e.first_at,e.last_at
FROM (SELECT lower(trim(customer_email)) email,MIN(created_at) first_at,MAX(created_at) last_at
      FROM orders WHERE partner_id IS NULL AND mode='live' AND is_test=0
      AND trim(customer_email) LIKE '%_@_%._%' AND length(trim(customer_email))<=254
      GROUP BY lower(trim(customer_email))) e
WHERE NOT EXISTS(SELECT 1 FROM crm_customers c WHERE c.partner_id IS NULL AND lower(trim(c.email))=e.email);

INSERT INTO owner_order_customers(email,customer_id,created_at)
SELECT e.email,(SELECT c.id FROM crm_customers c WHERE c.partner_id IS NULL AND lower(trim(c.email))=e.email ORDER BY c.created_at,c.id LIMIT 1),e.first_at
FROM (SELECT lower(trim(customer_email)) email,MIN(created_at) first_at FROM orders
      WHERE partner_id IS NULL AND mode='live' AND is_test=0
      AND trim(customer_email) LIKE '%_@_%._%' AND length(trim(customer_email))<=254
      GROUP BY lower(trim(customer_email))) e;

CREATE TRIGGER owner_order_customer_insert AFTER INSERT ON orders
WHEN NEW.partner_id IS NULL AND NEW.mode='live' AND NEW.is_test=0
 AND trim(NEW.customer_email) LIKE '%_@_%._%' AND length(trim(NEW.customer_email))<=254
BEGIN
  INSERT INTO crm_customers(id,partner_id,name,email,source,created_at,updated_at)
  SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-a'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
    NULL,lower(trim(NEW.customer_email)),lower(trim(NEW.customer_email)),'店铺下单',NEW.created_at,NEW.created_at
  WHERE NOT EXISTS(SELECT 1 FROM owner_order_customers WHERE email=lower(trim(NEW.customer_email)))
    AND NOT EXISTS(SELECT 1 FROM crm_customers WHERE partner_id IS NULL AND lower(trim(email))=lower(trim(NEW.customer_email)));
  INSERT INTO owner_order_customers(email,customer_id,created_at)
  SELECT lower(trim(NEW.customer_email)),id,NEW.created_at FROM crm_customers
  WHERE partner_id IS NULL AND lower(trim(email))=lower(trim(NEW.customer_email))
  ORDER BY created_at,id LIMIT 1 ON CONFLICT(email) DO NOTHING;
END;

CREATE TRIGGER owner_order_customer_update AFTER UPDATE OF customer_email,partner_id,mode,is_test ON orders
WHEN NEW.partner_id IS NULL AND NEW.mode='live' AND NEW.is_test=0
 AND trim(NEW.customer_email) LIKE '%_@_%._%' AND length(trim(NEW.customer_email))<=254
BEGIN
  INSERT INTO crm_customers(id,partner_id,name,email,source,created_at,updated_at)
  SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-a'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
    NULL,lower(trim(NEW.customer_email)),lower(trim(NEW.customer_email)),'店铺下单',NEW.created_at,NEW.created_at
  WHERE NOT EXISTS(SELECT 1 FROM owner_order_customers WHERE email=lower(trim(NEW.customer_email)))
    AND NOT EXISTS(SELECT 1 FROM crm_customers WHERE partner_id IS NULL AND lower(trim(email))=lower(trim(NEW.customer_email)));
  INSERT INTO owner_order_customers(email,customer_id,created_at)
  SELECT lower(trim(NEW.customer_email)),id,NEW.created_at FROM crm_customers
  WHERE partner_id IS NULL AND lower(trim(email))=lower(trim(NEW.customer_email))
  ORDER BY created_at,id LIMIT 1 ON CONFLICT(email) DO NOTHING;
END;

-- Financial values remain live: payments/refunds never require a CRM resync.
CREATE VIEW owner_customer_orders AS
SELECT m.customer_id,o.id,o.owner_store_id store_id,json_extract(s.settings,'$.name') store_name,
  o.plan_name,o.created_at,o.status,o.payment_status,
  COALESCE(p.cash_cents,o.price_cents) total_cents,
  CASE WHEN o.payment_status='paid' THEN COALESCE(p.cash_cents,o.price_cents) ELSE 0 END paid_cents,
  MIN(CASE WHEN o.payment_status='paid' THEN COALESCE(p.cash_cents,o.price_cents) ELSE 0 END,
      MAX(o.refunded_cents,COALESCE(r.refunded_cents,0))) refunded_cents
FROM orders o JOIN owner_order_customers m ON m.email=lower(trim(o.customer_email))
JOIN owner_shop_settings s ON s.id=o.owner_store_id
LEFT JOIN member_order_promotions p ON p.order_id=o.id
LEFT JOIN recharge_orders r ON r.order_id=o.id
WHERE o.partner_id IS NULL AND o.mode='live' AND o.is_test=0;
