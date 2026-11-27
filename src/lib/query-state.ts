import { RequestError, errorMessage } from './api.ts'

export type QueryResult<T> = { path: string; revision: number; data?: T; error: string; fetchedAt?: number }
export function failedQuery<T>(previous: QueryResult<T> | undefined, path: string, revision: number, error: unknown, retain: boolean): QueryResult<T> {
  const temporary = !(error instanceof RequestError) || error.status >= 500 || [408, 429].includes(error.status)
  const fallback = retain && temporary && previous?.path === path ? previous : undefined
  return { path, revision, error: errorMessage(error), data: fallback?.data, fetchedAt: fallback?.fetchedAt }
}

export function mutationError(error: unknown) {
  return !(error instanceof RequestError) || error.status >= 500 || error.status === 408
    ? `${errorMessage(error)} 操作结果尚未确认，请先刷新进度核对，再决定是否重试。`
    : errorMessage(error)
}
