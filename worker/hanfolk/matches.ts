import type { ShopProduct } from '../../shared/shop-products.ts'
import type { Env } from '../platform.ts'
import { emailCheckoutEnabled } from '../email-delivery.ts'
import { gmailCheckoutEnabled } from '../account_supplier/service.ts'

/** Keep original IDs/prices/flows. Similar suppliers are separate options. */
export async function withExistingFamilyOffers(
  env: Env,
  products: ShopProduct[],
) {
  const result = [...products],
    families = new Set(products.map((p) => p.groupId))
  if (
    !['gemini', 'duolingo', 'gmail'].some((id) =>
      families.has(id as 'gemini' | 'duolingo' | 'gmail'),
    )
  )
    return products
  const plans = (
    await env.INTEREST_DB.prepare(
      "SELECT id,product_id,name,enabled,price_cents,purchase_note,delivery_instructions FROM catalog_plans WHERE id IN ('gemini-pro-18m','duolingo-12m','gmail-account')",
    ).all<{
      id: string
      product_id: 'gemini' | 'duolingo' | 'gmail'
      name: string
      enabled: number
      price_cents: number
      purchase_note: string
      delivery_instructions: string
    }>()
  ).results
  for (const p of plans) {
    if (!families.has(p.product_id)) continue
    const gmail = p.product_id === 'gmail',
      gemini = p.product_id === 'gemini'
    const name = gmail
      ? 'Gmail · 美国白号 · 带 2FA（原规格）'
      : gemini
        ? 'Gemini Pro · 18 个月激活链接（原规格）'
        : '多邻国 · 1 年会员 CDK（原规格）'
    const delivery = gmail
      ? '交付账号、密码与对应验证资料，无需 CDK 兑换。'
      : gemini
        ? '交付会员激活链接，不含 Google 账号；需买家在站外领取。'
        : '交付兑换 CDK，需要按原订单确认的站外地址自行兑换。'
    const use = gmail
      ? '使用 [Google 登录入口](https://accounts.google.com/) 登录账号；这是登录入口，不是 CDK 兑换站。'
      : gemini
        ? '使用符合条件的账号打开原订单中的专属激活链接，核对账号后领取。链接具有专属性，不在商品页公开一个通用替代地址。'
        : '专用 CDK 兑换地址和完整教程尚待核实。不能把另一个来源商品的兑换站默认套用到此原规格；目前不可购买。'
    const duration = gmail ? '1 个美国账号' : gemini ? '18 个月' : '1 年'
    result.push({
      id: p.id,
      groupId: p.product_id,
      name,
      category: gmail ? '邮箱账号' : gemini ? 'AI 订阅' : '语言学习',
      tagline: delivery,
      description:
        '### 商品介绍\n' +
        name +
        '。按本规格写明的账号类型、服务周期和交付资料选择。\n\n### 规格区别\n' +
        (gmail
          ? '本规格为带 2FA 的美国白号，不同于按注册年份与渠道出售的账号。'
          : gemini
            ? '原规格为会员激活链接；不等同于成品账号，也不自动继承另一个渠道的空间或账号条件。'
            : '原规格为一年会员兑换 CDK；与新的供货规格分别核对适用账号和兑换条件。') +
        '\n\n### 交付与使用\n' +
        delivery +
        '\n' +
        use,
      image: '',
      badge: '原有规格',
      unit: gmail ? '个' : '份',
      duration,
      priceCents: p.price_cents,
      stock: -1,
      features: [duration, delivery],
      buyerHighlights: [delivery, '请按本规格核对权益、使用条件和售后范围'],
      buyerWarnings: [
        gmail
          ? '账号资料与质保按本规格说明核对；不含 Google 付费订阅'
          : gemini
            ? '先核对账号资格；专属激活链接按原订单提供'
            : '购买前需确认 CDK 兑换站与账号资格',
      ],
      purchaseNote: p.purchase_note,
      deliveryInstructions:
        p.delivery_instructions.replaceAll('\\n', '\n') + '\n\n' + use,
      steps: [
        { title: '购买前确认', description: p.purchase_note },
        { title: '查看原订单', description: delivery },
        {
          title: gemini
            ? '打开专属链接'
            : gmail
              ? '登录与核对'
              : '核对兑换指引',
          description: use,
        },
      ],
      faq: [
        {
          question: '交付什么，需要到其他网站操作吗？',
          answer: delivery + ' ' + use,
        },
        {
          question: '其他规格的权益和售后可以通用吗？',
          answer:
            '不能通用。请分别核对账号类型、周期、交付方式与购买须知；相近名称不代表相同权益，不能用另一规格推定本商品的保障。',
        },
      ],
      fields: [],
      delivery: 'manual',
      payment: { label: '', instructions: '', url: '', qr: '' },
      status:
        p.enabled &&
        (gmail ? gmailCheckoutEnabled(env) : emailCheckoutEnabled(env))
          ? 'published'
          : 'listed',
      version: 0,
    })
  }
  return result
}
