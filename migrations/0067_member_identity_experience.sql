-- Public aliases never replace the stable invitation IDs frozen on orders.
CREATE TABLE member_invite_aliases (
  alias TEXT PRIMARY KEY COLLATE NOCASE,
  member_id TEXT NOT NULL REFERENCES member_profiles(id),
  kind TEXT NOT NULL CHECK(kind IN ('default','custom')),
  created_at INTEGER NOT NULL,
  UNIQUE(member_id,kind),
  CHECK(length(alias) BETWEEN 3 AND 20 AND alias=lower(alias)
    AND alias NOT GLOB '*[^a-z0-9-]*' AND substr(alias,1,1)<>'-' AND substr(alias,-1,1)<>'-')
);
CREATE TRIGGER member_alias_no_update BEFORE UPDATE ON member_invite_aliases BEGIN SELECT RAISE(ABORT,'Invitation aliases are permanent'); END;
CREATE TRIGGER member_alias_no_delete BEFORE DELETE ON member_invite_aliases BEGIN SELECT RAISE(ABORT,'Invitation aliases are permanent'); END;
CREATE TRIGGER member_alias_custom_audit AFTER INSERT ON member_invite_aliases WHEN NEW.kind='custom'
BEGIN
  INSERT INTO member_operation_events(id,category,target_id,action,actor,note,details,created_at)
  VALUES ('invite-alias:'||NEW.member_id,'invitation',NEW.member_id,'customize',NEW.member_id,
    '会员确认一次性自定义邀请地址',json_object('alias',NEW.alias),NEW.created_at);
END;

-- Preserve all other stores, contacts, artwork, products and prices.
UPDATE owner_shop_settings SET settings=json_set(settings,
  '$.name','AI星球','$.brandName','AI星球','$.pageTitle','AI星球 · AI 订阅与数字服务'),
  version=version+1,change_id='aiplanet-identity-20261114',updated_at=unixepoch()*1000
WHERE id='store-3';
INSERT INTO admin_audit(id,target_id,action,note,created_at)
SELECT 'aiplanet-identity-20261114:store-3',id,'owner-shop','统一 AI星球 店名、品牌与浏览器标题',updated_at
FROM owner_shop_settings WHERE id='store-3' AND change_id='aiplanet-identity-20261114';
