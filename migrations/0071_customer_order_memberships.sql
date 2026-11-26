-- The order and verified recharge receipt are the record of each purchase.
-- Keep the account hint masked and keep automatic history separate from manual CRM records.
CREATE VIEW crm_owner_order_memberships AS
WITH receipts AS (
  SELECT co.customer_id,co.id order_id,co.store_id,co.store_name,co.plan_name,
    o.plan,co.created_at,co.status order_status,o.refund_hold,
    co.paid_cents,co.refunded_cents,r.payment_status upstream_payment,
    a.account_email_masked account_hint,a.finished_at,
    (SELECT MIN(e.created_at) FROM order_events e
      WHERE e.order_id=o.id AND e.to_status='success' AND e.from_status IS NOT 'success'
        AND e.action IN ('recharge-status','platform-fulfillment-completed') AND e.created_at>=co.created_at) confirmed_at
  FROM owner_customer_orders co
  JOIN orders o ON o.id=co.id
  LEFT JOIN recharge_orders r ON r.order_id=o.id
  LEFT JOIN recharge_redemptions a ON a.id=(SELECT last.id FROM recharge_redemptions last
    WHERE last.order_id=o.id AND last.status='succeeded' ORDER BY last.attempt_no DESC LIMIT 1)
  WHERE co.payment_status='paid' AND o.plan IN ('plus','pro-5x','pro-20x','pro-25x')
), verified AS (
  SELECT *,CASE
    WHEN order_status<>'success' THEN NULL
    WHEN finished_at>=created_at AND finished_at<=COALESCE(confirmed_at+86400000,strftime('%s','now')*1000) THEN finished_at
    ELSE confirmed_at END opened_at
  FROM receipts
), states AS (
  SELECT *,CASE
    WHEN upstream_payment='refunded' OR (paid_cents>0 AND refunded_cents>=paid_cents) THEN 'refunded'
    WHEN refund_hold=1 THEN 'review'
    WHEN order_status IN ('failed','cancelled') THEN 'inactive'
    WHEN order_status<>'success' THEN 'pending'
    WHEN opened_at IS NULL THEN 'unverified'
    ELSE 'confirmed' END state
  FROM verified
)
SELECT customer_id,order_id,store_id,store_name,plan,plan_name,created_at,
  CASE WHEN order_status='success' AND length(account_hint)<=320
    AND instr(account_hint,'*')>0 AND instr(account_hint,'*')<instr(account_hint,'@') THEN account_hint END account_hint,
  opened_at,state,
  -- One calendar month in Beijing time, clamped to the last day of shorter months.
  CASE WHEN state='confirmed' THEN
    CAST(strftime('%s',opened_at/1000,'unixepoch','+8 hours','start of month','+1 month') AS INTEGER)*1000
    + (MIN(CAST(strftime('%d',opened_at/1000,'unixepoch','+8 hours') AS INTEGER),
      CAST(strftime('%d',opened_at/1000,'unixepoch','+8 hours','start of month','+2 months','-1 day') AS INTEGER))-1)*86400000
    + (opened_at+28800000)%86400000-28800000
  END expected_expiry
FROM states;
