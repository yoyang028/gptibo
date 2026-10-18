import type { HanfolkDetail } from '../../shared/hanfolk-catalog.ts'
import type { ShopProduct } from '../../shared/shop-products.ts'
import { hanfolkFamily } from '../../shared/hanfolk-catalog.ts'
import type { Env, Statement } from '../platform.ts'

type PlanRow = { id: string; product_id: string; enabled: number; version: number; public_json: string | null; product_version: number | null }
type Link = { local_id: string; product_id: number; sku: string; related_plan_id: string | null }
const legacyFamilies: Record<string, string> = { 'gemini-pro-18m': 'gemini', 'duolingo-12m': 'duolingo', 'gmail-account': 'gmail' }

/** Prepare an atomic removal only after a complete, successful supplier read.
 * The caller updates hanfolk_settings.change_id first in the same transaction.
 * No order, order snapshot, CRM history, or shared family artwork is deleted.
 */
export async function prepareDajuCleanup(env: Env, details: readonly HanfolkDetail[], event: string, now = Date.now()): Promise<Statement[]> {
  const [links, plans] = await Promise.all([
    env.INTEREST_DB.prepare('SELECT local_id,product_id,sku,related_plan_id FROM hanfolk_product_links').all<Link>(),
    env.INTEREST_DB.prepare('SELECT c.id,c.product_id,c.enabled,c.version,p.public_json,p.version product_version FROM catalog_plans c LEFT JOIN shop_products p ON p.id=c.id').all<PlanRow>(),
  ])
  const current = new Map(details.map(d => [d.id, d]))
  const managed = new Set<string>(details.map(d => hanfolkFamily(d.title) ?? '').filter(Boolean))
  const linked = new Set(links.results.map(l => l.local_id))
  for (const plan of plans.results) {
    if (linked.has(plan.id) && plan.public_json) {
      const group = (JSON.parse(plan.public_json) as ShopProduct).groupId
      if (group) managed.add(group)
    }
  }
  const related = new Set(links.results.map(l => l.related_plan_id).filter(Boolean))
  const reasons = new Map<string, string>()
  for (const link of links.results) {
    const source = current.get(link.product_id)
    const variant = source?.sku_variants.find(v => v.sku === link.sku)
    if (!variant || variant.stock <= 0) reasons.set(link.local_id, !variant ? 'upstream-removed' : 'out-of-stock')
  }
  for (const plan of plans.results) {
    if (linked.has(plan.id) || plan.enabled) continue
    const product = plan.public_json ? JSON.parse(plan.public_json) as ShopProduct : null
    const retiredManual = product?.status === 'archived' && !product.api && managed.has(product.groupId ?? '')
    const legacy = Object.hasOwn(legacyFamilies, plan.id) && managed.has(legacyFamilies[plan.id])
    if (retiredManual || legacy || related.has(plan.id)) reasons.set(plan.id, 'superseded-legacy')
  }
  const db = env.INTEREST_DB
  const statements = plans.results.filter(p => reasons.has(p.id)).map(p => db.prepare(
    "INSERT INTO catalog_deletions(plan_id,source,reason,removed_at,change_id) SELECT c.id,'daju',?,?,? FROM catalog_plans c LEFT JOIN shop_products p ON p.id=c.id WHERE c.id=? AND c.version=? AND COALESCE(p.version,-1)=? AND EXISTS(SELECT 1 FROM hanfolk_settings WHERE id='main' AND change_id=?) ON CONFLICT(plan_id) DO UPDATE SET reason=excluded.reason,removed_at=excluded.removed_at,change_id=excluded.change_id",
  ).bind(reasons.get(p.id)!, now, event, p.id, p.version, p.product_version ?? -1, event))
  if (!statements.length) return []
  const targets = 'SELECT plan_id FROM catalog_deletions WHERE change_id=?'
  const historical = 'EXISTS(SELECT 1 FROM orders o WHERE o.plan=catalog_plans.id) OR EXISTS(SELECT 1 FROM crm_subscriptions s WHERE s.plan=catalog_plans.id)'
  statements.push(
    db.prepare(`UPDATE catalog_plans SET enabled=0,partner_enabled=0,version=version+1,updated_at=? WHERE id IN (${targets})`).bind(now,event),
    db.prepare(`UPDATE hanfolk_product_links SET related_plan_id=NULL,match_note='' WHERE related_plan_id IN (${targets})`).bind(event),
    db.prepare(`DELETE FROM hanfolk_product_links WHERE local_id IN (${targets})`).bind(event),
    db.prepare(`DELETE FROM shop_products WHERE id IN (${targets})`).bind(event),
    db.prepare(`DELETE FROM partner_prices WHERE plan IN (${targets})`).bind(event),
    db.prepare(`DELETE FROM partner_default_prices WHERE plan IN (${targets})`).bind(event),
    db.prepare(`DELETE FROM accounting_costs WHERE plan IN (${targets}) AND plan IN (SELECT id FROM catalog_plans WHERE NOT (${historical}))`).bind(event),
    db.prepare(`DELETE FROM shop_redemption_guides WHERE product_id IN (${targets}) AND product_id IN (SELECT id FROM catalog_plans WHERE NOT (${historical}))`).bind(event),
    db.prepare(`DELETE FROM product_artwork WHERE product_id IN (${targets})`).bind(event),
    db.prepare(`DELETE FROM catalog_plans WHERE id IN (${targets}) AND NOT (${historical})`).bind(event),
    db.prepare("INSERT INTO admin_audit(id,target_id,action,note,created_at) SELECT ?||':'||plan_id,plan_id,'daju-delete',reason,removed_at FROM catalog_deletions WHERE change_id=?").bind(event,event),
  )
  return statements
}
