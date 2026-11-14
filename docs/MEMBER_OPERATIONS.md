# ScholAI 会员运营增量开发

业务规则以 `MEMBER_INVITATIONS.md` 为准。继续使用同一个 Worker、D1、Resend 和每分钟定时任务；不部署参考项目的服务，不复制 GPL 代码。后台入口：原管理后台 → 会员与邀新 → 运营中心。

## 源码及官方文档核对（2026-11-14）

| 项目／固定源码版本 | 已阅读依据 | 采用的设计及本店差异 |
| --- | --- | --- |
| Dujiao-Next `f85bb4eb571b0a54214825ab5a91268f1c0d05f8`（GPL-3.0） | [对账执行](https://github.com/dujiao-next/dujiao-next/blob/f85bb4eb571b0a54214825ab5a91268f1c0d05f8/internal/modules/reconciliation/application/execute.go)、[通知去重](https://github.com/dujiao-next/dujiao-next/blob/f85bb4eb571b0a54214825ab5a91268f1c0d05f8/internal/modules/notification/application/dedupe.go)、[官方文档](https://dujiao-next.com/) | 分别比较状态和金额，查询错误与差异分开记录；本店还比较交付与退款，正常锁券单单列。以 D1 唯一约束代替 Redis 去重。 |
| OfferKit `5238376740339815aedec2d5824b5fd223af384f`（MIT） | [核销事务](https://github.com/offerkit/offerkit/blob/5238376740339815aedec2d5824b5fd223af384f/packages/core/src/redemption/redeem.ts)、[幂等中间件](https://github.com/offerkit/offerkit/blob/5238376740339815aedec2d5824b5fd223af384f/apps/web/src/server/middleware/idempotency.ts)、[官方结算文档](https://github.com/offerkit/offerkit/blob/5238376740339815aedec2d5824b5fd223af384f/apps/site/content/docs/integrate/checkout.mdx)、[官方恢复文档](https://github.com/offerkit/offerkit/blob/5238376740339815aedec2d5824b5fd223af384f/apps/site/content/docs/reference/retries-and-recovery.mdx) | 稳定原单编号、请求指纹、原子核销、预演与提交分离；参考文档指出不同业务的幂等保证不同，不将“存在 eventId”误当作防重。本店保留自己的唯一约束及退款恢复规则。 |
| PointBay `57c032945e400e3094a8a6142357000778d8dd65`（readme 声明 GPLv2+） | [LedgerService](https://github.com/wpanchorbay/pointbay-free/blob/57c032945e400e3094a8a6142357000778d8dd65/app/Services/LedgerService.php)、[作者维护的说明与生命周期规则](https://github.com/wpanchorbay/pointbay-free/blob/57c032945e400e3094a8a6142357000778d8dd65/readme.txt) | 借鉴账本与缓存余额分离、来源记录及退款生命周期核查；不采用其“普通退款自动追回邀请奖励”规则，不允许负余额。其外部文档站本次读取失败，以仓库官方说明为依据。 |
| Referral as a Service `152eaaaef13f5612604a393836d0698cd4bc9981`（MIT） | [邀请服务与按邀请人查询](https://github.com/gihanrcg/referral-as-a-service/blob/152eaaaef13f5612604a393836d0698cd4bc9981/src/modules/referrals/referrals.service.ts)、[官方使用文档](https://github.com/gihanrcg/referral-as-a-service/blob/152eaaaef13f5612604a393836d0698cd4bc9981/docs/USAGE.md) | 按邀请者与活动隔离聚合、区分邀请来源与转化状态；本店维持单层稳定邀请码，不引入推荐树、API key、Redis 或多级返佣。 |

## 阶段 1：异常订单对账

0063 迁移新增对账快照和只追加的运营处理记录。覆盖通用店四种真实 ChatGPT 规格，包括会员活动和原游客订单。比较支付状态、现金应付、采购金额、累计退款、交付结果及原上游身份。零元单始终读取活动 `cash_cents`，不误用旧订单表的原价兼容字段。

每五分钟从最久未核对的订单中取最多 10 笔，两个并发、单笔租约防重；大批量逐轮推进，不在一个请求内扫描全库。查询失败保留失败分类供重试；等待审核、等待补差、尚未提交和提交结果未知分别展示。没有上游编号时不创建新采购来找回结果。

后台可复核指定订单、查看差异及处理历史、保存说明、同步原上游状态。说明不关闭差异；复核一致才显示一致。同步沿用既有 GET 查询与验签状态机，不直接修改订单金额或奖励，不调用创建采购、扣款或退款接口。金额或身份不符时拒绝同步；锁券待补差单继续等待。历史表的 UPDATE/DELETE 由数据库拒绝。

生产发布沿用当前域名、设置、密钥及库存映射。每阶段发布前核对当前 Worker 版本，备份 D1；迁移后保留原有保护代码。运行记录和真实数据库备份只存在 Git 忽略目录。
