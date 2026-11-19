-- Display order is independent of immutable store IDs, URLs and order ownership.
UPDATE owner_shop_settings
SET settings=json_set(settings,'$.displayOrder',1,'$.name','ScholAI'),
    version=version+1,change_id='owner-store-order-20261120',updated_at=unixepoch()*1000
WHERE id='platform';
UPDATE owner_shop_settings
SET settings=json_set(settings,'$.displayOrder',2,'$.name','AI星球'),
    version=version+1,change_id='owner-store-order-20261120',updated_at=unixepoch()*1000
WHERE id='store-3';
UPDATE owner_shop_settings
SET settings=json_set(settings,'$.displayOrder',3,'$.name','备用商店','$.brandName','备用商店','$.active',json('false'),
      '$.pageTitle',CASE WHEN json_extract(settings,'$.pageTitle') LIKE json_extract(settings,'$.name')||'%'
      THEN '备用商店'||substr(json_extract(settings,'$.pageTitle'),length(json_extract(settings,'$.name'))+1)
      ELSE COALESCE(json_extract(settings,'$.pageTitle'),'') END),
    version=version+1,change_id='owner-store-order-20261120',updated_at=unixepoch()*1000
WHERE id='store-2';
INSERT INTO admin_audit(id,target_id,action,note,created_at)
SELECT 'owner-store-order-20261120:'||id,id,'owner-shop','调整店铺显示顺序与名称；备用商店保持停用',updated_at
FROM owner_shop_settings WHERE change_id='owner-store-order-20261120';
