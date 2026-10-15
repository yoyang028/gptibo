# Cloudflare 部署准备与验收

本轮选择项目已有的 React 静态前端 + Cloudflare Worker + D1。主商城与主后台使用同一个域名，后台入口为 `/admin`；个人店铺无需开通自己的代理商店或代理工作台。Go/PostgreSQL 本机环境继续保留，两个后端不共享数据库。

2026-10-15 本轮仅完成本地验证和发布准备，没有创建云资源、上传版本、修改 DNS 或绑定域名，也没有再次付款或向真实账号提交充值。实际域名和资源标识写入被 Git 忽略的 `artifacts/cloudflare/prepared/`，公共源码只保留示例。

## 已验证范围

| 项目 | 结果与证据边界 |
| --- | --- |
| 供货 API 真实只读查询 | 实际 workerd 调用账户、商品、支付方式，共 3 次签名 GET；13 项检查通过。当前 Plus 授权与目录供货价均为 110.00 CNY，支付宝、平台代收和自动直充权限可用。写入请求为 0。价格属于当次查询快照。 |
| 前端和后端构建 | React/TypeScript、Worker、邮件模板构建通过；Wrangler `deploy --dry-run` 成功生成 Worker 部署包与静态资源清单。没有上传。 |
| 实际本地 D1 | 44 个迁移执行完成，包括触发器。迁移使用 Wrangler 的 SQL 解析器逐条准备，在 D1 原子批次中应用。 |
| 原商城完整流程 | Chromium 通过商品购买、原订单绑定付款码、未付款拒绝充值、模拟付款、Session 授权、202 排队、暂停、失败后原单第二次任务、陈旧请求与回调保护、成功与订单历史。 |
| 登录与隔离 | 独立买家不能查看其他订单；文件邮件找回订单可用；后台文件邮箱验证码 + 独立 TOTP 登录可用。没有发送真实邮件。 |
| 售后 | 买家申请 → 后台页面点击审核 → 页面提交模拟供货退款 → 核对原单退款金额 → 本地记账及显示退款完成；退款后禁止充值。Cloudflare 版本保留审核、执行两个步骤。后台退款提醒读取实际待处理数量，未启用的代理工单不会误报连接中断。 |
| 数据保护 | 真实 D1 中检查订单、事件、任务、回调和审计表，未发现提交的模拟 Session/Access Token；回调保存摘要，不保存原始通知。 |
| 重启与恢复 | 停止并重新启动本地栈，原买家会话、成功订单和两次任务记录仍可查询；一致性 SQLite 备份已恢复进第二个实际 D1 运行时，数量及完整性核对通过。 |
| 浏览器 | 完整验收无页面运行错误、无外部浏览器请求。 |
| 之前的 1 元支付 | 已独立验证真实 1 元付款与绑定支付通知；它不证明 Plus 交付、真实售后退款或利润提现。 |

本地业务验收使用独立模拟供货商，不能等同于真实 Plus 全链路验收。真实 Plus 充值、正式退款和利润提现仍未验证，不再为本轮要求额外付费测试。

最终本机回归：403 项 Node/前端/Worker 测试通过；20 个 Go 测试包、620 个测试及子用例通过，失败和跳过的测试均为 0。Go vet、TypeScript 和生产构建通过。Lint 保留 5 条既有 Fast Refresh 警告，构建保留既有大块体积提示。远程 CI 未取得本分支运行记录，不能把本机结果写成云端验收。

暂存源码导出后分别通过公共源码检查和 Gitleaks 凭据扫描。Windows 路径统一为 `/` 后识别已审核图片，保留对未知二进制、私钥和意外外部地址的检查；运行资料及实际配置不进入提交。

## 本机验收

在项目根目录执行，脚本不修改全局 PowerShell 执行策略。需要复用现有 D 盘 Node、Go 和 Chromium。

```powershell
.\local-cloudflare.cmd start
.\local-cloudflare.cmd status
.\local-cloudflare.cmd test
.\local-cloudflare.cmd login
.\local-cloudflare.cmd stop
```

- 商城：`https://127.0.0.1:8771`；后台：`https://127.0.0.1:8771/admin`。
- 独立供货模拟控制台：`http://127.0.0.1:8772`；模拟供货 TLS API：8773。
- 私有控制端口：8774，仅用于状态、停止、调度和脱敏审计。修改操作还要求本机秘密令牌与匹配 Origin；它不会进入部署包。
- 8771 使用本地测试证书，未添加到系统信任根。自动验收仅对本机测试上下文忽略证书错误，正式域名使用 Cloudflare 的正常 HTTPS。
- 后台用户名为 `dev-admin`。先点击“获取验证码”，再用 `login` 命令显示文件邮箱验证码与当前 2FA 码；生产环境不得复用这些身份或秘密。
- 浏览器辅助 API 使用新连接，重复提交碰到明确的同步忙状态时，只以原请求和原提交编号短暂重试；不跳过锁或换业务键。
- 复测曾遇到辅助 API 客户端单次 `socket hang up`；随后 90 次本机只读连接探测和完整浏览器验收通过，未定位到稳定复现条件。该现象保留在本地日志，不作为生产稳定性证明。

所有数据库、证书、模拟邮件、备份、截图和日志均位于 `artifacts/local/`。原 Go 测试商城仍在 5176，数据库与模拟服务保持独立。

真实供货只读复查：

```powershell
# 在项目本地 PowerShell 环境中运行；凭据从已有 DPAPI 文件解密到内存。
.\scripts\local\cloudflare-readonly.ps1
```

检查工具和 Worker 客户端均限制为三个只读接口；旧订单、付款码、充值和退款路径也被拦截。完整凭据不写入 JS 包、结果文件或聊天。

## 生成部署配置

使用自己拥有的主机名；下面是公开示例。

```sh
npm run build
npm run cloudflare:prepare -- --domain shop.example.com
npm run cloudflare:check
npm run cloudflare:dry-run
```

产物位于 `artifacts/cloudflare/prepared/`：

- `wrangler.json`：私有域名配置；默认关闭测试购买、所有销售及无关供货，只映射 Plus，平台代收，只读模式开启。
- `readiness.json`：离线检查、待配置的账户、D1 与生产秘密清单。
- `bundle/`、`bundle-manifest.json`：Wrangler 本地打包结果、大小与 SHA-256。
- `logs/dry-run.txt`：构建记录。只有 `--dry-run`，没有上传。
- `domain-preflight.json`：所选域名当次只读 DNS 快照。为绕开本机代理的合成 IP，另用公共 DNS over HTTPS 查询；发现现有 CNAME，正式发布前必须核对旧服务并安排切换。本轮没有变更记录。

`offlineReady=true` 仅说明本地发布配置通过检查。全零 D1 标识、未选择账号和未配置生产秘密仍会显示待完成；`remoteStateVerified=false` 与 `salesEnabled=false` 不会被包装成上线完成。

部署账户和 D1 ID 确定后，再使用 `--account-id` 与 `--d1-id` 重新生成。工具不会把已配置的 D1 自动改回占位值；不要把资源标识、供货密钥或真实域名填回公共示例文件。

## 实际发布前需要的信息

1. Cloudflare 账号及处于该账号有效 Zone 中的域名，确认所选子域名当前记录和服务。现有 CNAME 需要单独核对，不能直接覆盖。
2. 新建、空的生产 D1，绑定 `INTEREST_DB` 并执行本仓库 44 个迁移。不上传本地模拟库或使用已有客户数据库。
3. 生产管理员用户名、管理员邮箱、全新 TOTP、独立认证秘密；Resend 发信身份与有效密钥。后台登录需要真实邮箱验证。
4. 供货 API 地址、同一应用的 partner/key/client secret；正式完整回调 URL 与该 URL 独立的 webhook secret。之前临时隧道地址不能用于正式店铺，旧登记应在供货平台停用。
5. 核对售价、当前供货价、客服与售后说明。平台代收由供货商向顾客收款，无需本店另接支付宝商户支付；利润结算时间、提现门槛和手续费以供货平台规则为准，尚未实测。

生产秘密使用 Workers Secrets，不放在 `vars`、前端代码或版本库中。此轮未登录云账号或上传任何秘密。

## 发布顺序（本轮未执行）

先由店主明确开始发布，再使用选定账户的新资源：

1. 创建新 D1，把账户、D1 ID 写入私有配置。先运行 `wrangler d1 migrations list` 核对目标，再对该新库执行 `migrations apply --remote`。
2. 建立生产 Secrets；保持 `RECHARGE_CHECKOUT_ENABLED=false` 和 `RECHARGE_READ_ONLY=true`。构建后先再次执行本地 dry run，保存提交、构建清单和数据库书签。
3. 发布关闭销售的版本，绑定已确认子域名。检查 `/api/health`、页面资源、后台邮件登录、权限和重定向；确认没有测试数据、测试按钮或其他商品销售入口。
4. 向供货商登记正式 `https://所选域名/api/recharge/webhook`，使用该登记产生的独立 secret，验签 `webhook.test`。此时无需生成 Plus 付款订单。
5. 店主确认营业后，才将只读模式关闭并启用 Plus 购买；保留其他销售开关关闭。首笔真实业务人工观察，未知状态只核对原订单与原任务，不重复支付或另开单。真实交付结果出现后再补充验收记录。

Cloudflare 每分钟调度后台任务，供货对账沿用原先五分钟周期；购物页面同时轮询原订单。回调只唤醒对应订单并触发权威查询，不能直接把通知里的“成功”当作付款或充值成功。

## 备份、回滚和限制

本地备份恢复演练：`node scripts/cloudflare/backup-check.mjs`。重启后原买家订单复查：`node scripts/cloudflare/persistence-check.mjs`。两个命令只接受本轮独立模拟环境。

正式更新前保存 Worker 版本与 D1 Time Travel 书签。回滚代码不等于回滚数据库；新迁移需要先确认向后兼容。D1 数据恢复会覆盖现有数据，必须在核对影响并获授权后单独执行，本轮没有执行远程恢复。

Go/PostgreSQL 与 D1 的结构及运行模型不同。既有 Go 离线 D1 导入器只支持至 0043 的旧契约，会拒绝本轮 0044 新字段，不能直接用于这套新 D1；未来跨后端迁移需单独适配和核对，不能忽略未知数据。

Cloudflare 版本目前使用已有边缘限流；共享表单得到真实的“未启用 Turnstile”配置。Go 扩展的外部 Session 预检、加密留存后管理员自动补发、额外安全审计与工单等能力未在本轮移植或验收。个人店铺的本轮验收范围以以上购买、订单、后台与售后链路为准。

官方依据：[静态资源与 Worker](https://developers.cloudflare.com/workers/static-assets/)、[自定义域名](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)、[D1 迁移](https://developers.cloudflare.com/d1/reference/migrations/)、[Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)、[D1 备份恢复](https://developers.cloudflare.com/d1/reference/time-travel/)。
