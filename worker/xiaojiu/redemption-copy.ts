// Private delivery instructions, checked against the public redemption UI on
// 2026-10-17. Never import this module into the storefront or public catalog.
export function xiaojiuRedemptionGuide(kind: 'claude' | 'codex') {
  const accountStep = kind === 'claude'
    ? '按页面中的 Claude 教程准备本人账号的 sessionKey（不是 API Key），核对识别的账号、订阅档位与资格，再提交充值。账号须可正常登录并完成 KYC；刚注册或刚完成认证、已有订阅及 iOS 订阅账号请先联系客服。'
    : '在同一浏览器登录目标 ChatGPT 账号，按 Codex 教程准备完整 Session JSON。核对登录状态、购买的额度档位，以及个人账号 / Team 工作区的额度去向，确认权限与目标无误后再提交。Free 账号不适用，不支持改账单地区。'
  return [
    '[打开本单兑换入口](https://982xj.xyz/)',
    '### 1. 验证兑换码\n复制本订单交付的完整兑换码，在兑换页面粘贴后点击“兑换卡密”。页面会自动识别商品，请先核对显示的规格与订单一致。',
    '### 2. 核对账号并充值\n' + accountStep,
    '### 3. 查询进度与验收\n在兑换页面使用“查充值状态”跟进原单。完成后回到目标账号检查订阅或额度记录；仍在处理或结果不明确时不要重复提交，也不要重新下单。',
    '### 遇到异常\n保留本站订单号、兑换页面的错误提示和脱敏截图，联系本站客服。Session / sessionKey 属于登录凭据，只在对应兑换表单中按教程自行操作，不要发送给客服、填入订单备注或公开分享。',
  ].join('\n\n')
}
