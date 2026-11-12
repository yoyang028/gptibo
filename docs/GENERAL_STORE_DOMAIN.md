# 通用商店域名接入

`scholai.vip` 已由店主在 Spaceship 购买，用于通用商店 `store-3`。科研店继续使用 `shop.scholai.top`，预留店 `store-2` 保持暂停。两家营业店共用现有 Worker、D1 和管理后台。

## 域名与店铺的对应关系

Worker 的私有部署变量 `OWNER_STOREFRONT_HOSTS` 是 JSON 对象，例如 `{"general.example.invalid":"store-3"}`。实际域名只写入被 Git 忽略的发布配置；原有生产配置、供货凭据、统一回调 URL 和数据库继续沿用。

访问该域名的 `/`、`/product/chatgpt`、`/orders` 与 `/check` 时，服务端从实际请求 URL 选择通用商店，无需追加 `/s/store-3`。商品目录、原生与自定义商品下单、优惠码和访客统计都使用同一归属。目录返回店铺身份，前端据此选择品牌图标与公告标识。转发 Host 头不能切换店铺；冲突的查询参数、请求体或店铺选择头会被拒绝。新域名的订单列表、详情和操作仅访问该店订单，并仍要求原有买家凭据或邮箱验证。

原域名下的 `/s/store-3`、科研店首页及代理链接继续可用。浏览器 Cookie 按域名隔离，原域名的浏览器订单不会自动迁移到新域名；通用店历史订单可在原入口查询，或在新域名通过原有下单邮箱验证找回。

## DNS 与绑定

2026-11-12 的首次公网检查确认该域名使用 Spaceship 默认 Nameserver，根域名为停放页 A 记录，未查到根域名 MX/TXT，注册局已存在 DNSSEC DS 记录。现有 Cloudflare 官方 CLI 授权可读账户并发布现有 Worker，创建 Zone 返回服务端权限不足。随后已在同一账户中检测到该域名的新 Zone，状态为 `pending`；实际分配的 Nameserver 已核对并告知店主。

接入顺序：

1. 在同一 Cloudflare 账户中添加该域名，使用 Free 方案，取得这个 Zone 实际分配的两条 Nameserver。检查导入的 DNS；停放页记录不作为商城源站，需保留的其他记录应逐项核对。
2. 在 Spaceship 的 Advanced DNS 中先关闭原 DNSSEC，核对注册局 DS 删除后，再将 Nameserver 改为该 Zone 实际分配的值。
3. Cloudflare Zone 激活后，将新域名作为现有 Worker 的 Custom Domain，保留原店域名。绑定前核对会冲突的停放页记录；不使用猜测的服务器 IP 或把根域名指向旧店域名来替代绑定。
4. 验证公网解析、HTTPS 证书、通用店首页、商品页、订单入口、独立售价和原站；成功后才记录“域名已上线”。需要恢复 DNSSEC 时，使用 Cloudflare 为该 Zone 生成的新参数更新注册商。

参考：[Spaceship 更换 Nameserver](https://www.spaceship.com/knowledgebase/connect-domain-custom-nameservers/)、[Cloudflare Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)、[Cloudflare DNSSEC](https://developers.cloudflare.com/dns/dnssec/)。

## 验证与记录

本次 638 项自动化回归通过；生产构建、类型检查与源码安全扫描通过，静态检查无错误。域名专项覆盖目录身份、独立售价、订单归属、跨店拒绝、优惠码、自定义商品与访客统计。

`node scripts/sites/checkout-acceptance.mjs --domains` 使用独立本地 workerd/D1 和两个 HTTPS 主机验证通用店根路径与科研店原路径，包括浏览器下单、独立售价、签名模拟付款与充值完成回调、Session 提取、旧页面保护、幂等、历史订单、电脑和手机布局。统一回调仍使用科研店主机。该测试不读取正式凭据、不产生真实付款或向真实供货商提交订单；截图与记录在 `artifacts/sites/evidence/storefront-domains/`。

2026-11-12 已将域名识别能力部署到现有商城，代码提交 `0a5aaed`，发布标签 `general-store-domain-routing-20261112`，分支与标签均已推送到 `origin`。线上 6 组电脑/手机浏览器检查通过，3 项静态资源哈希与已验证构建一致。D1 迁移仍为 60 条；主店与其他店设置、全部售价、历史订单、原有变量、Secret 名称及统一回调前后核对保留。本轮没有创建真实订单或付款。

实际 Worker 版本、私有部署配置、DNS 检查与后续绑定验收记录放在 `artifacts/cloudflare/prepared/`。绑定预检保留原站且不删除任何域名，但实际新域名绑定被 Cloudflare `100117` 拒绝，提示存在外部管理的旧 DNS 记录；没有把这次尝试记为成功。

店主随后确认已保存 Cloudflare Nameserver 并关闭 DNSSEC。2026-11-12 11:55（北京时间）的官方注册局 RDAP 复核已确认 `delegationSigned=false`，但登记的 Nameserver 仍为 Spaceship 默认值，Cloudflare Zone 仍为 `pending`。部分递归 DNS 暂存旧 DS 并返回验证失败，不能据此认定店主没有关闭 DNSSEC。继续核对注册商 Nameserver 最终确认与注册局同步，待新 Zone 激活后复核停放页冲突、绑定 Custom Domain 并验收 HTTPS；目前不能将程序部署视为新域名已经上线。
