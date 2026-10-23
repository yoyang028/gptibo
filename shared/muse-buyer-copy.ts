import type { HanfolkBuyerCopy } from './hanfolk-buyer-copy.ts'
import { MUSE_ACCOUNT_GUIDE, MUSE_INVITE_GUIDE } from './muse-products.ts'

const section = (title: string, text: string) => '### ' + title + '\n' + text

export function museInvitationCopy(amount: 1 | 5 | 10 | 30): HanfolkBuyerCopy {
  const units = `${amount}B（${amount * 10} 亿）`
  const conditions = '先在 Muse 确认账号可参加邀请活动。邀请码不是登录验证码，提交前核对归属与所选数量；开始处理后不保证能更改。奖励范围、消耗及有效期以 Muse 当前规则和账号显示为准。'
  const warranty = '付款确认、邀请完成、词元到账是不同环节。任务失败、部分完成或奖励不符时，保留原订单与脱敏奖励记录联系售后，按实际完成情况核对处理；结果不明时不要重复付款或提交，不承诺固定到账时间。'
  return {
    name: `Muse 词元服务 · ${amount}B 词元`,
    tagline: '已有账号使用 · 邀请助力 · 无需提供密码',
    duration: units + ' · 邀请助力',
    features: [`预计 ${units} 词元奖励`, '使用本人 6 位邀请码，无需密码', '一次性服务，不自动续费'],
    buyerHighlights: ['为已有 Muse 账号补充词元', '使用本人 6 位邀请码，无需密码'],
    buyerWarnings: ['先确认账号符合邀请活动条件', '实际奖励以 Muse 账户记录为准'],
    description: [
      section('适合已有 Muse 账号', '通过邀请活动为自己的账号获取词元。使用目标账号的 6 位邀请码，不交付另一个账号，也不需要提供密码或邮箱登录验证码。'),
      section('四档词元，按需选择', `1B / 5B / 10B / 30B，分别对应约 10 / 50 / 100 / 300 亿词元。本次选择 ${units}；按每次邀请约 1B 估算，实际奖励取决于 Muse 活动规则与账号资格。词元是用量额度，不是会员时长。`),
      section('办理与使用', '先确认邀请码来自要接收奖励的账号，再按原订单指引办理。若需站外自助操作，专用入口随付款确认后的交付资料提供，无需再次购买同一份服务。\n[Muse 邀请码与词元购买教程](' + MUSE_INVITE_GUIDE + ')'),
    ].join('\n\n'),
    purchaseNote: conditions + '\n\n' + warranty,
    deliveryInstructions: '一次性邀请助力，使用本人 6 位邀请码。办理资料在原订单查看；需要站外操作时，入口随付款确认后的交付资料提供。',
    steps: [
      { title: '复制自己的邀请码', description: '登录目标 Muse 账号，确认活动资格，复制本人 6 位字母或数字邀请码。' },
      { title: '选词元数量', description: '核对规格、金额与邀请码归属；填写或提交位置以本单指引为准。' },
      { title: '跟进原订单', description: '付款确认后按本单资料办理并查看进度；等待期间保留同一订单。' },
      { title: '核对实际奖励', description: '回到 Muse 查看奖励记录。任务或奖励异常，保留截图从原订单联系售后。' },
    ],
    faq: [
      { question: '在哪里找自己的邀请码？', answer: '登录要接收词元的 Muse 账号，在邀请页面复制 6 位代码。入口随版本变化，可参考 [邀请码教程](' + MUSE_INVITE_GUIDE + ')。不要填写收到的登录验证码。' },
      { question: '邀请完成后，为什么余额没有立即增加？', answer: '邀请执行与平台发放奖励可能不同步。先核对目标账号、实际奖励记录与原订单进度，再提交订单号和脱敏截图联系售后；不要重复提交来补做。' },
      { question: '能保证固定的使用天数或对话次数吗？', answer: '不能。不同任务消耗不同，邀请奖励也受账号资格与活动规则影响，不能按词元数量换算固定使用天数。' },
    ],
  }
}

/** Buyer copy is separate from procurement readiness, which belongs in admin/checkout. */
export function museBuyerCopy(id: 57 | 69, label: string): HanfolkBuyerCopy {
  if (id === 69) return museInvitationCopy(1)
  const amount = Number(label.match(/(\d+)\s*亿/)?.[1])
  const units = amount > 0 ? `${amount / 10}B（${amount} 亿）` : label
  const conditions = '供货说明适用于美国、加拿大地区的 18 岁及以上用户。购买前确认所在地、年龄及网络符合 Muse 服务要求。成品账号不是为已有账号充值，词元不等于固定会员时长。'
  const warranty = '仅保障首次登录。首次无法登录、收不到验证码或初始额度不符，请保存交付原文与脱敏截图，从原订单联系售后。成功首登后的封号、词元变化、再次登录异常及平台限制不在此保障内；网络访问问题不属于账号故障。'
  return {
    name: 'Muse 成品账号 · ' + label,
    tagline: '独立账号 · 自行登录 · 可换绑邮箱',
    duration: units + '词元',
    features: [units + '词元', '独立成品账号 + 收件资料', '可换绑邮箱，首次登录保障'],
    buyerHighlights: ['交付独立账号与收件资料，凭码自行登录 Muse', '四档按词元额度区分，均可换绑邮箱'],
    buyerWarnings: ['适用美国、加拿大 18 岁及以上用户', '仅保障首次登录，词元不代表会员时长'],
    description: [
      section('你会收到什么', '独立 Muse 成品账号与配套收件资料，包含本次选择的 ' + units + '词元。买家自行前往 [Muse 登录入口](https://muse.ai/) 使用交付邮箱收码登录，无需到第三方兑换站激活。'),
      section('额度与使用期限', '10 / 50 / 100 / 310 亿词元，对应 1B / 5B / 10B / 31B。四档交付方式相同，区别在附带额度。1B = 10 亿词元；余额、消耗及有效期以账号实际显示为准，不能换算固定天数或任务次数。'),
      section('换绑自己的邮箱', '首次登录并核对额度后，可添加自己的邮箱。先验证、设为默认，再用新窗口测试进入同一账号，成功后才移除旧邮箱。\n[查看邮箱更换完整图解 · 15 张步骤图](' + MUSE_ACCOUNT_GUIDE + ')'),
    ].join('\n\n'),
    purchaseNote: conditions + '\n\n' + warranty,
    deliveryInstructions: '交付独立 Muse 成品账号与收件资料。使用交付邮箱在 Muse 收码登录，无需第三方兑换；首次登录请先核对所选额度。',
    steps: [
      { title: '领取账号资料', description: '付款确认后，在原订单保存登录邮箱、收件入口及原始交付文本。' },
      { title: '自行登录 Muse', description: '打开 [Muse 登录入口](https://muse.ai/)，输入交付邮箱，选择邮箱验证码登录。' },
      { title: '收码并核对额度', description: '在随单收件入口取得最新验证码，登录后核对 ' + units + '词元；有异常先联系售后。' },
      { title: '换绑自己的邮箱', description: '参考 [15 步邮箱更换图解](' + MUSE_ACCOUNT_GUIDE + ')，验证、设为默认并测试新邮箱，成功后再删除原邮箱。' },
    ],
    faq: [
      { question: '应该用哪个邮箱登录？', answer: '使用交付资料中的账号邮箱。订单通知邮箱只接收订单消息，不是购买的 Muse 账号。不要选择自己原有的 Facebook 或 Instagram 账号进入。' },
      { question: '邮件密码可以当 Muse 密码用吗？', answer: '不能默认通用。优先用交付邮箱的验证码登录；只有原文明确标注的 Muse 密码才是登录密码。交付格式与收件方法见 [账号使用图解](' + MUSE_ACCOUNT_GUIDE + ')。' },
      { question: '验证码过期或没收到怎么办？', answer: '先确认使用的是本单账号邮箱与收件入口，检查最新邮件，重新发送后用最新验证码。首次仍无法登录，保存脱敏截图联系售后，不要删除原交付资料。' },
    ],
  }
}
