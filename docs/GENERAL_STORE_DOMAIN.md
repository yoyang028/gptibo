# 通用商店域名接入

2026-11-12 已完成通用商店 `store-3` 的域名接入。域名由店主在 Spaceship 购买，DNS 托管至现有 Cloudflare 账户。

| 入口 | 对应店铺 |
| --- | --- |
| [scholai.vip](https://scholai.vip/) | 通用商店首页，直接使用根路径 |
| [www.scholai.vip](https://www.scholai.vip/) | 同一通用商店的别名 |
| [shop.scholai.top](https://shop.scholai.top/) | 原 ScholAI 科研店 |
| 原域名的 `/s/store-3` | 通用商店兼容入口 |

两家营业店共用现有 Worker、D1 和管理后台，统一管理入口继续为 [原主后台](https://shop.scholai.top/admin)。预留店 `store-2` 保持暂停。新域名首页、商品页、订单页及账号检测使用 `/`、`/product/chatgpt`、`/orders`、`/check`，无需携带店铺路径前缀。

## 域名与店铺的对应关系

Worker 的私有部署变量 `OWNER_STOREFRONT_HOSTS` 是 JSON 对象，例如 `{"general.example.invalid":"store-3"}`。实际域名只写入被 Git 忽略的发布配置；原有生产配置、供货凭据、统一回调 URL 和数据库继续沿用。

访问该域名的 `/`、`/product/chatgpt`、`/orders` 与 `/check` 时，服务端从实际请求 URL 选择通用商店，无需追加 `/s/store-3`。商品目录、原生与自定义商品下单、优惠码和访客统计都使用同一归属。目录返回店铺身份，前端据此选择品牌图标与公告标识。转发 Host 头不能切换店铺；冲突的查询参数、请求体或店铺选择头会被拒绝。新域名的订单列表、详情和操作仅访问该店订单，并仍要求原有买家凭据或邮箱验证。

原域名下的 `/s/store-3`、科研店首页及代理链接继续可用。浏览器 Cookie 按域名隔离，原域名的浏览器订单不会自动迁移到新域名；通用店历史订单可在原入口查询，或在新域名通过原有下单邮箱验证找回。

## DNS 与绑定

官方注册局已确认 Cloudflare Nameserver 登记成功，原 DNSSEC 已关闭；Cloudflare Zone 为 `active`。根域名与 `www` 均为现有商城的已启用 Custom Domain，私有部署配置已同步记录全部三个站点域名，后续发布继续沿用该配置。

接入流程与维护依据：

1. 在同一 Cloudflare 账户中添加该域名，使用 Free 方案，取得这个 Zone 实际分配的两条 Nameserver。检查导入的 DNS；停放页记录不作为商城源站，需保留的其他记录应逐项核对。
2. 在 Spaceship 的 Advanced DNS 中先关闭原 DNSSEC，核对注册局 DS 删除后，再将 Nameserver 改为该 Zone 实际分配的值。
3. Cloudflare Zone 激活后，将新域名作为现有 Worker 的 Custom Domain，保留原店域名。绑定前核对会冲突的停放页记录；不使用猜测的服务器 IP 或把根域名指向旧店域名来替代绑定。
4. 验证公网解析、HTTPS 证书、通用店首页、商品页、订单入口、独立售价和原站；成功后才记录“域名已上线”。需要恢复 DNSSEC 时，使用 Cloudflare 为该 Zone 生成的新参数更新注册商。

参考：[Spaceship 更换 Nameserver](https://www.spaceship.com/knowledgebase/connect-domain-custom-nameservers/)、[Cloudflare Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)、[Cloudflare DNSSEC](https://developers.cloudflare.com/dns/dnssec/)。

## 验证与记录

本次 638 项自动化回归通过；生产构建、类型检查与源码安全扫描通过，静态检查无错误。域名专项覆盖目录身份、独立售价、订单归属、跨店拒绝、优惠码、自定义商品与访客统计。

`node scripts/sites/checkout-acceptance.mjs --domains` 使用独立本地 workerd/D1 和两个 HTTPS 主机验证通用店根路径与科研店原路径，包括浏览器下单、独立售价、签名模拟付款与充值完成回调、Session 提取、旧页面保护、幂等、历史订单、电脑和手机布局。统一回调仍使用科研店主机。该测试不读取正式凭据、不产生真实付款或向真实供货商提交订单；截图与记录在 `artifacts/sites/evidence/storefront-domains/`。

2026-11-12 已将域名识别能力部署到现有商城，代码提交 `0a5aaed`，程序发布标签为 `general-store-domain-routing-20261112`，域名正式上线标签为 `general-store-domain-live-20261112`。标签对应同一实际 Worker 代码版本；新增域名绑定没有重建数据库或重新部署应用。具体版本及配置见私有发布记录。

验证范围：

- 域名接入前，原站 6 组电脑/手机浏览器检查及 3 项静态资源哈希核对通过。
- 接入后，独立网络浏览器确认两个新域名的正常 HTTPS、通用商店首页，以及根域名商品页和订单页可访问；外部公开 JSON 复核两个域名的 `shop.id` 与 `ownerStoreId` 均为 `store-3`。
- 店主用普通浏览器确认 ChatGPT 商品页显示「立即购买」，且没有来源验证提示。自动浏览器在初始化时观察到来源拒绝，故未把自动下单表单检查记为通过；原有严格 Origin 校验继续保留。该证据边界与店主确认均已记录。
- 发布后再次只读核对实际 Worker 版本、三个启用的域名、全部店铺设置和售价、历史订单归属、生产绑定、Secret 名称及原有变量；全部与发布前快照对应一致。D1 迁移仍为 60 条，统一供货回调继续使用原主站地址，原站健康检查通过。
- 本轮没有创建真实订单或付款，也未把模拟支付、浏览器购买入口检查或域名上线当作新的真实付费交付验收。

首次根域名绑定遇到 Cloudflare `100117`，由店主清理已识别的旧停放 A 记录、完成名称服务器检查后，重新绑定成功。维护时保留 Custom Domain 自动管理的记录；若后续恢复 DNSSEC，使用 Cloudflare 为该 Zone 生成的新 DS 参数。

实际 Worker 版本、配置、DNS、证书、外部浏览器、店主确认与生产数据核对记录保存在被 Git 忽略的 `artifacts/cloudflare/prepared/`。分支、上线记录提交和带说明的发布标签同步至现有 `origin` 仓库。
