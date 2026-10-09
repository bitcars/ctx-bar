// ctx-bar: the context window, live, in the status line (plan v2 §2–§3).
// Lines `// @neg:<case>` are mutation points for scripts/neg.sh (V4); they do nothing.
// Every hook passes the turn through untouched: its own work runs after `next`,
// inside `guard`, and a failure there blanks the line instead of reaching the turn.
import { atom, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage } from 'claude-code'
import type { View } from '../types'
import { effectiveRaw, formatStatus, optsFrom, type FormatOpts } from './format'
import { INITIAL, cachePct, cleared, windowFrom } from './measure'

const view = atom({ plugin: 'ctx-bar', key: 'view' } as const, INITIAL, { shape: 'v2' })

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

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await guard($, 'session.start', async () => {
      // @neg:v1-fs
      // @neg:v9-full
      const u = (await summary($)) ?? (await $.session.usage())
      const b = u.context.breakdown
      const v = await update($, view, x => ({ ...withUsage(x, u), win: b ? windowFrom(b) : x.win }))
      render($, v, opts)
    })
    return r
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)
    const r = yield* next(e)
    await guard($, 'turn.step', async () => {
      // @neg:live-throw
      const u = await $.session.usage()
      const v = await update($, view, x => ({
        ...withUsage(x, u),
        cachePct: cachePct(r.usage, x.cachePct),
        lastCompact: null,
      }))
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
