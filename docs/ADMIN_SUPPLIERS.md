# 主后台商品管理

左侧只有一个「商品管理」入口，不设二级侧栏；页面内部使用横向服务商分类：Bugan、Xiaojiu、Grizzly、Daju。人工交付和其他来源留在「自营及其他」。商品总览可以搜索全部商品并筛选状态，编辑仍使用原商品、规格和版本校验。

- Bugan：当前 Recharge / ChatGPT 上游的管理名称；按服务端 `RECHARGE_PRODUCT_MAP` 识别套餐，显示当前接入域名与销售状态，可主动只读检查授权、目录及成本。
- Xiaojiu：依据商品保存的 `api.provider=xiaojiu` 分类，独立管理商品和上游目录。新规格可在服务端复用所选商品的加密采购凭据，仍须重新验证新商品，凭据不进入公开 JSON。
- Grizzly：保留原接码配置、三个项目、双号码池和订单资金核对。
- Daju：通过 `hanfolk_product_links` 识别导入来源，人工交付商品也能正确归类。默认展示已整理商品，按九类分组；上游目录折叠显示，API 配置单独放置。

新入口为 `/admin?view=products`，可带 `supplier=bugan|xiaojiu|grizzly|daju|other`。原 `view=sms`、`view=hanfolk`、`view=plans` 自动转入对应分类，刷新和浏览器后退保留位置。「我的店铺」中的商品发布入口统一转到商品管理。

库存总览的 `GET /api/admin/suppliers` 只查询本地数据库，不联系上游。接入检查和目录读取必须由管理员主动触发；迁移 `0056_catalog_deletions.sql` 记录删除标识；无历史引用的无效和旧重复商品从商品表、规格映射、套餐与配置中实际删除。订单或 CRM 引用的套餐只保留禁售的历史关联行，管理列表、价格选择和展示设置均不再返回它们。完整同步成功后才清理；上游请求失败或配置并发变化时不删除。导入拒绝无货规格，商品恢复库存后可重新导入。

验证：`npm test`、`npm run build`、`npm run lint`、`npm run security:scan`。启动现有 grizzly 本机模拟运行时后，执行 `npm run test:cloudflare:suppliers` 验证实际 workerd/D1、商品编辑、目录选品、旧链接和手机布局。脚本固定连接本机地址，截图与结果写入 Git 忽略的 `artifacts/local/evidence/supplier-management/`。
