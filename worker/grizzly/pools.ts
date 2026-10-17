import {
  GRIZZLY_POOLS,
  decimalUnits,
  type SmsPoolQuote,
} from '../../shared/grizzly-sms.ts'
import { GrizzlyClient, GrizzlyError } from './client.ts'

export async function poolQuotes(
  client: GrizzlyClient,
  service: string,
): Promise<SmsPoolQuote[]> {
  const results = await Promise.allSettled(
    Object.keys(GRIZZLY_POOLS).map(async (country) => ({
      country,
      ...(await client.price(service, country)),
      error: null,
    })),
  )
  return results.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : {
          country: Object.keys(GRIZZLY_POOLS)[i],
          priceUsd: null,
          count: null,
          error:
            r.reason instanceof GrizzlyError
              ? r.reason.message
              : '报价暂未确认',
        },
  )
}
export function affordablePools(quotes: SmsPoolQuote[], maxPrice: string) {
  const limit = decimalUnits(maxPrice)
  return quotes
    .filter(
      (q): q is SmsPoolQuote & { priceUsd: string; count: number } =>
        q.priceUsd !== null &&
        q.count !== null &&
        q.count > 0 &&
        decimalUnits(q.priceUsd) <= limit,
    )
    .sort(
      (a, b) =>
        decimalUnits(a.priceUsd) - decimalUnits(b.priceUsd) ||
        Number(b.country) - Number(a.country),
    )
}

// Only the provider's exact NO_NUMBERS response proves this purchase did not
// allocate. A timeout/unknown response never authorizes a second pool.
export async function allocateFromPools(
  client: GrizzlyClient,
  service: string,
  maxPrice: string,
  quotes: SmsPoolQuote[],
  hooks: {
    attempt: (country: string, quote: string) => Promise<void>
    result: (
      country: string,
      state: 'no_numbers' | 'received' | 'unknown' | 'rejected',
      id?: string,
    ) => Promise<void>
  },
  excluded: string[] = [],
) {
  const candidates = affordablePools(quotes, maxPrice).filter(
    (q) => !excluded.includes(q.country),
  )
  if (!candidates.length) {
    if (quotes.some((q) => q.error)) throw new GrizzlyError('NETWORK')
    throw new GrizzlyError('NO_NUMBERS', true)
  }
  for (const q of candidates) {
    await hooks.attempt(q.country, q.priceUsd)
    try {
      const allocated = await client.allocate(service, q.country, maxPrice)
      await hooks.result(q.country, 'received', allocated.id)
      return { ...allocated, selectedCountry: q.country }
    } catch (e) {
      if (
        e instanceof GrizzlyError &&
        e.code === 'NO_NUMBERS' &&
        e.definitive
      ) {
        await hooks.result(q.country, 'no_numbers')
        continue
      }
      await hooks.result(
        q.country,
        e instanceof GrizzlyError && e.definitive ? 'rejected' : 'unknown',
      )
      throw e
    }
  }
  throw new GrizzlyError('NO_NUMBERS', true)
}
