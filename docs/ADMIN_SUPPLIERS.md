# 主后台商品管理

商品入口统一为「商品管理」，左侧子菜单按上游服务商划分：bugan、小久（xiaojiu）、灰熊、大橘；人工交付和其他来源留在「自营及其他」。商品总览可以搜索全部商品并筛选状态，编辑仍使用原商品、规格和版本校验。

- bugan：当前 Recharge / ChatGPT 上游的管理名称；按服务端 `RECHARGE_PRODUCT_MAP` 识别套餐，显示当前接入域名与销售状态，可主动只读检查授权、目录及成本。
- 小久：依据商品保存的 `api.provider=xiaojiu` 分类，独立管理商品和上游目录。新规格可在服务端复用所选商品的加密采购凭据，仍须重新验证新商品，凭据不进入公开 JSON。
- 灰熊：保留原接码配置、三个项目、双号码池和订单资金核对。
- 大橘：通过 `hanfolk_product_links` 识别导入来源，人工交付商品也能正确归类。默认展示已整理商品，按九类分组；上游目录折叠显示，API 配置单独放置。

新入口为 `/admin?view=products`，可带 `supplier=bugan|xiaojiu|grizzly|hanfolk|other`。原 `view=sms`、`view=hanfolk`、`view=plans` 自动转入对应分类，刷新和浏览器后退保留位置。「我的店铺」中的商品发布入口统一转到商品管理。

库存总览的 `GET /api/admin/suppliers` 只查询本地数据库，不联系上游。接入检查和目录读取必须由管理员主动触发；本次整理不需要数据库迁移。

验证：`npm test`、`npm run build`、`npm run lint`、`npm run security:scan`。启动现有 grizzly 本机模拟运行时后，执行 `npm run test:cloudflare:suppliers` 验证实际 workerd/D1、商品编辑、目录选品、旧链接和手机布局。脚本固定连接本机地址，截图与结果写入 Git 忽略的 `artifacts/local/evidence/supplier-management/`。
