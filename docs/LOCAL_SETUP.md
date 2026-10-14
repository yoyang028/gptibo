# 第一轮本地搭建与验收

此文档对应当前开源源码的 Windows 原生开发环境。运行数据、工具、缓存、日志与截图集中在项目的 `artifacts/local/`，该目录被 Git 忽略。没有生产数据、真实支付、真实采购或线上部署。

## 原项目架构

- `src/`：React 19 + TypeScript + Vite 8，Tailwind CSS 4；商城、订单页、管理员与代理工作台共享原组件和样式。后台按入口懒加载。
- `services/storefront/`：主后端 Go + Gin + pgx/PostgreSQL。同一个二进制分别以 `api`、`worker` 模式运行；业务 Worker 做心跳、认证数据保留、任务核对和通知处理。
- `services/storefront/migrations/`：33 项结构迁移，保存迁移校验和；迁移身份与受限运行身份分开。
- `shared/`：前后端共用的订单、退款、支付状态、商品、公告和联系信息约定。
- `emails/`、`worker/emails.generated.ts`、Go `mailer/templates.json`：React 邮件模板及构建生成物。
- `worker/`、根目录 `migrations/`：Cloudflare Workers + D1 备用实现；本轮运行目标选用 README 标明的 Go 主后端。Node 测试与 TypeScript 构建也覆盖备用 Worker 源码。
- `tests/`、Go `internal/` 测试、`integration/`：纯逻辑、协议适配、鉴权、数据库约束、财务、退款、层级代理、多商店与前后端路由契约测试。

源码不包含可用的真实供货执行系统。匿名供应商与聚合支付使用保留域名和演示映射；相应协议测试通过不代表已经完成真实接入。

## 本地运行配置

| 组件 | 地址或位置 |
| --- | --- |
| 商城 | `http://127.0.0.1:5175` |
| 管理后台 | `http://127.0.0.1:5175/admin` |
| 代理后台 | `http://127.0.0.1:5175/partner` |
| 演示代理商店 | `http://127.0.0.1:5175/s/LOCAL1` |
| Go API / 健康检查 | `http://127.0.0.1:8093/healthz` |
| PostgreSQL | `127.0.0.1:55432` |
| 合成业务库 / 专用测试库 | `gptibo_local` / `gptibo_local_test` |
| 邮件收件箱 | `artifacts/local/mailbox/*.json` |
| 日志 / 验收证据 | `artifacts/local/logs/` / `artifacts/local/evidence/` |
| 本机独立秘密 | `artifacts/local/.secrets/` |

默认启动原前端构建产物的 Vite 本地预览，适合保留到次日验收。使用 `services/storefront/vite.config.ts`，API 代理至 8093，并保留原开发 Origin 转换。开发依赖扫描仅从原 `index.html` 开始，文件监听排除工具、缓存、数据库和验收目录。只监听回环地址，不注册 Windows 系统服务。

开源新库没有商品，本轮使用 `scripts/local/seed.sql` 添加 10 项合成套餐和演示代理。脚本仅允许连接 `gptibo_local`，重复执行不会覆盖已有管理修改。示例金额沿用前端展示值，不是销售报价。

`ORDER_TESTING_ENABLED=true` 使用原非交易测试状态机。ChatGPT 和接码的测试流程可在本地走通；邮件发货商品和 X Premium 依然受原真实接入开关控制。所有支付、供货、Telegram、外部通知和真实邮件开关均关闭。

## 启动、停止和登录

在项目根目录用 PowerShell 7 执行：

```powershell
./scripts/local/start.ps1
./scripts/local/status.ps1
./scripts/local/stop.ps1
# 需要前端热更新时，在停止现有服务后使用：
./scripts/local/start.ps1 -Dev
```

初始化或后端源码变更后重建：

```powershell
# 若后端正在运行，先停止，以便重新生成 Windows 二进制。
./scripts/local/stop.ps1
./scripts/local/init.ps1
./scripts/local/start.ps1
```

管理员用户名为 `dev-admin`。打开管理后台填写用户名，点击获取验证码，保持登录页打开。随后双击项目根目录的 `local-login.cmd`，窗口会显示邮箱验证码与当前 2FA 动态码，并在收到新邮件或动态码更新时自动刷新。分别填入后台的“邮箱验证码”和“2FA 验证码”，再点击登录。

也可在任意 Windows PowerShell（包括系统自带的 x86 版本）中运行下面一行；它直接使用本机 D 盘 Node，不依赖 PowerShell 脚本执行策略或全局 Node PATH，不修改系统策略：

```powershell
& 'D:\ChatGPT\Codex\Projects\GPTibo\local-login.cmd'
```

邮箱验证码 10 分钟内有效且只能使用一次；若刷新了登录页或已用过该验证码，需要在页面重新获取。2FA 动态码每 30 秒变化；使用助手当前显示的号码。助手仅显示本地信息，不会自动申请验证码或登录。

已加载 `env.ps1` 的开发终端也可使用原命令查看一次：

```powershell
node scripts/local/auth.mjs admin
```

命令读取本机邮件并显示邮箱验证码和当前 TOTP，填入原后台表单即可登录，不设置通用密码或固定验证码。上述 `.cmd` 助手可避免 Windows 默认禁用 `.ps1` 及未安装全局 `node` 导致的登录准备错误。

演示代理邮箱为 `partner@example.invalid`。在代理后台获取验证码后运行：

```powershell
./local-login.cmd partner
# 客户找回订单验证码同理，使用下单时的合成邮箱：
./local-login.cmd '你下单时填写的合成邮箱'
```

新增 `LOCAL_MAIL_DIR` 仅将原模板渲染的邮件保存到本机，无网络发送。只有公开来源与 API 监听地址均为回环地址且真实邮件关闭时，后端才允许启用；验证码过期、一次性使用、限流、管理员 TOTP 与 HttpOnly 会话校验保持原实现。迁移只读验收模式仍关闭此功能。

原下单表单只接受常用邮箱域名，本轮使用随机的 `gptibo-local-demo-随机串@gmail.com` 形式满足校验；它仅是合成测试地址，不需要对应邮箱账号，也不会向外部发送邮件。管理员、代理和 CRM 联系邮箱仍可使用 `example.invalid`。

邮件模板中的网页链接沿用后端开发公开来源 8093。浏览网页时使用前端端口 5175；本轮邮件验证码可通过辅助命令读取。正式邮件和统一公开来源的反向代理留到后续接入阶段。

## 依赖与磁盘策略

本轮使用已存在的 D 盘 Node.js 和 Python；npm 按根目录 `package-lock.json` 执行 `npm ci`，依赖写到项目 `node_modules`，缓存使用已配置的 `D:\ChatGPT\Caches\npm`。

Go Windows 压缩包校对官方 SHA256 后放入 `artifacts/local/tools/go/`；PostgreSQL 官方 Windows 包仅提取 `bin`、`lib`、`share`，放入 `artifacts/local/tools/pgsql/`。工具均不依赖全局安装。npm CLI 位于 `artifacts/local/tools/npm/package/bin/npm-cli.js`。

`scripts/local/env.ps1` 只给当前脚本进程和子进程设置 D 盘临时目录、Go 模块缓存和构建缓存，不修改 Windows 全局 TEMP/TMP、用户 PATH 或 Codex 运行时。

若删除了上述本地工具，需要先恢复兼容的 Go 1.26+、PostgreSQL 18、Node.js 22.18+（本轮 Node 24）与 npm。没有内置系统级安装器，也不会自动下载生产快照。

## 可重复验证

```powershell
./scripts/local/test.ps1
```

依次执行 lint、Node 测试、前端/Worker/邮件构建、公开源码扫描、Go vet 和真实 PostgreSQL 测试。Go 测试仅使用名称以 `_test` 结尾的专用本机库，每项集成测试新建随机 schema 与受限角色，并在结束后清理。

实际结果、浏览器操作、问题及未验证项见 `docs/LOCAL_ACCEPTANCE.md`。原开源复查报告属于此前发布的检查记录，本轮不以其中结果代替实测。
