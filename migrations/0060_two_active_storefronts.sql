-- Keep the academic root store, open the general store, and reserve slot two.
-- Preserve all product prices, supplier configuration, contacts and order data.
UPDATE owner_shop_settings
SET settings=json_set(settings,'$.active',json('false')),
    version=version+1,change_id='two-store-launch-20261112',updated_at=unixepoch()*1000
WHERE id='store-2';

UPDATE owner_shop_settings
SET settings=json_set(settings,
      '$.name','通用商店','$.active',json('true'),'$.brandName','通用商店','$.logo','',
      '$.pageTitle','通用商店 · AI 订阅与数字服务',
      '$.headline','按需选择，轻松下单。',
      '$.description','AI 订阅、学习与工具服务，选择商品后在线下单，付款与交付进度随时可查。',
      '$.announcementTitle','','$.announcement',''),
    version=version+1,change_id='two-store-launch-20261112',updated_at=unixepoch()*1000
WHERE id='store-3';

INSERT INTO admin_audit(id,target_id,action,note,created_at)
SELECT 'two-store-launch-20261112:'||id,id,'owner-shop',
       CASE id WHEN 'store-2' THEN '预留店暂停营业，保留配置及历史订单'
       ELSE '通用店面向通用人群，清除复制的学术简介与公告' END,updated_at
FROM owner_shop_settings WHERE change_id='two-store-launch-20261112';
