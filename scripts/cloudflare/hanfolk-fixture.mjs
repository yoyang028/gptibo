// Synthetic GET-only fixture. No request can be forwarded to the supplier.
export const hanfolkFixtureKey = 'daju_' + 'a'.repeat(32)
export const hanfolkFixtureProducts = [
  ['SuperGrok CDK（iOS全区充值）', '全区通用的订阅兑换码。'],
  ['Google AI Pro18个月兑换链接', '自己账号开通，无需绑卡。'],
  ['Muse成品账户', '10亿或50亿词元可选，附收件入口，可改邮箱。'],
  ['Super Duoingo 12个月会员兑换', '为自己账号开通，不可叠加已有订阅。'],
  ['Adobe Express 12个月兑换', '新老账号均可，无需绑卡。'],
  ['Apple Music 5个月兑换', '仅限印度区新号，需自备 UPI 或银行卡。'],
  ['美国Apple ID | 带密保可改密', '独享账号，带密保可改密。'],
  ['Google Gmail 账户', '附密码与验证资料，不含 Google 付费订阅。'],
  ['Capcut Pro成品', '个人版或团队版，按周卡、月卡选择。'],
].map(([title, description], index) => ({
  id: 100 + index,
  title,
  description,
  price: 3.21,
  stock: 25,
  sales: 0,
  is_auto: true,
  cover: 'https://example.com/fixture.png',
  sort_id: index,
  is_sku: true,
  min_qty: 1,
  max_qty: 0,
  specs: [
    {
      title: '规格',
      values: [
        { id: '10', name: '规格一' },
        { id: '20', name: '规格二' },
      ],
    },
  ],
  sku_variants: [
    { sku: '10', price: 3.21, stock: 20 },
    { sku: '20', price: 5.43, stock: 5 },
  ],
  required_inputs: [],
}))
export function createHanfolkFixture() {
  let reads = 0
  return {
    stats: () => ({ reads, writes: 0 }),
    async fetch(request) {
      const url = new URL(request.url)
      if (
        url.origin !== 'https://ai.hanfolk.xyz' ||
        url.pathname !== '/content/plugins/seller_api/api.php' ||
        request.method !== 'GET' ||
        request.headers.get('X-API-Key') !== hanfolkFixtureKey
      )
        throw new Error('Only synthetic read-only Hanfolk requests are allowed')
      reads++
      const action = url.searchParams.get('do')
      if (action === 'balance')
        return Response.json({ success: true, balance: 123.45 })
      if (action === 'products')
        return Response.json({
          success: true,
          count: hanfolkFixtureProducts.length,
          products: hanfolkFixtureProducts,
        })
      if (action === 'product') {
        const p = hanfolkFixtureProducts.find(
          (p) => p.id === Number(url.searchParams.get('id')),
        )
        return Response.json(
          p ? { success: true, product: p } : { success: false },
          { status: p ? 200 : 404 },
        )
      }
      throw new Error('Fixture rejected supplier write')
    },
  }
}
