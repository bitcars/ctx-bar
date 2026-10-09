// Pure: the status-line text (plan v2 §1). No `$`, no state.
import type { PluginOptions } from 'claude-code'
import type { View } from '../types'
import { priceOf } from './pricing'

/** Where the `$` figure comes from: the engine's, the user's price table, or both side by side. */
export type CostSource = 'engine' | 'table' | 'both'

export type FormatOpts = { showCost: boolean; warnAt: number; costSource: CostSource; pricingFile: string }

const COST_SOURCES: readonly string[] = ['engine', 'table', 'both']

/**
 * userConfig → format options; a missing or non-finite `warnAt` is 80 (D7). `costSource` takes
 * exactly `engine`, `table` or `both`, anything else is `engine`; a non-string `pricingFile` is ''.
 */
export function optsFrom(options: PluginOptions): FormatOpts {
  const { warnAt, costSource, pricingFile } = options
  return {
    showCost: options.showCost !== false,
    warnAt: typeof warnAt === 'number' && Number.isFinite(warnAt) ? warnAt : 80,
    costSource: typeof costSource === 'string' && COST_SOURCES.includes(costSource) ? (costSource as CostSource) : 'engine',
    pricingFile: typeof pricingFile === 'string' ? pricingFile : '',
  }
}

const usable = (x: number | null): x is number => x !== null && Number.isFinite(x) && x >= 0

/**
 * The cost segment, or null. `table` falls back to the engine figure when the table cannot price
 * the spend (D4); `both` shows whichever side exists, plain, and `$e (est $t)` when both do (D3).
 */
export function costSegment(v: View, o: FormatOpts): string | null {
  if (!o.showCost) return null
  const engine = usable(v.cost) ? v.cost : null
  const priced = o.costSource !== 'engine' && v.table ? priceOf(v.spend, v.table) : null
  const table = usable(priced) ? priced : null
  if (o.costSource === 'engine') return engine === null ? null : usd(engine)
  if (o.costSource === 'table') return table !== null ? usd(table) : engine !== null ? usd(engine) : null
  if (engine !== null && table !== null) return `${usd(engine)} (est ${usd(table)})`
  return engine !== null ? usd(engine) : table !== null ? usd(table) : null
}

/** The two rules a mutant may swap (plan v2 §4c); production uses DEFAULTS. */
export type FormatRules = {
  kUnits: (n: number) => string
  isDue: (tokens: number, threshold: number) => boolean
}

/** k-units: under 1,000 the integer; under 1M `floor(n/1000)k`; else `floor(n/1e5)/10` M. */
export function k(n: number): string {
  if (n < 1000) return `${n}`
  if (n < 1_000_000) return `${Math.floor(n / 1000)}k`
  return `${Math.floor(n / 100_000) / 10}M`
}

/** `$<int>.<2 digits>`, cents floored; the epsilon keeps 0.29 from flooring to 0.28. */
export function usd(x: number): string {
  const cents = Math.floor(x * 100 + 1e-6)
  return `$${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`
}

/** 10 cells, `floor(tokens*10/raw)` filled, capped at 10. */
export function bar(tokens: number, raw: number): string {
  const filled = Math.max(0, Math.min(10, Math.floor((tokens * 10) / raw)))
  return `▕${'█'.repeat(filled)}${'░'.repeat(10 - filled)}▏`
}

/** The window the bar measures against: the compaction window, clamped to the model's. */
export function effectiveRaw(v: View): number {
  return Math.min(v.win?.rawMax ?? v.window, v.window)
}

export const DEFAULTS: FormatRules = {
  kUnits: k,
  isDue: (tokens, threshold) => tokens >= threshold,
}

/** The status text, or undefined (a blank line) when there is no usable window (D7). */
export function makeFormat(rules: FormatRules): (v: View, o: FormatOpts) => string | undefined {
  const { kUnits } = rules
  return (v, o) => {
    const raw = effectiveRaw(v)
    if (!Number.isFinite(raw) || raw <= 0) return undefined
    const isStale = v.win !== null && v.win.rawMax > v.window
    const threshold = isStale ? null : (v.win?.threshold ?? null)
    const autoOn = v.win?.autoOn ?? true
    const model = kUnits(v.window) !== kUnits(raw) ? ` (model ${kUnits(v.window)})` : ''
    const segs: string[] = []
    let head: string

    if (v.tokens === null) {
      head = `ctx – /${kUnits(raw)}${model}`
      if (v.lastCompact) {
        const { before, after } = v.lastCompact
        segs.push(`compacted ${before === null ? '?' : kUnits(before)}→${after === null ? '?' : kUnits(after)}`)
      }
    } else {
      const pct = Math.floor((v.tokens * 100) / raw)
      head = `${pct >= o.warnAt ? '!' : ''}ctx ${bar(v.tokens, raw)} ${pct}% ${kUnits(v.tokens)}/${kUnits(raw)}${model}`
      if (v.cachePct !== null) segs.push(`cache ${v.cachePct}%`)
      if (!autoOn) segs.push('autocompact off')
      else if (threshold !== null) {
        segs.push(rules.isDue(v.tokens, threshold) ? 'compact due' : `compact in ${kUnits(threshold - v.tokens)}`)
      }
    }
    const cost = costSegment(v, o)
    if (cost !== null) segs.push(cost)

    return [head, ...segs].join(' · ')
  }
}

export const formatStatus = makeFormat(DEFAULTS)
