import { SmsFlowPreview } from './sms-flow-preview'
import type { SmsPublicCatalog } from '../../shared/grizzly-sms'
import { MuseLogoMotion } from './muse-logo-motion'
import { ProductArtwork } from './product-artwork'
import { OfficialLogoMotion } from './official-logo-motion'
import { GrokBundleScene } from './grok-bundle-scene'
import { officialBrand } from './official-brand'
import { GmailScene } from './gmail-scene'
import { ProductServiceScene } from './product-service-scene'
import type { ProductArtworkMap } from '../../shared/product-artwork'
import { useStorefrontI18n } from '@/lib/storefront-i18n'
import { normalizeProductOrder } from '../../shared/product-order'
import { XPremiumScene } from './x-premium'
import { MembershipScene } from './membership-scene'
import { EMAIL_PRODUCTS } from '../../shared/email-products'
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { BookOpen, ChevronRight, CircleHelp, Clock3, Heart, LayoutGrid, Mail, MessageSquare, ReceiptText, Search, Sparkles, Terminal } from 'lucide-react'
import { LaunchInterestDialog, type InterestProduct } from './launch-interest-dialog'
import { ProductMark } from './brand'
import { SubscriptionDeck } from './subscription-deck'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { UPCOMING_PRODUCTS } from '@/lib/products'
import { storefrontHref } from '@/lib/storefront-routing'
import { catalogSubscriptionPlans, catalogStartingPrice, formatCatalogPrice } from '@/lib/catalog-display'
import { CATALOG_CATEGORIES, catalogCategory, type CatalogCategory } from '@/lib/catalog-categories'
import { shopPresentation, variantLabel } from '@/lib/shop-presentation'
import { inventoryLabel } from '../../shared/product-inventory'
import { museKind } from '../../shared/muse-products'
import type { CatalogPlan } from '@/lib/api'
import { groupShopProducts, type ShopProduct } from '../../shared/shop-products'
import '@/styles/storefront-home.css'

const categoryIcons = { ai: Sparkles, learning: BookOpen, lifestyle: Heart, mail: Mail, sms: MessageSquare, tool: Terminal }
const categories = [
  { id: 'all', name: '全部商品', icon: LayoutGrid } as const,
  ...CATALOG_CATEGORIES.map(category => ({ ...category, icon: categoryIcons[category.id] })),
]

function CatalogSkeleton() {
  return <div className="store-featured store-catalog-skeleton" aria-hidden="true">
    {[0, 1, 2, 3].map(index => <div key={index} className="store-product store-skeleton-card">
      <span className="store-skeleton-title" /><span className="store-skeleton-spec" />
      <div className="store-skeleton-art"><span /></div>
      <div className="store-product-bottom"><span className="store-skeleton-price" /><span className="store-skeleton-action" /></div>
    </div>)}
  </div>
}

export function ProductCatalog({ managedProductGroups = [], smsCatalog, onHelp, onOrders, onNavigate, offers, catalogReady, error, productOrder = [], hiddenProductIds = [], products = [], productArtwork = {} }: { managedProductGroups?:string[]; smsCatalog?: SmsPublicCatalog; productArtwork?: ProductArtworkMap; products?: ShopProduct[]; catalogReady: boolean; error?: string; productOrder?: readonly string[]; hiddenProductIds?: readonly string[]; onHelp: () => void; onOrders: () => void; onNavigate: (page: string) => void; offers: CatalogPlan[] }) {
  const { t } = useStorefrontI18n()
  const [category, setCategory] = useState<CatalogCategory | 'all'>('all')
  const [query, setQuery] = useState('')
  const [interest, setInterest] = useState<InterestProduct>()
  const [interestOpen, setInterestOpen] = useState(false)
  const catalogRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const catalog = catalogRef.current
    const header = document.querySelector<HTMLElement>('.site-header')
    if (!catalog || !header) return
    const measure = () => catalog.style.setProperty('--store-header-height', `${header.getBoundingClientRect().height}px`)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(header)
    return () => observer.disconnect()
  }, [])
  function selectCategory(id: CatalogCategory | 'all') {
    setCategory(id)
    const catalog = catalogRef.current
    if (catalog && catalog.getBoundingClientRect().top < 0) catalog.scrollIntoView({ block: 'start', behavior: 'instant' })
  }
  const plans = catalogSubscriptionPlans(offers)
  const productGroups = groupShopProducts(products).filter(g => g.id !== 'codex-sms')
  const startingPrice = catalogStartingPrice(offers)
  const matches = (group: CatalogCategory, text: string) => (category === 'all' || category === group) && text.toLowerCase().includes(query.trim().toLowerCase())
  const chatgpt = matches('ai', 'ChatGPT Plus Pro')
  const gmail = !managedProductGroups.includes('gmail') && !productGroups.some(g => g.id === 'gmail') && matches('mail', 'Gmail 邮箱账号 email accounts 2FA')
  const upcoming = UPCOMING_PRODUCTS.filter(p => !managedProductGroups.includes(p.id) && !productGroups.some(g => g.id === p.id) && matches(catalogCategory(p), p.name))
  const memberships = Object.entries(EMAIL_PRODUCTS).filter(([, p]) => !managedProductGroups.includes(p.productId) && !productGroups.some(g => g.id === p.productId) && p.productId !== 'gmail' && matches(catalogCategory({ id: p.productId }), p.name + (p.productId === 'duolingo' ? ' Duolingo' : '')))
  const xgift = matches('lifestyle', 'X Premium 推特 Twitter 会员赠送')
  const xOffers = offers.filter(p => p.product_id === 'x-premium')
  const xAvailable = xOffers.some(p => p.enabled)
  const xOffer = [...xOffers].sort((a, b) => Number(Boolean(b.enabled)) - Number(Boolean(a.enabled)) || a.price_cents - b.price_cents)[0]
  const sms = matches('sms', 'SMS接码 codex Claude Google Gmail 美国 手机号 短信 verification')
  const smsProjects = smsCatalog?.projects.filter(p => p.visible)
  const smsAvailable = smsProjects?.some(p => p.enabled)
  const smsPrice = smsProjects?.length ? Math.min(...smsProjects.map(p => p.priceCents)) : 1580
  const navigate = (event: MouseEvent<HTMLAnchorElement>, page: string) => {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault(); onNavigate(page)
  }
  const cards: { id: string; compact?: boolean; node: ReactNode }[] = [
    ...productGroups.filter(g => {
      const p = g.products[0]
      return matches(catalogCategory(p), g.name + ' ' + g.products.map(p => p.name + ' ' + p.category + ' ' + p.tagline).join(' '))
    }).map(g => {
      const p = g.products[0], multiple = g.products.length > 1, priced = g.products.filter(p=>!p.pricePending), starting = priced[0]
      const presentation = shopPresentation(g.id, p)
      const stockState = g.products.every(p => Boolean(inventoryLabel(p))) ? g.products.some(p => p.inventory?.status === 'checking') ? '库存待确认' : '补货中' : ''
      const available = g.products.some(p => p.status === 'published' && !inventoryLabel(p) && offers.some(o => o.id === p.id && o.enabled))
      return { id: g.id, node: <article className={`store-product service-${g.id}`} data-product-group={g.id}>
        <div className="store-product-heading"><h3>{g.name}</h3><span className={stockState ? 'product-inventory-state' : undefined}>{stockState || (available ? p.badge : g.id === 'grok' ? '暂停售卖' : !priced.length ? '价格请咨询' : '支持客服下单')}</span></div>
        <p className="store-spec">{g.id === 'muse' ? g.products.some(item => museKind(item) === 'invitation') ? '成品账号 · 词元服务' : `${g.products.length} 档成品账号` : multiple ? `${g.products.length} 个规格可选` : p.duration} · {presentation.tagline}</p>
        {g.id === 'grok' ? <GrokBundleScene /> : g.id === 'muse' ? <MuseLogoMotion /> : g.id === 'duolingo' ? <MembershipScene productId='duolingo'/> : g.id === 'gmail' ? <GmailScene/> : officialBrand(g.id) ? <OfficialLogoMotion productId={g.id}/> : multiple ? <SubscriptionDeck brand={g.name} productId={g.id} plans={g.products.map(p => ({ id: p.id, name: variantLabel(p, g.name), price: p.pricePending ? null : p.priceCents / 100, unit: p.unit }))} /> : <ProductArtwork config={productArtwork[g.id] ?? productArtwork[p.id]} name={g.name} caption={p.duration} fallback={<ProductServiceScene productId={g.id} name={g.name} duration={p.duration} />} />}
        <div className="store-product-bottom"><span className="store-starting-price">{starting ? <>¥{formatCatalogPrice(starting.priceCents / 100)}<small>{multiple ? ' 起' : '／' + p.unit}</small></> : <small>待定价</small>}</span><a className="store-action" href={storefrontHref('product/' + g.id)} onClick={e => navigate(e, 'product/' + g.id)}>{multiple ? '选择规格' : '查看商品'}</a></div>
      </article> }
    }),
    { id: "chatgpt", node: chatgpt && <article className="store-product"><div className="store-product-heading"><h3>ChatGPT</h3>{offers.length > 0 && !plans.some(p => p.enabled) && <span>{t('支持客服下单')}</span>}</div><p className="store-spec">{t('自有账号充值 · Plus / Pro')}</p><ProductArtwork config={productArtwork.chatgpt} name="ChatGPT" caption="Plus / Pro" fallback={<SubscriptionDeck plans={plans} />} /><div className="store-product-bottom"><span className="store-starting-price">{startingPrice === null ? <small>{t(offers.length ? '价格暂不可用' : '价格加载中')}</small> : <>¥{formatCatalogPrice(startingPrice)}<small>{t(' 起')}</small></>}</span><a className="store-action" href={storefrontHref('product/chatgpt')} onClick={e => navigate(e, 'product/chatgpt')}>{t('选择套餐')}</a></div></article> },
    ...memberships.map(([id, product]) => {
      const offer = offers.find(p => p.id === id), gemini = product.productId === 'gemini'
      const name = gemini ? 'Gemini' : t('多邻国')
      return { id: product.productId, node: <article key={id} className="store-product membership-product">
        <div className="store-product-heading"><h3>{name}</h3><span>{!offer ? '补货中' : t(!offer.enabled ? '支持客服下单' : product.duration + '会员')}</span></div>
        <p className="store-spec">{offer ? `${t(product.label)} · ${t('邮件交付')}` : '规格正在确认，补货后更新。'}</p>
        {gemini ? <OfficialLogoMotion productId="gemini" /> : <ProductArtwork config={productArtwork[product.productId]} name={name} caption={product.duration} fallback={<MembershipScene productId="duolingo" />} />}
        <div className="store-product-bottom"><span className="store-starting-price">{offer ? <>¥{formatCatalogPrice(offer.price_cents / 100)}<small> / {t(product.duration)}</small></> : <small>补货中</small>}</span><a className="store-action" href={storefrontHref('product/' + product.productId)} onClick={e => navigate(e, 'product/' + product.productId)}>{t(offer?.enabled ? '查看商品' : '查看详情')}</a></div>
      </article> }
    }),
    { id: "x-premium", node: xgift && <article className="store-product membership-product x-product"><div className="store-product-heading"><h3>X Premium</h3><span>{t(offers.length > 0 && !xAvailable ? '支持客服下单' : '会员订阅')}</span></div><p className="store-spec">{t('3 / 6 个月 · 你的账号，继续精彩')}</p><ProductArtwork config={productArtwork['x-premium']} name="X Premium" caption="Premium" fallback={xOffers.length > 1 ? <SubscriptionDeck brand="X Premium" productId="x-premium" plans={xOffers.map(p => ({ id: p.id, name: p.id === 'x-premium-3m' ? '3 个月' : '6 个月', price: p.price_cents / 100, unit: '份' }))} /> : <XPremiumScene />} /><div className="store-product-bottom"><span className="store-starting-price">{xOffer ? <>¥{formatCatalogPrice(xOffer.price_cents / 100)}<small>{t(' 起')}</small></> : <small>{t('价格加载中')}</small>}</span><a className="store-action" href={storefrontHref('product/x-premium')} onClick={e => navigate(e, 'product/x-premium')}>{t(xAvailable ? '选择套餐' : '查看详情')}</a></div></article> },
    { id: "gmail", node: gmail && <article className="store-product"><div className="store-product-heading"><h3>{t('Gmail 账号')}</h3><span>{t('美国个人白号')}</span></div><p className="store-spec">{t('带 2FA · 账号资料自动邮件交付')}</p><ProductArtwork config={productArtwork.gmail} name="Gmail" fallback={<GmailScene />} /><div className="store-product-bottom"><span className="store-starting-price">{offers.find(p => p.id === 'gmail-account') ? <>¥{formatCatalogPrice(offers.find(p => p.id === 'gmail-account')!.price_cents / 100)}<small>{t(' / 个')}</small></> : <small>{t('价格加载中')}</small>}</span><a className="store-action" href={storefrontHref('product/gmail')} onClick={e => navigate(e, 'product/gmail')}>{t(offers.some(p => p.id === 'gmail-account' && p.enabled) ? '查看商品' : '查看详情')}</a></div></article> },
    ...upcoming.map(product => ({ id: product.id, compact: true, node: <Button key={product.id} variant="ghost" className="store-compact" onClick={() => { setInterest(product); setInterestOpen(true) }}><ProductMark small productId={product.id} /><span><strong>{product.name}</strong><small>{t('待上架')}</small></span><ChevronRight size={16} /></Button> })),
    { id: 'codex-sms', node: sms && smsProjects?.length !== 0 && <article className="store-product store-sms-product" data-product-group="codex-sms"><div className="store-product-heading"><h3>SMS接码</h3><span>{smsAvailable ? '单次短信' : '支持客服下单'}</span></div><p className="store-spec">codex · Claude · Google/Gmail · 美国单次短信</p><SmsFlowPreview compact/><div className="store-product-bottom"><span className="store-starting-price">¥{formatCatalogPrice(smsPrice / 100)}<small> 起 / 次</small></span><a className="store-action" href={storefrontHref('product/codex-sms')} onClick={e=>navigate(e,'product/codex-sms')}>选择项目</a></div></article> },
  ]
  const groups: typeof cards[] = []
  for (const id of [...new Set([...productOrder,...normalizeProductOrder(productOrder),...productGroups.map(g=>g.id)])]) {
    const card = cards.find(item => item.id === id)
    if (!card?.node || hiddenProductIds.includes(id)) continue
    const last = groups.at(-1)
    if (last && Boolean(last[0].compact) === Boolean(card.compact)) last.push(card)
    else groups.push([card])
  }
  const visibleCards = groups.flat()
  return <section ref={catalogRef} id="catalog-products" className="store-home page-width" aria-label={t('商品目录')}>
    <aside className="store-sidebar" aria-label={t('商品分类')}>
      <span className="store-sidebar-label">{t('浏览商品')}</span>
      <div className="store-categories" role="group" aria-label={t('按品类筛选')}>{categories.map(({ id, name, icon: Icon }) => <Button key={id} variant="ghost" aria-pressed={category === id} onClick={() => selectCategory(id)}><Icon size={16} />{t(name)}</Button>)}</div>
      <div className="store-sidebar-links"><Button variant="ghost" onClick={onOrders}><Clock3 size={16} />{t('继续我的订单')}</Button><Button variant="ghost" onClick={onHelp}><CircleHelp size={16} />{t('购买帮助')}</Button></div>
    </aside>
    <div className="store-content" aria-busy={!catalogReady && !error}>
      <div className="store-toolbar"><h2>{t(query ? '搜索结果' : category === 'all' ? '为你精选。' : categories.find(c => c.id === category)!.name)}</h2><label className="store-search"><Search size={15} /><Input aria-label={t('搜索商品')} placeholder={t('搜索商品')} value={query} onChange={e => setQuery(e.target.value)} /></label></div>
      {!catalogReady ? error ? <p className="store-empty" role="status">{t('商品暂时加载失败，请点击上方重试。')}</p> : <>
        <span className="sr-only" role="status">{t('正在加载商品')}</span><CatalogSkeleton />
      </> : <>
        {groups.map(group => <div key={group[0].id} className={(group[0].compact ? 'store-compact-grid' : 'store-featured') + ' store-product-group'}>
          {group.map(card => <div key={card.id} className="store-card-enter reveal-in" style={{ animationDelay: `${Math.min(visibleCards.indexOf(card), 6) * 40}ms` }}>
            {card.node}
          </div>)}
        </div>)}
        {!groups.length && <p className="store-empty" role="status">{t('没有找到相关商品，试试其他名称。')}</p>}
      </>}
      <p className="store-order-note"><ReceiptText size={15} />{t('付款、交付与售后，都可以在')}<button onClick={onOrders}>{t('「我的订单」')}</button>{t('中继续。')}</p>
    </div>
    {interest && <LaunchInterestDialog key={interest.id} product={interest} open={interestOpen} onOpenChange={setInterestOpen} />}
  </section>
}
