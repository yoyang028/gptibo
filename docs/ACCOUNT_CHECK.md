# 独立 ChatGPT 账号检测

入口为 `/check`，并保留 `/s/{slug}/check`、`/r/{code}/check` 的店铺上下文。ChatGPT 商品详情页顶部导航提供“账号检测”，无需创建或支付订单。

## 数据流与显示范围

1. 浏览器本地识别完整 Session JSON、输入邮箱及已知过期时间。识别成功不表示认证通过；不使用 Session 或 JWT 声明认定订阅与充值资格。
2. 用户明确勾选本次查询授权后，向同源 `POST /api/tools/account-check` 提交。服务端重新校验来源、类型、大小、授权与过期时间，并应用通用、昂贵操作及独立查询限流。
3. 服务端只向固定的 `https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27?timezone_offset_min=-480` 发出 GET，最多等待 12 秒，读取不超过 128 KB。仅发送本次 Token 和受约束的账号标识，不转发 Cookie、原始 Session 或其他自定义字段；禁止跳转与用户指定目标地址。
4. 只返回白名单化的套餐、订阅是否有效、渠道、账单地区、到期时间、自动续费状态及查询时间。没有明确返回的字段显示“未返回”。无法匹配请求账号、字段冲突或未知格式时显示“待确认”，不推断为免费账号。
5. 输入仅在页面与本次服务端请求内存中短暂使用，不落库、不记录原文、不写入浏览器存储。3 分钟自动清除输入；用户可手动清除，离开组件时中止请求并释放页面状态。检测不调用订单、付款或充值接口。

检测不读取聊天记录，不保证账号可新开、续费或升级，也不签发充值许可。真正的充值仍走原订单核验。官方网页账号接口不属于稳定的公开开发 API，可能受登录权限、访问保护、格式变动或限流影响；这些情况均展示实际失败或待确认状态，不能替代上游的充值资格接口。没有通过真实账号成功查询的验证，不应宣称生产账号检测成功率。

ChatGPT 与 API 账单独立；网页、Apple App Store 和 Google Play 的订阅应在对应渠道核对。官方说明：

- https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform
- https://help.openai.com/en/articles/7232927-canceling-your-chatgpt-subscription

## 验证

`tests/account-check.test.ts` 覆盖输入验证、授权、来源与限流、固定外发边界、账号匹配、白名单响应、过期、未知、失败及超限响应。使用合成凭据，不连接真实账号。

`npm run test:cloudflare:account-check` 只连接独立本地 `https://127.0.0.1:8781` 与 `http://127.0.0.1:8784`。浏览器调用真实 Worker，Worker 的网络出口被本地运行器替换为固定合成响应；检查免费、付费、工作区、过期、拒绝、限流、清除、离开页面、手机深色与自动清除。证据保存于 `artifacts/local/evidence/account-check`。本地验收不能证明真实 ChatGPT 账号的远程查询可用性。
