import { describe, expect, test } from 'claude-code/testing'
import type { ContextCategory, ModelUsage } from 'claude-code'

import { formatStatus, optsFrom } from '../hooks/format'
import { cachePct, windowFrom, type BreakdownWindow } from '../hooks/measure'
import { F_ROWS, KILL_DUEGT, KILL_KROUND, type Row } from './fixtures'
import { MUTANTS } from './mutants'

const failing = (fmt: (v: Row['view'], o: Row['opts']) => string | undefined) =>
  F_ROWS.filter(r => fmt(r.view, r.opts) !== r.expected).map(r => r.id)

describe('formatStatus', () => {
  for (const r of F_ROWS) {
    test(`${r.id} formatStatus`, () => {
      expect(formatStatus(r.view, r.opts)).toBe(r.expected)
    })
  }
})

const cat = (kind: ContextCategory['kind'], tokens: number): ContextCategory => ({
  name: kind === 'buffer' ? 'Autocompact buffer' : kind,
  tokens,
  color: 'inactive',
  isDeferred: kind === 'deferred',
  kind,
})
const bd = (over: Partial<BreakdownWindow>): BreakdownWindow => ({
  rawMaxTokens: 200000,
  isAutoCompactEnabled: true,
  autoCompactThreshold: undefined,
  categories: [cat('used', 40000), cat('free', 127000)],
  ...over,
})

describe('windowFrom', () => {
  test('W1 threshold given', () => {
    expect(windowFrom(bd({ autoCompactThreshold: 167000 }))).toEqual({ rawMax: 200000, threshold: 167000, autoOn: true })
  })
  test('W2 buffer heuristic 33,000', () => {
    expect(windowFrom(bd({ categories: [cat('used', 1), cat('buffer', 33000)] }))?.threshold).toBe(167000)
  })
  test('W3 buffer 32,999', () => {
    expect(windowFrom(bd({ categories: [cat('buffer', 32999)] }))?.threshold).toBe(167001)
  })
  test('W4 buffer 33,001', () => {
    expect(windowFrom(bd({ categories: [cat('buffer', 33001)] }))?.threshold).toBe(166999)
  })
  test('W5 no threshold, no buffer', () => {
    expect(windowFrom(bd({}))).toEqual({ rawMax: 200000, threshold: null, autoOn: true })
  })
  test('W6 auto-compact off', () => {
    expect(
      windowFrom(bd({ isAutoCompactEnabled: false, autoCompactThreshold: 167000, categories: [cat('buffer', 33000)] })),
    ).toEqual({ rawMax: 200000, threshold: null, autoOn: false })
  })
})

const u = (input: number, read: number, create: number): ModelUsage => ({
  input_tokens: input,
  output_tokens: 5,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: create,
})

describe('cachePct', () => {
  test('P1 floor of 99.81', () => expect(cachePct(u(2, 43917, 81), null)).toBe(99))
  test('P2 zero denominator', () => expect(cachePct(u(0, 0, 0), 97)).toBe(null))
  test('P3 null usage keeps previous', () => expect(cachePct(null, 97)).toBe(97))
  test('P4 read only', () => expect(cachePct(u(0, 100, 0), null)).toBe(100))
  test('P5 uncached only', () => expect(cachePct(u(1, 0, 0), null)).toBe(0))
  test('P6 just under 100', () => expect(cachePct(u(1, 999, 0), null)).toBe(99))
  test('P7 exactly 100', () => expect(cachePct(u(0, 1000, 0), null)).toBe(100))
})

describe('optsFrom', () => {
  test('O1 a NaN warnAt falls back to 80 (D7)', () => expect(optsFrom({ warnAt: NaN })).toMatchObject({ showCost: true, warnAt: 80 }))
  test('O2 no options: the defaults', () => expect(optsFrom({})).toMatchObject({ showCost: true, warnAt: 80 }))
  test('O3 options pass through', () => expect(optsFrom({ showCost: false, warnAt: 90 })).toMatchObject({ showCost: false, warnAt: 90 }))
})

describe('control and mutants', () => {
  test('C1 control: a wrong expectation must throw', () => {
    const f4 = F_ROWS.find(r => r.id === 'F4')
    const expected = f4?.expected
    expect(typeof expected).toBe('string')
    if (!f4 || expected === undefined) return
    expect(() => expect(formatStatus(f4.view, f4.opts)).toBe(expected.replace('1k/', '1.0k/'))).toThrow()
  })
  test('M1 kill sets: production none, dueGt and kRound exactly as frozen', () => {
    expect(failing(formatStatus)).toEqual([])
    expect(failing(MUTANTS.dueGt)).toEqual([...KILL_DUEGT])
    expect(failing(MUTANTS.kRound)).toEqual([...KILL_KROUND])
  })
})
