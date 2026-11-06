# 通用商店与代理供货中心

现有 ScholAI 商店继续使用默认构建。两个新站共用此仓库的代码和依赖，分别构建、分别部署、分别保存数据。名称暂定为「通用商店」和「代理供货中心」，当前交付为本地版本，尚未绑定新域名或发布云端。

| 站点 | 用途 | 构建模式 | 数据和价格 |
| --- | --- | --- | --- |
| 现有商店 | 现有 ScholAI 业务 | 默认 `vite build` | 原数据库与配置 |
| 通用商店 | 面向普通顾客的中性品牌商店 | `general` | 独立零售数据库，复用购买、订单与售后 |
| 代理供货中心 | 代理批发、余额拿货、API 对接 | `wholesale` | 独立代理数据库、批发目录、余额与资金流水 |

共享代码不代表共享余额、订单或库存。两个新站需要各自的 Worker、D1 数据库、域名和身份秘密，不复制原站的运行时数据库或凭据。

## 本地打开

Windows 可双击项目根目录的 `local-stores.cmd`。它使用已有 Node 和依赖完成构建，再启动两个仅监听本机的站点。也可在项目目录运行：

```sh
node scripts/sites/build.mjs
node scripts/sites/local.mjs
```

- 通用商店：`http://localhost:8801`
- 代理供货中心：`http://127.0.0.1:8802`
- 各站管理后台：在对应地址后加 `/admin`。
- 代理测试邮箱：`agent@example.invalid`。
- 本地管理员用户名：`preview-admin`，邮箱：`admin@example.invalid`。

在页面点击「获取验证码」后，另开终端运行 `node scripts/sites/codes.mjs` 或 `local-stores.cmd codes`，查看该站本地邮箱的最新验证码及管理员 2FA。两站使用不同主机名，避免本机浏览器的 Cookie 混用。

所有演示商品、邮箱、卡密与充值均为本地模拟。初始代理余额为零，演示充值也需要在本地后台核对。不要向演示页面付款。模拟邮件只写入本机文件，运行器拒绝外部采购、收款和邮件请求。

构建产物、独立数据库、临时文件、模拟身份和截图全部位于 Git 忽略的 `artifacts/sites/`，重启保留各自数据；关闭运行终端或按 Ctrl+C 可停止预览。运行器不读取现有店铺的生产凭据。

开发时可保持本地后端运行，再启动热更新页面：

```sh
node node_modules/vite/bin/vite.js --config vite.multistore.config.ts --mode general
node node_modules/vite/bin/vite.js --config vite.multistore.config.ts --mode wholesale
```

## 店主使用流程

代理供货站后台的「供货管理」包含：

1. **代理账户**：开通代理名称和登录邮箱，查看余额与流水；停用或重新启用都会使旧会话和 API 密钥失效，保留余额与订单。
2. **批发商品**：设置 SKU、分类、介绍、统一代理价、交付方式和上下架状态。价格与零售站分开，不会自动使用零售价打折。
3. **库存卡密**：每次最多导入 100 条，一行一条；加密保存，重复卡密会使整批导入撤回。库存商品扣款后自动分配卡密。
4. **充值核对**：核实实际收款，填写实际金额、唯一收款流水和说明后入账；未核实的申请不增加余额，重复收款流水不能重复入账。
5. **采购与交付**：人工商品填写交付内容；整单退款退回代理余额。已交付卡密不会因退款重新出售。

本版代理价是每个商品统一的代理价；尚未增加分级价、单独代理议价、余额提现、自动支付充值、供货商 API 再采购或推送回调。这些功能也不会被默认为已开通。

通用店后台继续使用「我的店铺」「商品管理」等现有功能，自有商品可沿用人工收款或已支持且另行配置的供货协议。新库不会自动拥有原站已授权的商品、上游凭据或支付资格。

## 代理与 API

代理登录后有商品拿货、采购订单、账户余额、API 对接四个入口。网页和 API 使用同一代理账户和余额。完整 API 密钥只在创建时显示一次；服务端只保存摘要，默认 90 天有效，最多 5 个有效密钥，可随时撤销。

所有下列接口需要代理会话或 `Authorization: Bearer YOUR_API_KEY`。金额单位为人民币分，数量为 1–100，所有关键金额均由服务端计算。

| 请求（统一前缀 `/api/wholesale`） | 用途 |
| --- | --- |
| `GET /account` | 当前代理与可用余额 |
| `GET /products` | 上架商品、代理价、库存、交付方式 |
| `POST /orders` | 原子扣款与拿货，必须带唯一请求编号 |
| `GET /orders?request_key=your-order-00001` | 按你的请求编号找回原单 |
| `GET /orders/{id}` | 状态与 `delivery` 交付数组 |
| `GET /orders?page=1` | 采购订单，每页 50 条 |
| `GET /ledger?page=1` | 资金流水，每页 50 条 |

下单示例（商品、价格与域名应替换为你的实际配置）：

```sh
curl 'https://YOUR_DOMAIN/api/wholesale/orders' \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: your-order-00001' \
  -d '{"product_id":"your-product","quantity":1,"max_unit_price_cents":500,"buyer_note":""}'
```

首次创建返回 201，重复相同编号与内容返回 200 和 `replayed: true`。该编号在每个代理内唯一，改动内容重试返回 409。`max_unit_price_cents` 是你同意的单件最高代理价，实际价格高于此值时拒绝下单。

请求超时后应按原 `request_key` 查询或使用相同内容重试，不能换新编号购买。网页也会在提交前保留待确认请求编号，刷新或关闭弹窗后可继续核对原单。库存商品返回 `fulfilled`；人工商品先返回 `pending`，至少间隔 10 秒查询原单；退款后为 `refunded`。

余额或库存不足均返回 409，扣款和分配库存全部撤回；401 表示登录或密钥失效，429 表示限流，应至少等待 60 秒。API 不允许创建密钥或声明充值；这些操作需要网页登录。API 仅用于服务端对接，不开放跨站浏览器调用。

## 正式部署准备

设置前端构建模式时，同时将 Worker 的 `STOREFRONT_KIND` 设置为 `general` 或 `wholesale`。服务端以这个变量决定是否允许批发接口，不能用浏览器参数开启代理站。默认部署不开放批发接口；批发站也不开放零售下单接口。

有了各自的域名、Cloudflare 账户和新建 D1 标识后，可生成各自独立的私有部署文件：

```sh
node scripts/sites/prepare.mjs --site general --domain YOUR_RETAIL_DOMAIN --d1-id YOUR_RETAIL_D1_ID --account-id YOUR_ACCOUNT_ID
node scripts/sites/prepare.mjs --site wholesale --domain YOUR_WHOLESALE_DOMAIN --d1-id YOUR_WHOLESALE_D1_ID --account-id YOUR_ACCOUNT_ID
```

结果保存在 `artifacts/sites/{general,wholesale}/prepared/wrangler.json`。脚本仅准备文件，不创建云资源、修改 DNS、发布网站或替换原店部署。它会阻止复用已准备的其他站点域名和 D1。所有真实零售交易开关初始关闭，批发充值收款说明初始留空，未配置时不能提交充值。

发布前需为各新库应用迁移，批发账务结构为 `0058_wholesale.sql`；配置各自管理员、邮箱服务和独立 `PARTNER_AUTH_SECRET`。正式批发收款方式通过 `WHOLESALE_PAYMENT_INSTRUCTIONS` 设置，**这只是人工核对的收款说明，不是自动验款接口**。密钥承担卡密加密用途，已有交付数据时不能直接丢弃或替换加密秘密。

确认商品、价格、收款主体与真实业务验收后再发布各站。当前没有新域名、真实充值或云端发布记录，也没有为本地版本创建发布标签。

## 验证

```sh
node --test tests/*.test.ts
node scripts/sites/build.mjs
# 保持本地预览运行，在另一终端执行：
node scripts/sites/acceptance.mjs
```

新增测试覆盖代理身份与停用、隔离、报价变化、余额与库存并发不足、重复请求、重复充值流水、人工交付、退款、密钥摘要与撤销、CSRF 和独立部署配置。浏览器验收使用真实本机 workerd / D1，结果在 `artifacts/sites/evidence/acceptance.json`，截图也在此目录。

2026-11-06 验证：完整 Node 回归 611 项通过（包含 14 项多站与批发验证），前端与 Worker 类型检查通过，两种新站和原商店默认构建均通过；浏览器的 11 组业务与页面检查通过，包括后台创建商品、导入库存与人工交付，页面运行错误和外部浏览器请求均为零。验证未产生真实收款、真实上游采购或云端部署。

扣款、库存与流水由同一 SQL 语句中的触发器维护，条件不满足使用 `RAISE(ABORT)` 撤回；批量库存导入使用 D1 原子批次。实现依据：[SQLite 触发器与 RAISE](https://www.sqlite.org/lang_createtrigger.html)、[Cloudflare D1 batch 事务说明](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)。这些本地验证不替代正式支付通道验收。
