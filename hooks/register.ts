// ctx-bar: the context window, live, in the status line (plan v2 §2–§3).
// Lines `// @neg:<case>` are mutation points for scripts/neg.sh (V4); they do nothing.
// Every hook passes the turn through untouched: its own work runs after `next`,
// inside `guard`, and a failure there blanks the line instead of reaching the turn.
import { atom, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage, TurnUsage } from 'claude-code'
import type { View } from '../types'
import { effectiveRaw, formatStatus, optsFrom, type FormatOpts } from './format'
import { INITIAL, cachePct, cleared, windowFrom } from './measure'
import { addUsage, entryFor, hasBadCount, parseTable, type Table, type UsageCounts } from './pricing'

// v3: the view gained the price table and the spend (plan ctx-bar-pricing v2 §2, D8)
let viewShape = 'v3'
// @neg:shape-v2
const view = atom({ plugin: 'ctx-bar', key: 'view' } as const, INITIAL, { shape: viewShape })

/** `warned` holds this marker once compaction usage has been dropped for want of a model. */
// Shares `warned` with model ids; real model ids never start with '#', so a collision is unreachable (A-L3).
const DROPPED = '#compaction'
/** `warned` holds this marker once a usage count has been skipped as not finite and ≥ 0 (A7). */
const BAD_COUNT = '#bad-count'

/** An error as one short debug line: its name and the first 200 characters of its message. */
function errorLine(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message.slice(0, 200)}` : typeof err
}

/** Runs a hook's own work; on a throw, blanks the line and records why (plan v2 §3). */
async function guard($: EngineInterface, event: string, work: () => Promise<void>): Promise<void> {
  try {
    await work()
  } catch (err) {
    $.ui.log(`ctx-bar: ${event}: ${errorLine(err)}`, { to: 'debug' })
    // @neg:guard-off
    $.ui.status(undefined)
  }
}

/**
 * Draws `v` (the value just written, never a re-read) and traces it to the debug log.
 * Two writers racing can paint the older value until the next event (accepted, plan §6 D-d).
 */
function render($: EngineInterface, v: View, opts: FormatOpts): void {
  const text = formatStatus(v, opts)
  $.ui.status(text)
  $.ui.log(`ctx-bar: status: ${text ?? '(blank)'} [fill=${v.tokens} raw=${effectiveRaw(v)}]`, { to: 'debug' })
}

/** Runs pricing work that must never blank the line (a subagent's or a compaction's): a throw is logged only. */
async function quiet($: EngineInterface, event: string, work: () => Promise<void>): Promise<void> {
  try {
    await work()
  } catch (err) {
    $.ui.log(`ctx-bar: ${event}: ${errorLine(err)}`, { to: 'debug' })
  }
}

/** One `ctx-bar: pricing:` debug line. */
function pricingLog($: EngineInterface, text: string): void {
  $.ui.log(`ctx-bar: pricing: ${text}`, { to: 'debug' })
}

/** The price table named by `pricingFile` (D1, D2), or null and the fixed reason it is unusable. */
async function loadTable($: EngineInterface, file: string): Promise<{ table: Table | null; note: string | null }> {
  if (file === '') return { table: null, note: 'no pricingFile' }
  let text: string
  try {
    text = await $.fs.read(file)
  } catch {
    return { table: null, note: `${file}: read failed` }
  }
  const parsed = parseTable(text)
  return 'ok' in parsed ? { table: parsed.ok, note: null } : { table: null, note: `${file}: ${parsed.error}` }
}

/**
 * `x` with one call's usage added under `model` (no-op without a table), the unpriced ids it
 * newly warns about, and whether it skipped a bad count for the first time this session (A7).
 * A main step also records its model for pricing compaction usage.
 */
function accounted(x: View, usage: UsageCounts, model: string, isMain: boolean): { v: View; warn: string[]; bad: boolean } {
  if (x.table === null) return { v: x, warn: [], bad: false }
  const warn = entryFor(x.table, model) === undefined && !x.warned.includes(model) ? [model] : []
  const bad = hasBadCount(usage) && !x.warned.includes(BAD_COUNT)
  const v = {
    ...x,
    spend: addUsage(x.spend, usage, model, x.table),
    warned: [...x.warned, ...warn, ...(bad ? [BAD_COUNT] : [])],
    lastModel: isMain ? model : x.lastModel,
  }
  return { v, warn, bad }
}

/** The debug line for a skipped count (A7). */
const BAD_COUNT_LOG = 'usage count skipped (not a finite number ≥ 0)'

/** The live figures `usage()` carries, merged over `x`. */
function withUsage(x: View, u: SessionUsage): View {
  return { ...x, tokens: u.context.tokens ?? null, window: u.context.window, cost: u.cost?.usd ?? null }
}

/** A summary breakdown, or null when the engine refuses one (the bar then keeps its window). */
async function summary($: EngineInterface): Promise<SessionUsage | null> {
  try {
    return await $.session.usage({ breakdown: 'summary' })
  } catch (err) {
    $.ui.log(`ctx-bar: breakdown unavailable: ${errorLine(err)}`, { to: 'debug' })
    return null
  }
}

export const register: Register = (on, options) => {
  const opts = optsFrom(options)
  // Pricing work happens only when asked for: under the default `engine` source no hook makes a new `$` call.
  const priced = opts.costSource !== 'engine'

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await guard($, 'session.start', async () => {
      // @neg:v1-fs
      // @neg:v9-full
      const loaded = priced ? await loadTable($, opts.pricingFile) : null
      if (loaded?.note) pricingLog($, loaded.note)
      const u = (await summary($)) ?? (await $.session.usage())
      const b = u.context.breakdown
      const v = await update($, view, x => ({
        ...withUsage(x, u),
        win: b ? windowFrom(b) : x.win,
        ...(loaded ? { table: loaded.table, tableNoted: x.tableNoted || loaded.note !== null } : {}),
      }))
      render($, v, opts)
    })
    return r
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    // @neg:sub-skip
    if (e.agentId !== undefined) {
      // A subagent's usage counts toward spend (H2); the bar ignores subagents and is never blanked by one.
      const usage = r.usage
      if (priced && usage) {
        await quiet($, 'turn.step (subagent)', async () => {
          let warn: string[] = []
          let bad = false
          await update($, view, x => {
            const a = accounted(x, usage, usage.model, false)
            warn = a.warn
            bad = a.bad
            return a.v
          })
          if (bad) pricingLog($, BAD_COUNT_LOG)
          for (const m of warn) pricingLog($, `unpriced model ${m}`)
        })
      }
      return r
    }
    await guard($, 'turn.step', async () => {
      // @neg:live-throw
      const u = await $.session.usage()
      const usage: TurnUsage | null = r.usage
      let warn: string[] = []
      let bad = false
      let noTable = false
      const v = await update($, view, x => {
        const bar: View = { ...withUsage(x, u), cachePct: cachePct(usage, x.cachePct), lastCompact: null }
        if (!priced) return bar
        noTable = bar.table === null && !bar.tableNoted
        const a = usage ? accounted(bar, usage, usage.model, true) : { v: bar, warn: [], bad: false }
        warn = a.warn
        bad = a.bad
        return noTable ? { ...a.v, tableNoted: true } : a.v
      })
      if (noTable) pricingLog($, 'no table loaded')
      if (bad) pricingLog($, BAD_COUNT_LOG)
      for (const m of warn) pricingLog($, `unpriced model ${m}`)
      render($, v, opts)
    })
    return r
  }).catch(async function* ($, e, next) {
    return yield* next(e)
  })

  on('session.measure', async ($, e, next) => {
    const r = await next(e)
    await guard($, 'session.measure', async () => {
      const v = await update($, view, x => ({
        ...x,
        tokens: e.context.tokens ?? null,
        window: e.context.window,
        cost: e.cost?.usd ?? x.cost,
      }))
      render($, v, opts)
    })
    return r
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined) return r
    await guard($, 'turn.complete', async () => {
      const u = await summary($)
      const b = u?.context.breakdown
      const v = await update($, view, x => ({ ...(u ? withUsage(x, u) : x), win: b ? windowFrom(b) : x.win }))
      render($, v, opts)
    })
    return r
  }).catch(($, e, next) => next(e))

  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    // Compaction usage counts too, precompute and subagent ones included (H2; a reused summary reports none).
    const usage = r.skip === undefined ? r.usage : undefined
    if (priced && usage) {
      await quiet($, 'session.compact (pricing)', async () => {
        let dropped = false
        let bad = false
        await update($, view, x => {
          dropped = false
          bad = false
          if (x.table === null) return x
          const model = x.lastModel ?? (Object.hasOwn(x.table, 'default') ? 'default' : null)
          if (model !== null) {
            const a = accounted(x, usage, model, false)
            bad = a.bad
            return a.v
          }
          if (x.warned.includes(DROPPED)) return x
          dropped = true
          return { ...x, warned: [...x.warned, DROPPED] }
        })
        if (dropped) pricingLog($, 'compaction usage dropped (no model)')
        if (bad) pricingLog($, BAD_COUNT_LOG)
      })
    }
    if (e.agentId !== undefined || e.trigger === 'precompute' || r.skip !== undefined) return r
    await guard($, 'session.compact', async () => {
      const v = await update($, view, x => ({
        ...x,
        tokens: null,
        lastCompact: { before: r.tokensBefore ?? null, after: r.tokensAfter ?? null },
      }))
      render($, v, opts)
    })
    return r
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    const r = await next(e)
    if (e.reason !== 'clear' && e.reason !== 'resume') return r
    await guard($, 'session.end', async () => {
      const v = await update($, view, cleared)
      render($, v, opts)
    })
    return r
  }).catch(($, e, next) => next(e))
}
