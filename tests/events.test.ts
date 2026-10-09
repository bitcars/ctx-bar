import { describe, expect, test } from 'claude-code/testing'
import type {
  On,
  SessionCompactResult,
  SessionContextBreakdown,
  SessionEndReason,
  SessionUsage,
  TurnStepChunk,
  TurnStepResult,
  TurnUsage,
} from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { E_STR } from './fixtures'
import { TD_TEXT, TN_TEXT, mu, u } from './fixtures'

// ---- the harness (plan v2 §4d): bottom answers for every event the plugin's `next` reaches,
// and recorders for every `$` call the plugin makes. Registered before the first `$` call.
// The bottom `turn.step` streams real chunks and asks for a tool, so a hook that drops, adds
// or reorders chunks, or rewrites the result, is caught (review r1, B1).

type Bd = { rawMax: number; threshold: number | undefined; totalTokens: number } | 'deny'

type H = {
  tokens: number | undefined
  window: number
  cost: number | undefined
  bd: Bd
  usageThrows: boolean
  statusDeny: boolean
  stateDeny: boolean
  stepUsage: TurnUsage | null
  compact: SessionCompactResult
  statuses: (string | undefined)[]
  logs: { text: string; to: string }[]
  usageArgs: (string | undefined)[]
  messagesCalls: number
  nextIndex: number
  /** How many chunks the bottom had yielded when the driver received the first one (R2-1). */
  bottomYielded: number
  /** The next step ends the turn: stopReason end_turn, no tool use (R2-6). */
  finalStep: boolean
  /** The ui.status count when the bottom session.end ran (R2-5). */
  statusesAtEnd: number | undefined
  /** Pricing (plan ctx-bar-pricing v2 §1d): files the fs.read bottom serves, keyed by path. */
  files: Record<string, string>
  /** The paths `$.fs.read` asked for. */
  reads: string[]
  /** `state.get` and `state.set` calls that reached the bottom. */
  stateCalls: number
  /** `state.set` calls that reached the bottom. */
  sets: number
  /** A stored payload `state.get` answers until the first `state.set` (PX10). */
  seed: unknown
}

const MSG = [{ role: 'user' as const, text: 'summary', toolUses: [] }]

/** What the bottom streams for every step: two text pieces, one carrying a ref. */
const CHUNKS: readonly TurnStepChunk[] = [
  { kind: 'text', index: 0, text: 'Running ', ref: 1 },
  { kind: 'text', index: 0, text: 'echo.' },
]

const BD: Bd = { rawMax: 200000, threshold: 167000, totalTokens: 38420 }

const turnUsage = (input: number, read: number, create: number): TurnUsage => ({
  input_tokens: input,
  output_tokens: 74,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: create,
  model: 'claude-test',
})

function breakdown(b: Exclude<Bd, 'deny'>): SessionContextBreakdown {
  return {
    categories: [
      { name: 'Messages', tokens: b.totalTokens, color: 'inactive', isDeferred: false, kind: 'used' },
      { name: 'Autocompact buffer', tokens: 33000, color: 'inactive', isDeferred: false, kind: 'buffer' },
    ],
    totalTokens: b.totalTokens,
    maxTokens: b.rawMax,
    rawMaxTokens: b.rawMax,
    autocompactSource: 'env',
    percentage: Math.floor((b.totalTokens * 100) / b.rawMax),
    gridRows: [],
    model: 'claude-test',
    memoryFiles: [],
    mcpTools: [],
    agents: [],
    autoCompactThreshold: b.threshold,
    isAutoCompactEnabled: true,
    apiUsage: null,
  }
}

/** The step result the bottom returns: a tool-use step, so the turn would go on. */
function canned(turnId: string, index: number, usage: TurnUsage | null, isFinal = false): TurnStepResult {
  return isFinal
    ? { turnId, index, answer: 'Running echo.', toolUses: [], stopReason: 'end_turn', usage }
    : {
        turnId,
        index,
        answer: 'Running echo.',
        toolUses: [{ name: 'Bash', input: { command: 'echo step1' } }],
        stopReason: 'tool_use',
        usage,
      }
}

function harness(on: On): H {
  const h: H = {
    tokens: undefined,
    window: 1_000_000,
    cost: 0,
    bd: BD,
    usageThrows: false,
    statusDeny: false,
    stateDeny: false,
    stepUsage: turnUsage(2, 43917, 81),
    compact: { messages: MSG, tokensBefore: 182000, tokensAfter: 24000 },
    statuses: [],
    logs: [],
    usageArgs: [],
    messagesCalls: 0,
    nextIndex: 0,
    bottomYielded: 0,
    finalStep: false,
    statusesAtEnd: undefined,
    files: {},
    reads: [],
    stateCalls: 0,
    sets: 0,
    seed: undefined,
  }

  on('session.usage', ($, e) => {
    h.usageArgs.push(e.breakdown)
    // R2-2: no hook may ask for a 'full' breakdown, in any engine test (a failed check in a hook fails the test)
    expect(e.breakdown).not.toBe('full')
    if (h.usageThrows) throw new Error('usage boom')
    if (e.breakdown !== undefined && h.bd === 'deny') return { deny: 'no breakdown here' }
    const value: SessionUsage = {
      startedAt: 0,
      context: {
        window: h.window,
        ...(h.tokens === undefined ? {} : { tokens: h.tokens, percent: Math.floor((h.tokens * 100) / h.window) }),
        ...(e.breakdown !== undefined && h.bd !== 'deny' ? { breakdown: breakdown(h.bd) } : {}),
      },
      rateLimits: [],
      ...(h.cost === undefined ? {} : { cost: { usd: h.cost } }),
    }
    return { value }
  })
  on('state.set', ($, e, next) => { h.stateCalls += 1; h.sets += 1; return h.stateDeny ? { deny: 'state refused' } : next(e) })
  on('state.get', ($, e, next) => {
    h.stateCalls += 1
    return h.seed !== undefined && h.sets === 0 ? { value: { value: h.seed as never, version: 0 } } : next(e)
  })
  on('fs.read', ($, e) => {
    // The engine hands the hook the resolved path: a relative pricingFile arrives under the working directory.
    h.reads.push(e.path)
    const key = Object.keys(h.files).find(k => e.path === k || (!k.startsWith('/') && e.path.endsWith(`/${k}`)))
    const text = key === undefined ? undefined : h.files[key]
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: text }
  })
  on('session.messages', () => {
    h.messagesCalls += 1
    return { value: [] }
  })
  on('ui.status', ($, e) => {
    h.statuses.push(e.text)
    return h.statusDeny ? { deny: 'status refused' } : { value: undefined }
  })
  on('ui.log', ($, e) => {
    h.logs.push({ text: e.text, to: e.to })
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.compact', () => h.compact)
  on('session.end', ($, e) => {
    h.statusesAtEnd = h.statuses.length
    return { sessionId: e.sessionId }
  })
  on('turn.step', async function* ($, e) {
    h.bottomYielded = 0
    for (const chunk of CHUNKS) {
      h.bottomYielded += 1
      yield chunk
    }
    return canned(e.turnId, e.index, h.stepUsage, h.finalStep)
  })

  return h
}

// ---- drivers: the engine's own call sites

async function start($: Engine) {
  return $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
}

type Stepped = { index: number; chunks: TurnStepChunk[]; r: TurnStepResult; yieldedAtFirst: number; isFinal: boolean }

async function step($: Engine, h: H, agentId?: string): Promise<Stepped> {
  const index = h.nextIndex++
  const stream = $.turn.step({ turnId: 't1', index, model: 'claude-test', messageCount: 10 + index, ...(agentId ? { agentId } : {}) })
  const chunks: TurnStepChunk[] = []
  const isFinal = h.finalStep
  let yieldedAtFirst = -1
  for (;;) {
    const it = await stream.next()
    if (it.done) return { index, chunks, r: it.value, yieldedAtFirst, isFinal }
    if (chunks.length === 0) yieldedAtFirst = h.bottomYielded
    chunks.push(it.value)
  }
}

/**
 * The step reached the engine exactly as the bottom produced it: every chunk, in order, as it
 * streamed (the first arrived before the bottom yielded the second, R2-1), and the result.
 */
function expectUntouched(s: Stepped, h: H) {
  expect(s.chunks).toEqual([...CHUNKS])
  expect(s.yieldedAtFirst).toBe(1)
  expect(s.r).toEqual(canned('t1', s.index, h.stepUsage, s.isFinal))
}

async function measure($: Engine, h: H, tokens: number | undefined, cost: number | undefined, window = h.window) {
  h.tokens = tokens
  h.cost = cost
  h.window = window
  return $.session.measure({
    context: { window, ...(tokens === undefined ? {} : { tokens, percent: Math.floor((tokens * 100) / window) }) },
    rateLimits: [],
    ...(cost === undefined ? {} : { cost: { usd: cost } }),
    changed: ['context', 'cost'],
  })
}

async function complete($: Engine, agentId?: string) {
  return $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer', ...(agentId ? { agentId } : {}) })
}

async function compact($: Engine, trigger: 'manual' | 'precompute', agentId?: string) {
  return $.session.compact({ trigger, messages: MSG, ...(agentId ? { agentId } : {}) })
}

async function end($: Engine, reason: SessionEndReason) {
  return $.session.end({ reason, sessionId: 's1', resume: { id: 's1' } })
}

/** E1 then E2: start (no tokens yet), then one main step at 45,335. Two statuses. */
async function toE2($: Engine, h: H): Promise<Stepped> {
  await start($)
  h.tokens = 45335
  h.cost = 0.36
  h.bd = { rawMax: 200000, threshold: 167000, totalTokens: 50336 }
  return step($, h)
}

/** E2 then a measure at 46,800 / $0.51. Three statuses. */
async function toE3($: Engine, h: H) {
  await toE2($, h)
  await measure($, h, 46800, 0.51)
}

const last = (h: H) => h.statuses[h.statuses.length - 1]

describe('events', () => {
  test('E1 session.start renders the empty bar against the compaction window', async ($, on) => {
    const h = harness(on)
    await start($)
    expect(h.statuses).toEqual([E_STR.E1])
    expect(h.usageArgs).toEqual(['summary'])
  })

  test('E2 a main step renders usage() tokens, not the step sum or the breakdown, and passes the step through', async ($, on) => {
    const h = harness(on)
    const s = await toE2($, h)
    expectUntouched(s, h)
    expect(h.statuses).toEqual([E_STR.E1, E_STR.E2])
    expect(h.usageArgs).toEqual(['summary', undefined])
  })

  test('E3 session.measure renders pushed values with no usage() call', async ($, on) => {
    const h = harness(on)
    await toE2($, h)
    const before = last(h) ?? ''
    expect(before.includes('46k') || before.includes('$0.51')).toBe(false)
    const calls = h.usageArgs.length
    await measure($, h, 46800, 0.51)
    expect(h.statuses.length).toBe(3)
    expect(last(h)).toBe(E_STR.E3)
    expect(h.usageArgs.length).toBe(calls)
  })

  test('E4 a manual compaction shows before→after', async ($, on) => {
    const h = harness(on)
    await toE3($, h)
    await compact($, 'manual')
    expect(h.statuses.length).toBe(4)
    expect(last(h)).toBe(E_STR.E4)
  })

  for (const [id, trigger, agentId] of [['E4a', 'precompute', undefined], ['E4b', 'manual', 'a1']] as const) {
    test(`${id} a ${agentId ? 'subagent' : 'precompute'} compaction neither renders nor writes the bar`, async ($, on) => {
      const h = harness(on)
      await toE3($, h)
      h.compact = { messages: MSG, tokensBefore: 182000 }
      await compact($, trigger, agentId)
      expect(h.statuses.length).toBe(3)
      // a measure with no tokens shows whatever compaction note the state holds: there must be none
      await measure($, h, undefined, 0.51)
      expect(h.statuses.length).toBe(4)
      expect(last(h)).toBe('ctx – /200k (model 1M) · $0.51')
      // ...and the cache figure was not touched either (R2-3)
      await measure($, h, 46800, 0.51)
      expect(last(h)).toBe(E_STR.E3)
    })
  }

  test('E4c an absent tokensAfter shows ?', async ($, on) => {
    const h = harness(on)
    await toE3($, h)
    h.compact = { messages: MSG, tokensBefore: 182000 }
    await compact($, 'manual')
    expect(h.statuses.length).toBe(4)
    expect(last(h)).toBe(E_STR.E4c)
  })

  test('E5 a skipped compaction changes nothing', async ($, on) => {
    const h = harness(on)
    await toE3($, h)
    h.compact = { skip: 'vetoed' }
    await compact($, 'manual')
    expect(h.statuses.length).toBe(3)
  })

  for (const [id, reason] of [['E6', 'clear'], ['E6b', 'resume']] as const) {
    test(`${id} session.end(${reason}) resets, keeps the window, and the next step needs no session.start`, async ($, on) => {
      const h = harness(on)
      await toE2($, h)
      const argsAtE2 = h.usageArgs.length
      await end($, reason)
      expect(h.statusesAtEnd).toBe(2) // next(e) ran before any render (R2-5)
      expect(h.statuses.length).toBe(3)
      expect(last(h)).toBe(E_STR.E6)
      h.tokens = 45335
      h.cost = undefined
      await step($, h)
      expect(h.statuses.length).toBe(4)
      expect(last(h)).toBe(E_STR.E6s)
      expect(h.usageArgs.slice(argsAtE2)).toEqual([undefined])
    })
  }

  test('E6c session.end for another reason renders nothing', async ($, on) => {
    const h = harness(on)
    await toE2($, h)
    await end($, 'other')
    expect(h.statuses.length).toBe(2)
  })

  test('E7 the bar changes on every step of a multi-step tool loop, each step passed through', async ($, on) => {
    const h = harness(on)
    await start($)
    for (const [tokens, cost, isFinal] of [[45335, 0.36, false], [46500, 0.37, false], [47700, 0.38, true]] as const) {
      h.tokens = tokens
      h.cost = cost
      h.finalStep = isFinal // the last step answers with no tool use and must render too (R2-6)
      expectUntouched(await step($, h), h)
    }
    expect(h.statuses).toEqual([E_STR.E1, E_STR.E7a, E_STR.E7b, E_STR.E7c])
  })

  test('E8 turn.complete refreshes the compaction window from a summary breakdown', async ($, on) => {
    const h = harness(on)
    await start($)
    for (const [tokens, cost] of [[45335, 0.36], [46500, 0.37], [47700, 0.38]] as const) {
      h.tokens = tokens
      h.cost = cost
      await step($, h)
    }
    h.bd = { rawMax: 150000, threshold: 117000, totalTokens: 50000 }
    await complete($)
    expect(h.statuses.length).toBe(5)
    expect(last(h)).toBe(E_STR.E8)
    expect(h.usageArgs[h.usageArgs.length - 1]).toBe('summary')
    expect(h.usageArgs.includes('full')).toBe(false)
  })

  test('E9 a refused breakdown at start falls back to the model window, not a blank line', async ($, on) => {
    const h = harness(on)
    h.bd = 'deny'
    await start($)
    expect(h.statuses).toEqual([E_STR.E9])
    expect(h.usageArgs).toEqual(['summary', undefined])
    expect(h.logs.filter(l => l.text.startsWith('ctx-bar: session.start:'))).toEqual([])
    const unavailable = h.logs.filter(l => l.text.startsWith('ctx-bar: breakdown unavailable:'))
    expect(unavailable.length).toBe(1)
    expect(unavailable[0]?.to).toBe('debug')
  })

  test('E10 a smaller model window clamps the bar and drops the stale threshold', async ($, on) => {
    const h = harness(on)
    h.bd = { rawMax: 1_000_000, threshold: 967000, totalTokens: 38420 }
    await start($)
    h.window = 200000
    h.tokens = 150000
    h.cost = 0.36
    await step($, h)
    expect(h.statuses.length).toBe(2)
    expect(last(h)).toBe(E_STR.E10)
  })

  test('E11 a subagent turn.complete does no work', async ($, on) => {
    const h = harness(on)
    await toE2($, h)
    const calls = h.usageArgs.length
    await complete($, 'a1')
    expect(h.usageArgs.length).toBe(calls)
    expect(h.statuses.length).toBe(2)
  })

  for (const [id, tokens] of [['E12', 179999], ['E12b', 180000]] as const) {
    test(`${id} userConfig showCost false and warnAt 90 reach the line (${tokens})`, { options: { showCost: false, warnAt: 90 } }, async ($, on) => {
      const h = harness(on)
      await start($)
      h.tokens = tokens
      h.cost = 0.36
      await step($, h)
      expect(h.statuses.length).toBe(2)
      expect(last(h)).toBe(E_STR[id])
    })
  }

  test('E13 the step after a compaction clears the compaction note', async ($, on) => {
    const h = harness(on)
    await toE3($, h)
    await compact($, 'manual')
    expect(last(h)).toBe(E_STR.E4)
    h.tokens = 24000
    h.cost = 0.52
    await step($, h)
    expect(h.statuses.length).toBe(5)
    expect(last(h)).toBe(E_STR.E13)
    // a tokens-less measure shows whatever note the state still holds: the step must have cleared it (R2-7)
    await measure($, h, undefined, 0.52)
    expect(last(h)).toBe('ctx – /200k (model 1M) · $0.52')
  })

  test('E14 a measure without cost keeps the last cost', async ($, on) => {
    const h = harness(on)
    await toE2($, h)
    await measure($, h, 46800, undefined)
    expect(h.statuses.length).toBe(3)
    expect(last(h)).toBe(E_STR.E14)
  })

  test('E15 a measure with a new model window takes it', async ($, on) => {
    const h = harness(on)
    await toE2($, h)
    await measure($, h, 46800, 0.51, 200000)
    expect(h.statuses.length).toBe(3)
    expect(last(h)).toBe(E_STR.E15)
  })
})

describe('blank', () => {
  test('E16 a measure with no usable window blanks the line (D7, R2-4)', async ($, on) => {
    const h = harness(on)
    await toE2($, h)
    await measure($, h, undefined, 0.36, 0)
    expect(h.statuses.length).toBe(3)
    expect(h.statuses[2]).toBe(undefined)
  })
})

describe('guard', () => {
  test('G1 a throwing hook body blanks the line, logs, and leaves the step untouched', async ($, on) => {
    const h = harness(on)
    await toE2($, h)
    expect(last(h)).toBe(E_STR.E2)
    const n = h.statuses.length
    h.usageThrows = true
    const s = await step($, h)
    expectUntouched(s, h)
    expect(h.statuses.length).toBe(n + 1)
    expect(h.statuses[n]).toBe(undefined)
    const guardLogs = h.logs.filter(l => /^ctx-bar: turn\.step: /.test(l.text))
    expect(guardLogs.length).toBe(1)
    expect(guardLogs[0]?.to).toBe('debug')
    // errorLine: `<name>: <message, at most 200 characters>` (the kit reports a throwing test hook as a HooksError)
    expect(guardLogs[0]?.text ?? '').toMatch(/^ctx-bar: turn\.step: HooksError: [\s\S]{1,200}$/)
  })

  test('G2 presence control: the same shape without a throw writes a status and passes the step through', async ($, on) => {
    const h = harness(on)
    await toE2($, h)
    const n = h.statuses.length
    const s = await step($, h)
    expectUntouched(s, h)
    expect(h.statuses.length).toBe(n + 1)
    expect(h.statuses[n]).toContain('%')
  })

  test('G3 a subagent step does no work and is passed through; the next main step does exactly its own', async ($, on) => {
    const h = harness(on)
    await start($)
    const counts = () => [h.usageArgs.length, h.statuses.length, h.logs.length, h.messagesCalls]
    const [u0, s0, l0, m0] = counts()
    expectUntouched(await step($, h, 'a1'), h)
    expect(counts()).toEqual([u0, s0, l0, m0])
    h.tokens = 45335
    expectUntouched(await step($, h), h)
    const [u1, s1] = counts()
    expect(u1).toBe((u0 ?? 0) + 1)
    expect(s1).toBe((s0 ?? 0) + 1)
  })

  test('G4 recovery refusal: a refused status during recovery still leaves the step untouched', async ($, on) => {
    const h = harness(on)
    await toE2($, h)
    h.statusDeny = true
    h.usageThrows = true
    expectUntouched(await step($, h), h)
  })

  const NON_STEP = [
    ['G5a', 'session.start', ($: Engine) => start($), { cwd: '/w' }],
    ['G5b', 'session.measure', ($: Engine, h: H) => measure($, h, 46800, 0.51), { changed: ['context', 'cost'] }],
    ['G5c', 'turn.complete', ($: Engine) => complete($), { text: 'ok' }],
    ['G5d', 'session.compact', ($: Engine) => compact($, 'manual'), { messages: MSG, tokensBefore: 182000, tokensAfter: 24000 }],
    ['G5e', 'session.end', ($: Engine) => end($, 'clear'), { sessionId: 's1' }],
  ] as const

  for (const [id, event, run, expected] of NON_STEP) {
    test(`${id} a failing ${event} body blanks the line, logs once, and returns the event's result`, async ($, on) => {
      const h = harness(on)
      await toE2($, h)
      h.stateDeny = true
      const n = h.statuses.length
      const r = await run($, h)
      expect(r).toEqual(expected)
      expect(h.statuses.length).toBe(n + 1)
      expect(h.statuses[n]).toBe(undefined)
      const guardLogs = h.logs.filter(l => l.text.startsWith(`ctx-bar: ${event}: `))
      expect(guardLogs.length).toBe(1)
      expect(guardLogs[0]?.to).toBe('debug')
    })
  }
})

// ---- Pricing event rows (plan ctx-bar-pricing v2 §1d). h.cost is 0.36 before start; rows assert after the first step.
describe('pricing events', () => {
  const T = { pricingFile: 't.json', costSource: 'table' } as const
  const S1 = u('m-a', 12000, 4000, 150000, 20000)
  const ZERO_A = u('m-a', 0, 0, 0, 0)
  const pricingLogs = (h: H) => {
    const ls = h.logs.filter(l => l.text.startsWith('ctx-bar: pricing'))
    for (const l of ls) expect(l.to).toBe('debug')
    return ls.map(l => l.text)
  }
  const guardLogs = (h: H) => h.logs.filter(l => /^ctx-bar: (session|turn)\.[a-z]+: /.test(l.text))
  const ends = (h: H, tail: string) => expect(last(h)?.endsWith(tail)).toBe(true)
  const setup = (on: On, text: string | null = TD_TEXT, path = 't.json') => {
    const h = harness(on)
    h.cost = 0.36
    if (text !== null) h.files[path] = text
    return h
  }
  const stepWith = async ($: Engine, h: H, usage: TurnUsage, agentId?: string) => {
    h.stepUsage = usage
    return step($, h, agentId)
  }
  const compactWith = async ($: Engine, h: H, usage: ReturnType<typeof mu>, trigger: 'manual' | 'precompute' = 'manual', agentId?: string) => {
    h.compact = { messages: MSG, tokensBefore: 182000, tokensAfter: 24000, usage }
    return compact($, trigger, agentId)
  }
  /** PX1's sequence: start, then one main step with S1 ($0.216). */
  const px1 = async ($: Engine, h: H) => {
    await start($)
    return stepWith($, h, S1)
  }

  test('PX1 a good table prices the main step by the answering model', { options: T }, async ($, on) => {
    const h = setup(on)
    const s = await px1($, h)
    expect(h.reads.length).toBe(1)
    expect(h.reads[0]?.endsWith('/t.json')).toBe(true)
    expect(s.r.usage?.model).toBe('m-a')
    expect(s.r.usage?.model).not.toBe('claude-test') // the request's e.model
    ends(h, ' · $0.21')
    expect(pricingLogs(h)).toEqual([])
  })

  test('PX2 subagent usage counts toward spend; the subagent step writes no status', { options: T }, async ($, on) => {
    const h = setup(on)
    await start($)
    const n = h.statuses.length
    await stepWith($, h, S1, 'a1')
    expect(h.statuses.length).toBe(n)
    await stepWith($, h, S1)
    ends(h, ' · $0.43')
  })

  for (const [id, text, reason] of [['PX3', '{', 't.json: not JSON'], ['PX4', null, 't.json: read failed']] as const) {
    test(`${id} an unusable table shows the engine figure and logs once`, { options: T }, async ($, on) => {
      const h = setup(on, text)
      await start($)
      const n = h.statuses.length
      for (let i = 0; i < 3; i++) await stepWith($, h, S1)
      expect(h.statuses.length).toBe(n + 3)
      for (const st of h.statuses.slice(1)) expect(st?.endsWith(' · $0.36')).toBe(true)
      expect(pricingLogs(h)).toEqual([`ctx-bar: pricing: ${reason}`])
    })
  }

  test('PX5 compaction usage is priced at the last main model', { options: T }, async ($, on) => {
    const h = setup(on)
    await px1($, h)
    await compactWith($, h, mu(0, 1000, 0, 0))
    await stepWith($, h, ZERO_A)
    ends(h, ' · $0.23')
  })

  test('PX5b precompute and subagent compaction usage count, and draw nothing', { options: T }, async ($, on) => {
    const h = setup(on)
    await px1($, h)
    const n = h.statuses.length
    await compactWith($, h, mu(0, 1000, 0, 0), 'precompute')
    await compactWith($, h, mu(0, 1000, 0, 0), 'manual', 'a1')
    expect(h.statuses.length).toBe(n)
    await stepWith($, h, ZERO_A)
    ends(h, ' · $0.24')
  })

  test('PX5c a subagent step does not set the model compaction is priced at', { options: T }, async ($, on) => {
    const h = setup(on)
    await px1($, h)
    await stepWith($, h, u('m-b', 0, 0, 0, 0), 'a1')
    await compactWith($, h, mu(0, 1000, 0, 0))
    await stepWith($, h, ZERO_A)
    ends(h, ' · $0.23')
  })

  test('PX5d compaction before any main step is priced at default', { options: T }, async ($, on) => {
    const h = setup(on)
    await start($)
    await compactWith($, h, mu(0, 1000000, 0, 0))
    await stepWith($, h, ZERO_A)
    ends(h, ' · $2.50')
  })

  test('PX5e compaction usage with no model and no default is dropped, logged once, and the table stays', { options: T }, async ($, on) => {
    const h = setup(on, TN_TEXT)
    await start($)
    await compactWith($, h, mu(0, 1000, 0, 0))
    await compactWith($, h, mu(0, 1000, 0, 0))
    await stepWith($, h, S1)
    expect(pricingLogs(h)).toEqual(['ctx-bar: pricing: compaction usage dropped (no model)'])
    ends(h, ' · $0.21')
  })

  test('PX5f a compaction is added once, not once per later step', { options: T }, async ($, on) => {
    const h = setup(on)
    await px1($, h)
    await compactWith($, h, mu(0, 1000, 0, 0))
    await stepWith($, h, ZERO_A)
    ends(h, ' · $0.23')
    await stepWith($, h, ZERO_A)
    ends(h, ' · $0.23')
  })

  test('PX6 /clear resets spend and keeps the table without re-reading it', { options: T }, async ($, on) => {
    const h = setup(on)
    await px1($, h)
    await end($, 'clear')
    await stepWith($, h, S1)
    ends(h, ' · $0.21')
    expect(h.reads.length).toBe(1)
  })

  test('PX7 an unpriced model shows the engine figure and is logged once per id', { options: T }, async ($, on) => {
    const h = setup(on, TN_TEXT)
    await start($)
    const n = h.statuses.length
    await stepWith($, h, u('m-z', 1, 0, 0, 0))
    await stepWith($, h, u('m-z', 1, 0, 0, 0))
    await stepWith($, h, u('m-y', 1, 0, 0, 0))
    expect(h.statuses.length).toBe(n + 3)
    for (const st of h.statuses.slice(1)) expect(st?.endsWith(' · $0.36')).toBe(true)
    expect(pricingLogs(h)).toEqual(['ctx-bar: pricing: unpriced model m-z', 'ctx-bar: pricing: unpriced model m-y'])
  })

  test('PX7b /clear resets the logged ids', { options: T }, async ($, on) => {
    const h = setup(on, TN_TEXT)
    await start($)
    await stepWith($, h, u('m-z', 1, 0, 0, 0))
    await end($, 'clear')
    await stepWith($, h, u('m-z', 1, 0, 0, 0))
    expect(pricingLogs(h)).toEqual(['ctx-bar: pricing: unpriced model m-z', 'ctx-bar: pricing: unpriced model m-z'])
  })

  test('PX8 the engine source reads no file and makes no extra state call', { options: { pricingFile: 't.json' } }, async ($, on) => {
    const h = setup(on)
    await px1($, h)
    expect(h.reads).toEqual([])
    ends(h, ' · $0.36')
    // start and one step: one update each (a get and a set); the {} baseline is PX8b
    expect(h.stateCalls).toBe(4)
  })

  test('PX8b baseline: {} options, the same sequence, makes 4 state calls', async ($, on) => {
    const h = setup(on)
    await px1($, h)
    expect(h.stateCalls).toBe(4)
  })

  test('PX9 table source without a file shows the engine figure and says so once', { options: { costSource: 'table' } }, async ($, on) => {
    const h = setup(on)
    await start($)
    const n = h.statuses.length
    await stepWith($, h, S1)
    expect(h.statuses.length).toBe(n + 1)
    ends(h, ' · $0.36')
    expect(pricingLogs(h)).toEqual(['ctx-bar: pricing: no pricingFile'])
  })

  test('PX10 a value stored under shape v2 is dropped, not read (D8)', { options: { pricingFile: 't.json', costSource: 'both' } }, async ($, on) => {
    const h = setup(on, TN_TEXT)
    h.seed = { shape: 'v2', value: { tokens: 1000, window: 200000, cost: 9.99, cachePct: 42, win: { rawMax: 200000, threshold: 167000, autoOn: true }, lastCompact: null } }
    await start($)
    await stepWith($, h, u('m-z', 0, 0, 0, 0))
    await stepWith($, h, S1)
    expect(guardLogs(h)).toEqual([])
    expect(pricingLogs(h)).toEqual(['ctx-bar: pricing: unpriced model m-z'])
    ends(h, ' · $0.36 (est $0.21)')
  })

  test('PX11 both sources side by side', { options: { pricingFile: 't.json', costSource: 'both' } }, async ($, on) => {
    const h = setup(on)
    await px1($, h)
    ends(h, ' · $0.36 (est $0.21)')
  })

  test('PX12 under default options a subagent step makes no state call', async ($, on) => {
    const h = setup(on)
    await start($)
    const n = h.stateCalls
    await stepWith($, h, S1, 'a1')
    expect(h.stateCalls).toBe(n)
  })

  test('PX12p presence: with a table a subagent step makes state calls', { options: T }, async ($, on) => {
    const h = setup(on)
    await start($)
    const n = h.stateCalls
    await stepWith($, h, S1, 'a1')
    expect(h.stateCalls).toBeGreaterThan(n)
  })

  test('PX13 a refused write on a subagent step logs and never blanks the bar', { options: T }, async ($, on) => {
    const h = setup(on)
    await start($)
    const n = h.statuses.length
    h.stateDeny = true
    await stepWith($, h, S1, 'a1')
    expect(h.statuses.length).toBe(n)
    const sub = h.logs.filter(l => /^ctx-bar: turn\.step \(subagent\): /.test(l.text))
    expect(sub.length).toBe(1)
    expect(sub[0]?.to).toBe('debug')
  })

  test('PX14 no table loaded (as after a hot reload) is said once', { options: T }, async ($, on) => {
    const h = setup(on)
    await stepWith($, h, S1)
    await stepWith($, h, S1)
    expect(h.statuses.length).toBe(2)
    for (const st of h.statuses) expect(st?.endsWith(' · $0.36')).toBe(true)
    expect(pricingLogs(h)).toEqual(['ctx-bar: pricing: no table loaded'])
  })

  test('PX15 an absolute pricingFile is read as given (exact path, no suffix match)', { options: { pricingFile: '/abs/t.json', costSource: 'table' } }, async ($, on) => {
    const h = setup(on, TD_TEXT, '/abs/t.json')
    await px1($, h)
    expect(h.reads).toEqual(['/abs/t.json'])
    ends(h, ' · $0.21')
  })

  test('PX16 a bad usage count is skipped, the bar keeps drawing, and it is logged once (A7)', { options: T }, async ($, on) => {
    const h = setup(on)
    await start($)
    const n = h.statuses.length
    const before = last(h)
    // a large bad count would move the figure if it were summed (-1e9 input is -$3000 on m-a)
    await stepWith($, h, u('m-a', -1e9, 0, 0, 0))
    expect(last(h)).toBe(before)
    await stepWith($, h, u('m-a', NaN, 0, 0, 0))
    await stepWith($, h, u('m-a', 0, -1, 0, 0), 'a1')
    await stepWith($, h, S1)
    expect(h.statuses.length).toBe(n + 3)
    ends(h, ' · $0.21')
    expect(pricingLogs(h)).toEqual(['ctx-bar: pricing: usage count skipped (not a finite number ≥ 0)'])
  })
})
