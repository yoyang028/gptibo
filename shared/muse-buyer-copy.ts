import type { HanfolkBuyerCopy } from './hanfolk-buyer-copy.ts'
import { MUSE_ACCOUNT_GUIDE, MUSE_INVITE_GUIDE } from './muse-products.ts'

const section = (title: string, text: string) => '### ' + title + '\n' + text

/** Product-specific editorial profiles, verified against the supplier's guides. */
export function museBuyerCopy(id: 57 | 69, label: string): HanfolkBuyerCopy {
  if (id === 69) {
    const delivered = '面向已有 Muse 账号的一次性邀请助力服务。使用目标账号自己的 6 位邀请码，不需要账号密码或邮箱登录验证码；不是购买另一个账号。'
    const caution = '先在 Muse 确认账号可参加邀请活动，再核对邀请码归属。1 次邀请约奖励 1B（10 亿）词元，资格、奖励数额及能否到账按 Muse 当时规则与账户记录核对。'
    const warranty = '付款、任务完成与词元到账分别核对，不承诺固定完成时间或无限使用。邀请码提交后不保证可以更改；任务失败、部分完成或结果不明时，保留原订单和账户奖励记录联系售后，不要重复付款或重复提交。'
    return {
      name: 'Muse 词元服务 · 邀请助力',
      tagline: '已有账号使用 · 1 次邀请约 1B 词元',
      duration: '一次性邀请 · 约 1B（10 亿）',
      features: ['1 次邀请约 1B（10 亿）词元，奖励以账户记录为准', '适用已有账号，仅需本人 6 位邀请码', '一次性服务，不自动续费'],
      buyerHighlights: ['为已有 Muse 账号补充词元', '使用 6 位邀请码，无需提供密码', '1B = 10 亿词元；不是会员时长'],
      buyerWarnings: ['请先确认账号的活动资格', '本服务暂未开放下单，成品账号另行选择'],
      description: [
        section('这项服务适合谁', delivered),
        section('词元与规格', '当前为单次邀请服务，预计奖励约 1B。1B = 1 billion = 1,000,000,000（10 亿）词元。邀请次数不是会员时长，不保证所有账户都能获得相同奖励，也不等于固定数量的对话或任务。'),
        section('购买前先确认', caution),
        section('交付与使用', '本服务暂未开放下单。开放后，按本单确认的使用指引办理，具体交付方式在购买前明确说明；需要站外自助操作时，专用入口只在付款确认并交付后由原订单提供。无需到其他商店再次付费。'),
        section('教程与常见情况', '[Muse 邀请码与词元购买教程](' + MUSE_INVITE_GUIDE + ')。教程帮助你找到邀请码、核对活动条件、区分付款与任务进度，不代表当前已开售。'),
        section('售后与结果核对', warranty),
      ].join('\n\n'),
      purchaseNote: caution + '\n\n' + warranty,
      deliveryInstructions: '词元邀请服务准备中，暂不可购买。需要站外操作的入口将在付款确认并交付后随原订单提供；不会要求再次购买同一份服务。',
      steps: [
        { title: '确认自己的邀请码', description: '登录目标 Muse 账号，从邀请页面复制 6 位字母或数字代码。不要填邮箱验证码或他人的邀请码。' },
        { title: '核对服务与交付', description: '当前仅展示资料。开售后先核对邀请次数、预计奖励、售价和交付方式，再提交订单。' },
        { title: '在原订单跟进', description: '付款确认后按原订单指引处理；结果不明时继续核对原单，避免重复提交。' },
        { title: '回到 Muse 核对', description: '任务完成后查看目标账号的实际奖励记录；异常保留脱敏截图联系售后。' },
      ],
      faq: [
        { question: '和成品账号有什么区别？', answer: '成品账号交付一个独立账号及其所选额度；邀请服务使用你已有账号的邀请码，奖励取决于账号资格和活动规则。两类不能互相替代。' },
        { question: '1B 是多少？有没有自动续费？', answer: '1B 为 10 亿词元。当前邀请服务按一次性办理，不自动续费；词元有效期和消耗规则以 Muse 账号显示为准。' },
        { question: '需要把密码或登录验证码交给商家吗？', answer: '不需要。邀请码是 6 位字母或数字，用于邀请活动，不是登录凭据。不要提交密码、邮箱收件资料或登录验证码。' },
        { question: '现在可以购买吗？', answer: '目前可阅读资料和教程，暂未开放下单。开放后以本站确认的售价、服务范围和交付说明为准，不按其他网站的价格下单。' },
        { question: '付款了，为什么还看不到词元？', answer: warranty },
      ],
    }
  }
  const amount = Number(label.match(/(\d+)\s*亿/)?.[1])
  const units = amount > 0 ? `${amount / 10}B（${amount} 亿）` : label
  const delivered = '交付独立 Muse 成品账号与配套收件资料，买家自行前往 Muse 登录；不是给已有账号充值，也无需到第三方卡密站兑换。'
  const use = '在原订单保存交付原文，打开 [Muse 登录入口](https://muse.ai/) 输入交付邮箱，选择邮箱验证码登录。按随单收件入口获取最新验证码，再返回 Muse 完成验证。订单通知邮箱与你买到的账号邮箱不同；邮件密码与 Muse 密码也不可混用。'
  const conditions = '供货说明适用于美国、加拿大地区的 18 岁及以上用户。购买前确认所在地、年龄和网络满足 Muse 当前服务要求；能打开商店不代表一定能使用 Muse。词元消耗、平台功能及地区规则以 Muse 实际页面为准。'
  const warranty = '本规格仅保障首次登录：无法登录、收不到首次登录验证码或首次核对额度不符时，保留交付原文及脱敏截图，从原订单联系售后核查。成功首登后的封号、词元变动、再次登录失败及平台限制不在此项保障内；网络无法访问不属于账号故障。'
  return {
    name: 'Muse 成品账号 · ' + label,
    tagline: units + ' 词元 · 独立账号 · 可换绑邮箱',
    duration: units + ' · 有效期未注明',
    features: [units + ' 词元，以首次登录核对为准', '独立成品账号 + 收件资料，可更换邮箱', '一次性购买，首次登录保障'],
    buyerHighlights: ['交付账号与收件资料，凭码自行登录 Muse', '所选额度：' + units, '四档按额度区分，均可换绑邮箱'],
    buyerWarnings: ['适用美国、加拿大 18 岁及以上用户', '仅首登保障；词元不等于固定会员时长', '新邮箱验证并测试登录成功后，才能移除原邮箱'],
    description: [
      section('商品介绍', '面向需要独立 Muse 账号的买家，交付已注册、带有所选词元的成品账号。Muse 作为个人 AI 智能体可用于处理创作与日常任务，具体可用功能以账号当前界面为准。'),
      section('四档额度怎么选', '四档分别为 1B / 5B / 10B / 31B，对应 10 亿 / 50 亿 / 100 亿 / 310 亿词元；本次选择 ' + units + '。差别是随账号附带的额度，不代表不同订阅周期。全部规格保留展示，缺货时标为“补货中”，该档暂不可购买。'),
      section('额度与有效期', '1B = 10 亿词元。额度不是无限用量，也不能直接换算成可使用的天数、任务数或对话次数。供货资料未注明统一有效期，实际余额、消耗与到期规则须在首次登录后核对，不承诺永久有效。'),
      section('适用条件', conditions),
      section('交付与首次使用', delivered + '\n' + use),
      section('如何阅读交付原文', '常见形式为“邮箱---邮件密码---收件地址”，或增加 Muse 密码的一段；另一种是邮箱、Outlook 密码、Muse 密码和邮件识别资料，末尾跟邮件阅读网址。请保存原文，不要按冒号强拆固定段数。随单收件地址用于本人读取登录邮件，不要发给其他人。'),
      section('换绑自己的邮箱', '登录并核对额度后，进入设置 → 通用 → Meta 账户。先添加并验证新邮箱，再设为默认；保留当前会话，在另一窗口用新邮箱测试进入同一个账号，确认成功才删除旧邮箱。\n[查看邮箱更换完整图解 · 15 张步骤图 →](' + MUSE_ACCOUNT_GUIDE + ')'),
      section('售后范围', warranty),
    ].join('\n\n'),
    purchaseNote: conditions + '\n\n' + warranty,
    deliveryInstructions: delivered + '\n\n' + use,
    steps: [
      { title: '保存本单交付资料', description: '在原订单领取并保存登录邮箱、收件入口和原始交付文本；通知邮箱不能当作所购账号登录邮箱。' },
      { title: '自行登录 Muse', description: '打开 [Muse 登录入口](https://muse.ai/)，输入本单交付邮箱，选择验证码登录；不要选择自己的 Facebook / Instagram 账号。' },
      { title: '收验证码并核对额度', description: '到随单收件入口获取最新验证码，返回 Muse 完成登录。首次进入即核对 ' + units + ' 额度；有异常先联系售后。' },
      { title: '换绑并测试', description: '按 [15 步换绑图解](' + MUSE_ACCOUNT_GUIDE + ') 验证并设置新邮箱，用新窗口测试登录同一账号，成功后再删除原邮箱。' },
    ],
    faq: [
      { question: '收到什么？要去其他网站兑换吗？', answer: delivered + ' 官网登录验证不是 CDK 兑换；登录时的验证码从本单收件入口取得。' },
      { question: '1B、5B、10B、31B 差在哪里？', answer: '分别包含 10、50、100、310 亿词元，按首次登录核对。它们都是成品账号，差别在附带额度，不是月卡或年卡。' },
      { question: '邮件密码能直接登录 Muse 吗？', answer: '不能默认通用。优先使用交付邮箱的验证码登录；原文明列 Muse 密码时，那一段才是 Muse 的登录密码。收件资料只供你本人使用。' },
      { question: '能否把词元加到我已有的账号？', answer: '成品账号的额度随交付账号使用，不能当作现有账号充值码。已有账号可以查看同页“词元服务”，确认邀请活动资格后再考虑。' },
      { question: '为什么要先测试新邮箱再删除旧邮箱？', answer: '新邮箱通过验证、设为默认并不等于登录已验证成功。保留原会话，在另一窗口确认新邮箱进入相同账号后，再移除旧邮箱，可避免失去收码及登录入口。' },
      { question: '网站打不开或首次登录异常怎么办？', answer: warranty },
    ],
  }
}
