import { useEffect, useState } from 'react'
import { api } from './api'
import { failedQuery, type QueryResult } from './query-state'
import { visiblePolling } from './visible-polling'

// A refresh keeps this query's content. A different query never borrows old rows.
export function useResource<T>(path: string, revision = 0, { retainOnError = false, pollInterval }: { retainOnError?: boolean; pollInterval?: number } = {}) {
  const [result, setResult] = useState<QueryResult<T>>()
  const sameQuery = result?.path === path
  const loading = !sameQuery || result.revision !== revision
  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      try {
        const data = await api<T>(path, undefined, controller.signal)
        if (!controller.signal.aborted) setResult({ path, revision, data, error: '', fetchedAt: Date.now() })
      } catch (error) {
        if (!controller.signal.aborted) setResult(previous => failedQuery(previous, path, revision, error, retainOnError))
      }
    }
    const stop = pollInterval === undefined ? undefined : visiblePolling(load, pollInterval)
    if (!stop) void load()
    return () => { stop?.(); controller.abort() }
  }, [path, revision, retainOnError, pollInterval])
  return {
    data: sameQuery ? result.data : undefined,
    fetchedAt: sameQuery ? result.fetchedAt : undefined,
    error: loading ? '' : result.error,
    loading,
    stale: Boolean(sameQuery && result.data !== undefined && result.error),
  }
}
