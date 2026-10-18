import { ApiError, body, json, type Env } from './platform.ts'
import {
  artworkProblem,
  cleanArtwork,
  originalArtwork,
  type ArtworkProduct,
  type ProductArtworkConfig,
  type ProductArtworkMap,
} from '../shared/product-artwork.ts'

type Row = { product_id: string; settings: string; version: number }
const titles: Record<string, string> = {
  chatgpt: 'ChatGPT',
  gemini: 'Gemini Pro',
  duolingo: '多邻国',
  gmail: 'Gmail 账号',
  'x-premium': 'X Premium',
  'codex-sms': 'Codex 接码',
}
export async function publicArtwork(
  env: Env,
  visibleIds: string[],
): Promise<ProductArtworkMap> {
  const rows = (
    await env.INTEREST_DB.prepare(
      'SELECT product_id,settings,version FROM product_artwork',
    ).all<Row>()
  ).results
  const visible = new Set(visibleIds)
  return Object.fromEntries(
    rows
      .filter((row) => visible.has(row.product_id))
      .map((row) => [
        row.product_id,
        cleanArtwork(JSON.parse(row.settings) as ProductArtworkConfig, true),
      ])
      .filter(
        ([, config]) =>
          (config as ProductArtworkConfig).template !== 'original',
      ),
  )
}
async function artworkProducts(env: Env): Promise<ArtworkProduct[]> {
  const [products, artwork] = await Promise.all([
    env.INTEREST_DB.prepare(
      'SELECT c.product_id,MAX(c.name) name,MAX(p.public_json) custom FROM catalog_plans c LEFT JOIN shop_products p ON p.id=c.product_id WHERE NOT EXISTS(SELECT 1 FROM catalog_deletions d WHERE d.plan_id=c.id) GROUP BY c.product_id ORDER BY c.product_id',
    ).all<{ product_id: string; name: string; custom: string | null }>(),
    env.INTEREST_DB.prepare(
      'SELECT product_id,settings,version FROM product_artwork',
    ).all<Row>(),
  ])
  return products.results.map((p) => {
    const custom = p.custom ? JSON.parse(p.custom) : null
    const row = artwork.results.find((a) => a.product_id === p.product_id)
    return {
      id: p.product_id,
      name: custom?.name ?? titles[p.product_id] ?? p.name,
      image: custom?.image ?? '',
      duration: custom?.duration ?? '',
      config: row ? JSON.parse(row.settings) : originalArtwork(),
      version: row?.version ?? 0,
    }
  })
}
// Called only inside commerce's existing requireAdmin boundary.
export async function artworkRoute(request: Request, env: Env) {
  if (request.method === 'GET')
    return json({ products: await artworkProducts(env) })
  if (request.method !== 'POST') throw new ApiError('请求方式不支持。', 405)
  const input = await body(request, 1300000)
  if (
    typeof input.productId !== 'string' ||
    !Number.isSafeInteger(input.version) ||
    Number(input.version) < 0
  )
    throw new ApiError('商品或版本无效。')
  const problem = artworkProblem(input.config)
  if (problem) throw new ApiError(problem)
  const product = (await artworkProducts(env)).find(
    (p) => p.id === input.productId,
  )
  if (!product) throw new ApiError('未找到商品。', 404)
  if (product.version !== input.version)
    throw new ApiError('展示配置已更新，请重新打开后编辑。', 409)
  const config = input.config as ProductArtworkConfig
  const settings = JSON.stringify(cleanArtwork(config))
  const id = crypto.randomUUID(),
    now = Date.now(),
    db = env.INTEREST_DB
  await db.batch([
    db
      .prepare(
        `INSERT INTO product_artwork(product_id,settings,version,updated_at,change_id)
      SELECT ?,?,1,?,? WHERE ?=0 OR EXISTS(SELECT 1 FROM product_artwork WHERE product_id=? AND version=?)
      ON CONFLICT(product_id) DO UPDATE SET settings=excluded.settings,version=product_artwork.version+1,updated_at=excluded.updated_at,change_id=excluded.change_id WHERE product_artwork.version=?`,
      )
      .bind(
        product.id,
        settings,
        now,
        id,
        input.version,
        product.id,
        input.version,
        input.version,
      ),
    db
      .prepare(
        "INSERT INTO admin_audit(id,target_id,action,note,created_at) SELECT ?,product_id,'product-artwork',?,? FROM product_artwork WHERE product_id=? AND change_id=?",
      )
      .bind(
        id,
        config.template === 'original'
          ? '恢复商品原有展示'
          : '保存商品展示样式：' + config.template,
        now,
        product.id,
        id,
      ),
  ])
  const row = await db
    .prepare(
      'SELECT settings,version FROM product_artwork WHERE product_id=? AND change_id=?',
    )
    .bind(product.id, id)
    .first<{ settings: string; version: number }>()
  if (!row) throw new ApiError('展示配置已更新，请重新打开后编辑。', 409)
  return json({
    product: {
      ...product,
      config: JSON.parse(row.settings),
      version: row.version,
    },
  })
}
