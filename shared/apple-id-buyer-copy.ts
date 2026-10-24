import type { HanfolkBuyerCopy } from './hanfolk-buyer-copy.ts'
import { APPLE_ID_GUIDE } from './storefront-guides.ts'

export const APPLE_ID_SOURCES = { 15: '美国', 16: '美国', 50: '香港', 14: '日本', 4: '土耳其', 5: '尼日利亚' } as const
const section = (title: string, text: string) => '### ' + title + '\n' + text

export function appleIdBuyerCopy(id: keyof typeof APPLE_ID_SOURCES, label: string): HanfolkBuyerCopy {
  const region = APPLE_ID_SOURCES[id], purchased = id === 16
  const kind = purchased ? 'Shadowrocket 已购' : label.includes('老号') ? '老号' : '新号'
  const materials = purchased ? '账号及随单安全资料' : '账号、密码、密保答案与生日'
  const conditions = '仅用于所选地区 App Store；保留设备原有 iCloud 主账户，不用于 iCloud 或“查找”。下单前确认目标 App 在该地区上架、是否收费。质保期内保留原登录邮箱，不共享账号或使用工具批量改资料。'
  const warranty = '提供 3 天账号质量保障，期内非使用方原因导致的账号问题，经原订单核对后换新。误登 iCloud、共享或二次转售、批量处理、擅自改登录邮箱，以及自身网络或频繁切换地区/设备导致的异常，不在该保障范围。买错地区、App 本身收费或应用内服务问题不属于账号质量问题；售后请提供原订单与脱敏错误提示。'
  return {
    name: region + ' Apple ID · ' + (purchased ? '已购 Shadowrocket' : label),
    tagline: region + '区独享账号 · ' + (purchased ? '含 Shadowrocket 已购记录' : kind + ' · 带密保可改密'),
    duration: '独享账号 · ' + kind,
    features: [purchased ? '美国区账号，含 Shadowrocket 已购记录' : region + '区 App Store 独享账号', materials, '3 天账号质量保障；仅用于 App Store'],
    buyerHighlights: [region + '区 · ' + kind, materials, '账号资料交付，无需卡密兑换'],
    buyerWarnings: ['请勿登录 iCloud 或“查找”', '3 天质保期内请勿更换登录邮箱'],
    description: [
      section('账号用途与交付', '交付用于' + region + '区 App Store 的独享成品账号与随单资料，买家自行登录使用，无需前往卡密兑换站。账号费用不包含另外购买 App、充值余额或开通订阅的费用。'),
      section('本规格包含什么', purchased
        ? '这档账号含 Shadowrocket 已购记录，供你在对应账号下下载该 App。普通新号、老号不包含这项已购权益；已购 App 也不等于拥有应用内服务、流量或订阅。'
        : '本次选择：' + label + '。新号、老号按登记的账号注册/养号时间区分，这些时间不是会员时长，也不代表更多已购应用。除规格明确写明的内容外，不包含其他付费软件权益。'),
      section('首次使用怎么做', '先保存原单资料，前往 [Apple 账户管理](https://account.apple.com/) 核对登录并修改密码。再在设备的“媒体与购买项目”中登录商店账号，打开 App Store 下载；不要退出整个 iCloud 主账户。\n[查看 Apple ID 完整使用图文教程](' + APPLE_ID_GUIDE + ')'),
    ].join('\n\n'),
    purchaseNote: conditions + '\n\n' + warranty,
    deliveryInstructions: '原订单交付' + materials + '。自行核对、改密，再登录“媒体与购买项目”使用 App Store；不需要第三方卡密兑换。',
    steps: [
      { title: '保存账号资料', description: '在原订单领取账号和安全资料，核对地区、所选类型；密保答案按朋友/工作/父母对应类别使用。' },
      { title: '核对并修改密码', description: '在 [Apple 账户管理](https://account.apple.com/) 登录本单账号，按实际验证方式修改密码。质保期内保留原登录邮箱。' },
      { title: '只切换商店账号', description: '设置 → 自己的姓名 → 媒体与购买项目，按提示使用其他账号登录。只退出该菜单里的商店账号，保留原 iCloud。' },
      { title: '下载与核对', description: purchased ? '在对应账号下核对 Shadowrocket 已购记录并下载。应用内服务和订阅不在本商品交付范围。' : '在对应地区 App Store 搜索目标 App；付费或订阅项目需另外购买。遇到验证问题可查 [图文教程](' + APPLE_ID_GUIDE + ')。' },
    ],
    faq: [
      { question: '为什么更新旧 App 还要原来的账号？', answer: '原 App 的下载/购买记录属于当时使用的账号。可用原账号更新；如需改用新账号，先确认应用仍可下载、付费权益和数据备份，再考虑重新安装。删除 App 不能解除账号停用。' },
      { question: '新号和老号都能免费下载所有 App 吗？', answer: '不能。账号年限不代表已购权益；免费 App 可按商店规则获取，付费 App 和订阅需另行购买。只有明确标注的 Shadowrocket 已购规格包含该应用的已购记录。' },
      { question: '可以更换密码和登录邮箱吗？', answer: '可按随单安全资料在 Apple 官方页面修改密码。为保留本单售后，3 天质保期内不要更换登录邮箱；确需改邮箱时先核对售后影响，再按教程的可选章节操作。' },
      { question: '密码正确但无法登录，或者账号被停用了怎么办？', answer: '先核对登录位置、大小写和空格，区分网络问题与账号错误。被锁定、非活跃或媒体购买账户停用时，按 [账号使用与恢复教程](' + APPLE_ID_GUIDE + ') 进入相应 Apple 官方入口；恢复结果由 Apple 决定，原单售后另行核对。' },
    ],
  }
}
