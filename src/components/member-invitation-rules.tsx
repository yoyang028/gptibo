import type { Ref } from 'react'

const steps = [
  ['分享你的邀请链接', '验证邮箱即可参与，无需先购买。'],
  ['好友完成首次充值', '通过链接下单，真实付款并充值成功。'],
  ['24 小时后奖励可用', '观察期内无异常，10 元奖励自动生效。'],
] as const

const rules = [
  {
    title: '谁可以参加，什么算新客？',
    content: <><p>邀请人需注册会员并验证邮箱，无需先购买商品。受邀好友无需注册会员，可通过专属链接直接购买。</p><p>新客指<strong>此前没有本店有效实付购买记录</strong>的好友，资格由系统结合购买记录及订单核验结果判断。注册过会员但尚未购买，仍可参与；已有本店有效实付购买记录的用户不再计入首次邀新。活动仅适用于本店 ChatGPT 商品的四个规格，其他商品及其他店铺不参与。</p></>,
  },
  {
    title: '怎样把邀请算到我的账户？',
    content: <p>好友需通过你的专属邀请链接进入商店并创建订单。邀请归属在订单创建时确定，创建后更换链接不会改变该订单的邀请人。<strong>默认链接、自定义链接及兼容的旧链接均归属同一会员账户</strong>；自定义地址不会清除已有邀请记录。</p>,
  },
  {
    title: '好友的 5 元优惠怎么用？',
    content: <p>符合资格的好友首单可自选减 5 元。<strong>新人优惠、普通优惠码、邀请奖励抵扣三者选择一种</strong>，不能同时使用。多张邀请奖励之间可以完全叠加。好友不选择新人 5 元优惠，只要满足真实实付及充值成功等条件，仍可为邀请人带来奖励。</p>,
  },
  {
    title: '我的 10 元奖励什么时候到账？',
    content: <><p>好友首次真实现金付款且充值成功后，你获得 10 元待生效奖励。从成功充值起经过<strong>24 小时观察期</strong>，无异常后自动生效。同一新客只计一次有效邀请；未付款、零元兑换、测试或未成功充值的订单不触发邀请奖励。</p><p>观察期内发生退款、取消或交付失败等异常，待生效奖励撤销。奖励生效后的普通退款不自动追扣；确认异常时，按实际使用情况撤销未用奖励或冻结权益，历史记录保留。</p></>,
  },
  {
    title: '奖励能叠加吗，用不完怎么办？',
    content: <p>多笔已生效邀请奖励可累积、部分抵扣、跨笔完全叠加，也可抵至订单应付为 0 元。<strong>超出订单金额的余额保留</strong>，例如 140 元抵扣 138 元后剩余 2 元；不会因一次使用而把整笔奖励清空。奖励仅限本人账户在本店抵扣，使用时优先消耗较早到期的奖励。全额抵扣订单的审核与处理方式见下方说明。</p>,
  },
  {
    title: '两个月有效期从什么时候算？',
    content: <p>每笔奖励从应生效时刻起计算<strong>两个自然月</strong>，到期时间以会员中心展示为准，不按固定 60 天计算。取消订单释放或退款恢复的额度沿用原奖励有效期，不重新计时；原有效期已结束的额度不能再次使用。</p>,
  },
  {
    title: '哪些订单需要审核或等待处理？',
    content: <><p>单笔优惠 31～99 元会加强核查；优惠达到 100 元、全额抵扣（0 元订单）或出现异常时，需人工审核。重复占用奖励、大量未付款订单、疑似自邀或重复充值目标等情况也可能转入核查。</p><p><strong>订单应付低于采购价或为 0 元时，仍完整保留优惠并锁定额度，但暂不发起自动付款或充值</strong>，需等待上游采购方案确认；审核通过也不代表已付款、已采购或已交付。结算时会提示对应处理状态。</p></>,
  },
  {
    title: '取消或退款后，奖励怎么恢复？',
    content: <><p>未完成订单占用的奖励暂不可用于其他订单。未提交上游付款的订单取消后释放额度；已建立上游付款入口的，需确认上游关闭或过期后释放，避免仍可付款时重复使用同一额度。</p><p>已使用奖励的订单，确认全额现金退款后恢复原抵扣额度；部分退款按累计现金退款比例恢复至分，全额退款时补齐。恢复不延长原有效期，会员中心可查看占用、核销及恢复流水。</p></>,
  },
]

export function InvitationRules({ detailsRef }: { detailsRef?: Ref<HTMLDetailsElement> }) {
  return <section id="member-invitation-rules" className="member-card member-rules" aria-labelledby="member-rules-heading">
    <div className="member-rules-heading"><div><span className="member-section-kicker">参与说明</span><h2 id="member-rules-heading">奖励这样拿</h2></div><span>验证邮箱即可邀请，无需先购买</span></div>
    <ol className="member-invitation-steps">{steps.map(([title, text], i) => <li key={title}><span className="member-step-number">0{i + 1}</span><div><h3>{title}</h3><p>{text}</p></div></li>)}</ol>
    <div className="member-reward-example"><p><strong>140 元奖励抵扣 138 元订单，剩余 2 元继续留着用。</strong></p><p>每笔奖励有效期两个月，仅限本人账户使用。全额抵扣需审核及等待处理。</p></div>
    <p className="member-rules-eligibility"><strong>新客条件：</strong>此前没有本店有效实付购买记录。好友无需注册会员；活动限本店 ChatGPT 四个规格。</p>
    <details ref={detailsRef} className="member-rules-details"><summary><span>完整活动规则与使用说明</span><span className="member-rules-expand" aria-hidden="true">展开规则</span><span className="member-rules-collapse" aria-hidden="true">收起规则</span></summary>
      <div className="member-full-rules">{rules.map(({ title, content }, i) => <section key={title} className="member-rule"><h3><span>0{i + 1} / </span>{title}</h3>{content}</section>)}</div>
    </details>
  </section>
}
