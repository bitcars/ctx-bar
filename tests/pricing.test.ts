// Pricing rows (plan ctx-bar-pricing v2 §1a–§1c): PR priceOf, PT parseTable, PK the cost segment, PO options.
// Every PR/PK row asserts the full string with `toBe`.
import { describe, expect, test } from 'claude-code/testing'
import type { TurnUsage } from 'claude-code'
import { formatStatus, optsFrom, usd, type FormatOpts } from '../hooks/format'
import { addUsage, entryFor, parseTable, priceOf, type Spend, type Table } from '../hooks/pricing'
import type { View } from '../types'
import { D, O, TD_TEXT, TN_TEXT, toView, u } from './fixtures'

function table(text: string): Table {
  const r = parseTable(text)
  if (!('ok' in r)) throw new Error(`fixture table invalid: ${r.error}`)
  return r.ok
}
const TD = table(TD_TEXT)
const TN = table(TN_TEXT)

const spendOf = (t: Table, reqs: readonly TurnUsage[]): Spend => reqs.reduce<Spend>((s, r) => addUsage(s, r, r.model, t), {})
const shown = (t: Table, reqs: readonly TurnUsage[]): string | null => {
  const p = priceOf(spendOf(t, reqs), t)
  return p === null ? null : usd(p)
}
const times = (n: number, r: TurnUsage) => Array.from({ length: n }, () => r)

describe('pricing', () => {
  const PR: readonly [string, Table, readonly TurnUsage[], string | null][] = [
    ['PR1', TD, times(10, u('m-a', 12000, 4000, 150000, 20000)), '$2.16'],
    ['PR2', TD, [u('m-a', 199999, 0, 0, 0)], '$0.59'],
    ['PR3', TD, [u('m-a', 200000, 0, 0, 0)], '$0.60'],
    ['PR3b', TD, [u('m-a', 199999, 2, 0, 0)], '$0.60'],
    ['PR3c', TD, [u('m-a', 200000, 1, 0, 0)], '$0.60'],
    ['PR4', TD, [u('m-a', 200001, 0, 0, 0)], '$1.20'],
    ['PR4b', TD, [u('m-a', 1, 0, 100000, 100000)], '$0.81'],
    ['PR4c', TD, [u('m-a', 1, 10000, 150000, 50000)], '$0.69'],
    ['PR4d', TD, [u('m-a', 200001, 1000, 0, 0)], '$1.22'],
    ['PR5', TD, [u('m-b', 0, 1999, 0, 0)], '$0.00'],
    ['PR6', TD, [u('m-b', 0, 2000, 0, 0)], '$0.01'],
    ['PR7', TD, [u('m-b', 0, 2001, 0, 0)], '$0.01'],
    ['PR8', TD, [u('m-z', 1000000, 0, 0, 0)], '$0.50'],
    ['PR9', TN, [u('m-z', 1000000, 0, 0, 0)], null],
    ['PR10', TN, [u('m-a', 100000, 0, 0, 0), u('m-b', 1000000, 0, 0, 0)], '$1.30'],
    ['PR11', TD, [], '$0.00'],
    ['PR12', TD, [u('m-b', 300000, 0, 0, 0)], '$0.30'],
    ['PR13', TD, [u('m-a-2026', 1000000, 0, 0, 0)], '$0.50'],
    ['PR14', TN, [u('m-a', 1000000, 0, 0, 0), u('m-z', 1, 0, 0, 0)], null],
    ['PR14b', TN, [u('m-a', 100000, 0, 0, 0), u('m-z', 0, 0, 0, 0)], '$0.30'],
    ['PR16', TD, [u('toString', 1000000, 0, 0, 0)], '$0.50'],
    ['PR17', table('{"__proto__":{"input":2,"output":1,"cacheRead":1,"cacheWrite":1}}'), [u('__proto__', 1000000, 0, 0, 0)], '$2.00'],
  ]
  for (const [id, t, reqs, expected] of PR) test(`${id} priceOf`, () => expect(shown(t, reqs)).toBe(expected))
})

describe('parseTable', () => {
  const m = (over: Record<string, unknown>) => JSON.stringify({ m: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1, ...over } })
  const lc = (over: Record<string, unknown>) => m({ longContext: { above: 200000, input: 1, output: 1, cacheRead: 1, cacheWrite: 1, ...over } })
  const many = (n: number) => JSON.stringify(Object.fromEntries(Array.from({ length: n }, (_, i) => [`m${i}`, { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 }])))
  const err = (text: string) => parseTable(text)

  test('PT1 the TD fixture parses', () => {
    const t = table(TD_TEXT)
    expect(Object.keys(t)).toEqual(['m-a', 'm-b', 'default'])
    expect(t['m-a']?.longContext?.above).toBe(200000)
  })
  const ERR: readonly [string, string, string][] = [
    ['PT2', '[]', 'not an object'],
    ['PT3', 'null', 'not an object'],
    ['PT4', m({ input: -1 }), 'm: bad input'],
    ['PT5', m({ input: '3' }), 'm: bad input'],
    ['PT6', '{"m":{"input":1e999,"output":1,"cacheRead":1,"cacheWrite":1}}', 'm: bad input'],
    ['PT7', JSON.stringify({ m: { input: 1, cacheRead: 1, cacheWrite: 1 } }), 'm: bad output'],
    ['PT9', m({ longContext: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } }), 'm: bad longContext.above'],
    ['PT10', '{', 'not JSON'],
    ['PT12', '{"m":3}', 'm: not an object'],
    ['PT14', m({ longContext: { above: 200000, input: 1, cacheRead: 1, cacheWrite: 1 } }), 'm: bad longContext.output'],
    ['PT15', lc({ input: -1 }), 'm: bad longContext.input'],
    ['PT16', lc({ above: null }), 'm: bad longContext.above'],
    ['PT17', lc({ above: '200000' }), 'm: bad longContext.above'],
    ['PT18', lc({ above: -1 }), 'm: bad longContext.above'],
    ['PT19', lc({ above: 0 }), 'm: bad longContext.above'],
    ['PT20', lc({ above: 1.5 }), 'm: bad longContext.above'],
    ['PT21', m({ input: true }), 'm: bad input'],
    ['PT22', '{"m":[1,2,3,4]}', 'm: not an object'],
    ['PT23', m({ input: 1000001 }), 'm: bad input'],
    ['PT25', many(257), 'too many models'],
  ]
  for (const [id, text, reason] of ERR) test(`${id} rejected: ${reason}`, () => expect(err(text)).toEqual({ error: reason }))

  test('PT8 unknown entry keys are dropped', () => expect(Object.keys(table(m({ note: 'x' })).m ?? {})).toEqual(['input', 'output', 'cacheRead', 'cacheWrite']))
  test('PT11 an empty table is valid', () => expect(Object.keys(table('{}'))).toEqual([]))
  test('PT13 zero rates are valid', () => expect(table(m({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })).m?.input).toBe(0))
  test('PT23b a rate at the cap is valid', () => expect(table(m({ input: 1000000 })).m?.input).toBe(1000000))
  test('PT24 256 entries are valid', () => expect(Object.keys(table(many(256))).length).toBe(256))
  test('PT26 a leading BOM is stripped', () => {
    const t = table(`﻿${TD_TEXT}`)
    expect(Object.keys(t)).toEqual(['m-a', 'm-b', 'default'])
    expect(t['m-a']?.longContext?.above).toBe(200000)
  })
  test('PT27 a __proto__ id is an own entry', () => {
    const t = table('{"__proto__":{"input":2,"output":1,"cacheRead":1,"cacheWrite":1}}')
    expect(Object.hasOwn(t, '__proto__')).toBe(true)
    expect(entryFor(t, '__proto__')?.input).toBe(2)
    expect(entryFor(t, 'toString')).toBe(undefined)
  })
  // A7: a count that is not a finite number ≥ 0 is skipped, so one bad count never nulls the session's price
  const clean = spendOf(TD, [u('m-a', 1000, 2000, 0, 0)])
  test('PT28 a NaN or Infinity count is skipped: the sum is unchanged and priceOf stays a number', () => {
    const s = spendOf(TD, [u('m-a', 1000, 2000, 0, 0), u('m-a', NaN, 0, 0, 0), u('m-a', 0, Infinity, 0, 0)])
    expect(s).toEqual(clean)
    expect(priceOf(s, TD)).toBe(priceOf(clean, TD))
    expect(typeof priceOf(s, TD)).toBe('number')
  })
  test('PT29 a negative count is ignored', () => {
    const s = spendOf(TD, [u('m-a', 1000, 2000, 0, 0), u('m-a', 0, 0, -5e6, 0)])
    expect(s).toEqual(clean)
    expect(priceOf(s, TD)).toBe(priceOf(clean, TD))
  })
})

describe('cost segment', () => {
  const B = 'ctx ▕██░░░░░░░░▏ 22% 45k/200k · compact in 121k'
  const base = (over: Partial<View>): View => ({ ...toView({ ...D, tokens: 45335, cost: 0.36 }), table: TD, spend: spendOf(TD, times(10, u('m-a', 12000, 4000, 150000, 20000))), ...over })
  const onMz = { table: TN, spend: spendOf(TN, [u('m-z', 1000000, 0, 0, 0)]) }
  const huge: Table = Object.assign(Object.create(null) as Table, { 'm-a': { input: Number.MAX_VALUE, output: 0, cacheRead: 0, cacheWrite: 0 } })
  const PK: readonly [string, Partial<View>, Partial<FormatOpts>, string][] = [
    ['PK1', {}, { costSource: 'engine' }, `${B} · $0.36`],
    ['PK2', {}, { costSource: 'table' }, `${B} · $2.16`],
    ['PK3', {}, { costSource: 'both' }, `${B} · $0.36 (est $2.16)`],
    ['PK4', { table: null }, { costSource: 'both' }, `${B} · $0.36`],
    ['PK5', { cost: null }, { costSource: 'both' }, `${B} · $2.16`],
    ['PK6', onMz, { costSource: 'table' }, `${B} · $0.36`],
    ['PK7', {}, { costSource: 'both', showCost: false }, B],
    ['PK8', { cost: null, table: null }, { costSource: 'table' }, B],
    ['PK9', { spend: {} }, { costSource: 'table' }, `${B} · $0.00`],
    ['PK10', onMz, { costSource: 'both' }, `${B} · $0.36`],
    ['PK11', { ...onMz, cost: null }, { costSource: 'table' }, B],
    ['PK12', { table: null }, { costSource: 'table' }, `${B} · $0.36`],
    ['PK13', {}, { costSource: 'table', showCost: false }, B],
    ['PK14', { ...onMz, cost: null }, { costSource: 'both' }, B],
    ['PK15', { table: huge, spend: spendOf(huge, [u('m-a', 10, 0, 0, 0)]) }, { costSource: 'table' }, `${B} · $0.36`],
  ]
  for (const [id, over, opts, expected] of PK)
    test(`${id} cost segment`, () => {
      expect(formatStatus(base(over), { ...O, ...opts })).toBe(expected)
      // PK15: priceOf itself returns null on a non-finite sum, not only usable() in format (B-L1)
      if (id === 'PK15') expect(priceOf(spendOf(huge, [u('m-a', 10, 0, 0, 0)]), huge)).toBe(null)
    })
})

describe('pricing options', () => {
  test('PO1 defaults', () => expect(optsFrom({})).toMatchObject({ costSource: 'engine', pricingFile: '' }))
  test('PO2 values pass through', () => expect(optsFrom({ costSource: 'both', pricingFile: '/p/t.json' })).toMatchObject({ costSource: 'both', pricingFile: '/p/t.json' }))
  test('PO3 only exact values', () => expect(optsFrom({ costSource: 'TABLE' })).toMatchObject({ costSource: 'engine' }))
  test('PO4 a non-string file is none', () => expect(optsFrom({ pricingFile: 3 })).toMatchObject({ pricingFile: '' }))
})
