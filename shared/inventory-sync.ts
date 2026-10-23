export type SyncOptions = {
  enabled: boolean
  intervalMinutes: 5 | 10 | 30
  version: number
  lastAttemptAt: number
  lastSuccessAt: number
  consecutiveFailures: number
  lastError: string
  running: boolean
}
export type SyncRun = {
  id: string; trigger: 'manual' | 'scheduled'; status: 'running' | 'success' | 'failed' | 'superseded'
  started_at: number; finished_at: number; product_count: number; variant_count: number; change_count: number; error: string
}
export type SyncChange = {
  id: string; run_id: string; local_id: string | null; product_id: number; sku: string; name: string
  kind: 'new' | 'stock' | 'removed' | 'restocked' | 'price'
  before_stock: number | null; after_stock: number | null; before_cost: number | null; after_cost: number | null; created_at: number
}
export type RemovalReview = { id: string; name: string; productId: number; sku: string; version: number; checkedAt: number }
export type InventoryMonitor = {
  options: SyncOptions; page: number; total: number; runs: SyncRun[]; changes: SyncChange[]
  pendingNew: { productId: number; sku: string; name: string; stock: number }[]
  pendingRemoval: RemovalReview[]
  historyPage: number; historyTotal: number; history: SyncChange[]
}
