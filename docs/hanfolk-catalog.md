# 代理商品资料管理

后台入口：`/admin?view=hanfolk`。复用现有管理员登录与写请求来源检查。

- 大橘卖家 API 仅调用 `balance`、`products`、`product` 三个 GET 接口，固定源站与路径；密钥使用请求头传递，不放进 URL，不回显。
- API Key 使用现有服务端 AES-GCM 主密钥加密存入 D1。余额、上游成本、原始规格、输入要求仅在管理员接口返回。
- 分类支持 Grok、Google Gemini、Muse、多邻国、Adobe Express、Apple Music、Apple ID、Google Gmail、CapCut Pro。兼容源商品 `Duoingo` 拼写。其他商品不进入挑选目录。
- 导入生成确定的本地商品 ID 与源 SKU 对照。重复、并发导入不重复建商品，不覆盖已编辑内容、价格或状态。先校验整次选择，再写入资料；异常后可重复导入核对。
- 新规格为 `draft`、`pricePending=true`，采购成本不直接成为零售价。旧价格表要求正整数，因此未定价草稿使用内部占位值；编辑器、预览和管理列表显示“待定价”，公开目录排除该草稿。确认零售价后可转 `listed`，同一分类共用一个前台入口。
- 当前不实现该供应商的采购或支付。源商品支持自动发货不代表本站已经开售。服务端拒绝将导入商品转为 `published`；不能进入本站二级代理的默认供货价或新代理价格表。原 GPT、其他供应商及 SMS 流程独立保留。
- 原商品说明作为纯文字保存，不执行 HTML。详情按商品内容、规格、条件、领取说明、步骤和常见问题编排。未明确的质保、退款、设备数、续费规则须由店主核对；后台保留完整源介绍供编辑。
- Muse 使用现有原始矢量 Logo，七秒轻微浮动；无内部文字和框。离屏、后台标签页暂停，减少动画偏好下静止。

验证：`npm test`、`npm run build`、`npm run lint`。隔离的 workerd/D1 环境启动后运行 `npm run test:cloudflare:hanfolk-catalog`；浏览器仅使用 `hanfolk-fixture.mjs` 合成 GET 数据，真实采购和支付次数均为零。
