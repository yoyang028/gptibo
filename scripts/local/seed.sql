-- Synthetic development data only. Re-running does not overwrite administrator edits.
DO $$ BEGIN
 IF current_database() <> 'gptibo_local' THEN RAISE EXCEPTION 'Local seed requires gptibo_local'; END IF;
END $$;
BEGIN;
INSERT INTO catalog_plans(id,product_id,name,price_cents,default_cost_cents,enabled,partner_enabled,sort_order,purchase_note) VALUES
 ('plus','chatgpt','Plus',13900,10000,true,true,1,'本地合成商品，仅验证测试订单，不发生付款或充值。'),
 ('pro-5x','chatgpt','Pro 5×',69900,50000,true,true,2,'本地合成商品，不发生付款或充值。'),
 ('pro-20x','chatgpt','Pro 10×',140000,100000,true,true,3,'本地合成商品，不发生付款或充值。'),
 ('pro-25x','chatgpt','Pro 25×',450000,350000,true,true,4,'本地合成商品，不发生付款或充值。'),
 ('codex-sms-once','codex-sms','单次接码',1000,500,true,true,5,'本地测试使用不可用的演示号码，不接入接码供货。'),
 ('gemini-pro-18m','gemini','18 个月会员',1990,1000,true,true,6,'仅展示，真实支付和供货未接入。'),
 ('duolingo-12m','duolingo','1 年会员',1990,1000,true,true,7,'仅展示，真实支付和供货未接入。'),
 ('gmail-account','gmail','美国长效白号 · 带 2FA',1880,1000,true,true,8,'仅展示，真实支付和供货未接入。'),
 ('x-premium-3m','x-premium','Premium · 3 个月',3500,2000,true,true,9,'仅展示，真实支付和供货未接入。'),
 ('x-premium-6m','x-premium','Premium · 6 个月',5500,3500,true,true,10,'仅展示，真实支付和供货未接入。')
ON CONFLICT(id) DO NOTHING;
INSERT INTO partners(id,slug,name,email,active) VALUES('00000000-0000-4000-8000-000000000001','LOCAL1','本地演示代理','partner@example.invalid',true)
ON CONFLICT(id) DO NOTHING;
INSERT INTO partner_prices(partner_id,plan,price_cents,cost_cents,child_cost_cents)
 SELECT '00000000-0000-4000-8000-000000000001',id,price_cents,default_cost_cents,price_cents FROM catalog_plans
ON CONFLICT(partner_id,plan) DO NOTHING;
INSERT INTO support_contacts(owner,email) VALUES('platform','support@example.invalid'),('00000000-0000-4000-8000-000000000001','partner@example.invalid')
ON CONFLICT(owner) DO NOTHING;
COMMIT;
