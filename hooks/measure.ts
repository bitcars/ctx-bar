// Pure: what the engine's figures mean for the bar (plan v2 §2). No `$`.
import type { ModelUsage, SessionContextBreakdown } from 'claude-code'
import type { View, Win } from '../types'

export type BreakdownWindow = Pick<
  SessionContextBreakdown,
  'rawMaxTokens' | 'isAutoCompactEnabled' | 'autoCompactThreshold' | 'categories'
>

/**
 * The compaction window and its threshold. With auto-compact off there is no threshold.
 * When the engine gives none, `rawMax − buffer` from the `kind: 'buffer'` row is a
 * spike-observed heuristic (33,000 on 2.1.295), not documented in the types.
 */
export function windowFrom(b: BreakdownWindow): Win {
  const autoOn = b.isAutoCompactEnabled
  const buffer = b.categories.find(c => c.kind === 'buffer')
  const threshold = !autoOn
    ? null
    : (b.autoCompactThreshold ?? (buffer ? b.rawMaxTokens - buffer.tokens : null))

  return { rawMax: b.rawMaxTokens, threshold, autoOn }
}

/** Cache-read share of the request's input; null usage keeps `prev`; a zero input is null. */
export function cachePct(u: ModelUsage | null | undefined, prev: number | null): number | null {
  if (!u) return prev
  const total = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
  if (total === 0) return null

  return Math.floor((u.cache_read_input_tokens * 100) / total)
}

export const INITIAL: View = {
  tokens: null,
  window: 0,
  cost: null,
  cachePct: null,
  win: null,
  lastCompact: null,
  table: null,
  spend: {},
  warned: [],
  lastModel: null,
  tableNoted: false,
}

/** Live figures cleared by /clear and resume; the compaction window and the price table stay. */
export function cleared(v: View): View {
  return { ...v, tokens: null, cost: null, cachePct: null, lastCompact: null, spend: {}, warned: [], lastModel: null }
}
