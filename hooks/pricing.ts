// Pure: a user's per-token price table and the session's spend priced by it (plan ctx-bar-pricing v2 §1a–§1b, §2).
// No `$`, no state. Rates are USD per million tokens. Model ids are looked up as own keys only, so an id
// like `__proto__` or `toString` is an ordinary entry (PR16, PR17, PT27).
// Lines `// @neg:<case>` are mutation points for scripts/neg.sh (V4); they do nothing.

import type { Counts, Entry, Rates, Spend, Table, Tiers } from '../types'
export type { Counts, Entry, Rates, Spend, Table, Tiers }

/** The usage counts one model call reports (ModelUsage's four fields). */
export type UsageCounts = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

export const MAX_MODELS = 256
export const MAX_RATE = 1_000_000
const FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite'] as const
const ZERO: Counts = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

const isPlainObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x)
const isRate = (x: unknown): x is number =>
  typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= MAX_RATE

/** Reads the four rates of `o`, or names the first bad one (with `prefix`). */
function ratesOf(o: Record<string, unknown>, prefix: string): Rates | string {
  const out: Partial<Rates> = {}
  for (const f of FIELDS) {
    const v = o[f]
    if (!isRate(v)) return `bad ${prefix}${f}`
    out[f] = v
  }
  return out as Rates
}

/** One entry, validated; unknown keys are dropped. */
function entryOf(x: unknown): Entry | string {
  if (!isPlainObject(x)) return 'not an object'
  const base = ratesOf(x, '')
  if (typeof base === 'string') return base
  if (!Object.hasOwn(x, 'longContext')) return base
  const lc = x.longContext
  if (!isPlainObject(lc)) return 'bad longContext'
  const above = lc.above
  if (typeof above !== 'number' || !Number.isSafeInteger(above) || above < 1) return 'bad longContext.above'
  const long = ratesOf(lc, 'longContext.')
  if (typeof long === 'string') return long
  return { ...base, longContext: { above, ...long } }
}

/**
 * The table in `text`, or a fixed reason it is unusable. Reasons never quote the file (CD-L2).
 * A leading U+FEFF is stripped; at most MAX_MODELS entries.
 */
export function parseTable(text: string): { ok: Table } | { error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text.startsWith('﻿') ? text.slice(1) : text)
  } catch {
    return { error: 'not JSON' }
  }
  if (!isPlainObject(raw)) return { error: 'not an object' }
  const keys = Object.keys(raw)
  if (keys.length > MAX_MODELS) return { error: 'too many models' }
  const pairs: [string, Entry][] = []
  for (const k of keys) {
    const e = entryOf(raw[k])
    if (typeof e === 'string') return { error: `${k}: ${e}` }
    pairs.push([k, e])
  }
  return { ok: Object.assign(Object.create(null) as Table, Object.fromEntries(pairs)) }
}

/** The entry for `model`: its own key, else `default`, else undefined (D7: exact match only). */
export function entryFor(table: Table, model: string): Entry | undefined {
  if (Object.hasOwn(table, model)) return table[model]
  return Object.hasOwn(table, 'default') ? table.default : undefined
}

/** A usable token count: a finite number ≥ 0 (plan v2 §9 A7). */
const isCount = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0
/** A count as summed: anything that is not a usable count is skipped (counts 0), so it never nulls priceOf. */
const n = (x: number) => (isCount(x) ? x : 0)

/** True when one of the call's four counts is not a usable count, so it will be skipped (A7). */
export const hasBadCount = (u: UsageCounts): boolean =>
  ![u.input_tokens, u.output_tokens, u.cache_read_input_tokens, u.cache_creation_input_tokens].every(isCount)

const add = (c: Counts, u: UsageCounts): Counts => ({
  input: c.input + n(u.input_tokens),
  output: c.output + n(u.output_tokens),
  cacheRead: c.cacheRead + n(u.cache_read_input_tokens),
  cacheWrite: c.cacheWrite + n(u.cache_creation_input_tokens),
})

/**
 * `spend` plus one call's usage under `model`. The call is long-context when its entry has a
 * `longContext` and input + cache read + cache write is strictly above `above` (D5). An unpriced
 * model is still recorded, under `normal`. A count that is not finite and ≥ 0 is skipped (A7).
 */
export function addUsage(spend: Spend, u: UsageCounts, model: string, table: Table): Spend {
  const lc = entryFor(table, model)?.longContext
  const isLong = lc !== undefined && n(u.input_tokens) + n(u.cache_read_input_tokens) + n(u.cache_creation_input_tokens) > lc.above
  const prev: Tiers = Object.hasOwn(spend, model) ? spend[model]! : { normal: ZERO, long: ZERO }
  const next: Tiers = isLong ? { normal: prev.normal, long: add(prev.long, u) } : { normal: add(prev.normal, u), long: prev.long }
  // fromEntries defines own properties, so a `__proto__` model id stays data
  return Object.fromEntries([...Object.entries(spend).filter(([k]) => k !== model), [model, next]])
}

const isZero = (c: Counts) => c.input === 0 && c.output === 0 && c.cacheRead === 0 && c.cacheWrite === 0
const cost = (c: Counts, r: Rates) => c.input * r.input + c.output * r.output + c.cacheRead * r.cacheRead + c.cacheWrite * r.cacheWrite

/** Models in `spend` with non-zero counts that `table` cannot price. */
export function unpricedIn(spend: Spend, table: Table): string[] {
  return Object.entries(spend)
    .filter(([m, t]) => !(isZero(t.normal) && isZero(t.long)) && entryFor(table, m) === undefined)
    .map(([m]) => m)
}

/** The spend in USD, or null when a model with non-zero counts is unpriced or the sum is not finite (D4). */
export function priceOf(spend: Spend, table: Table): number | null {
  if (unpricedIn(spend, table).length > 0) return null
  let total = 0
  for (const [m, t] of Object.entries(spend)) {
    const e = entryFor(table, m)
    if (e === undefined) continue
    total += cost(t.normal, e) + cost(t.long, e.longContext ?? e)
  }
  // @neg:cent-round
  return Number.isFinite(total) ? total / 1e6 : null
}
