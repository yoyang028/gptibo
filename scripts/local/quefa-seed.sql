DO $$ BEGIN
 IF current_database() <> 'gptibo_quefa_local' THEN RAISE EXCEPTION 'Quefa mock seed requires its isolated database'; END IF;
END $$;
BEGIN;
INSERT INTO catalog_plans(id,product_id,name,price_cents,default_cost_cents,enabled,partner_enabled,sort_order,purchase_note)
VALUES('plus','chatgpt','Plus',13900,11000,true,false,1,'Quefa 本地模拟联调：不发生付款或充值，仅填写模拟控制台提供的测试资料。')
ON CONFLICT(id) DO NOTHING;
INSERT INTO support_contacts(owner,email) VALUES('platform','support@example.invalid') ON CONFLICT(owner) DO NOTHING;
COMMIT;
