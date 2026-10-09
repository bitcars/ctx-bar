// Frozen expectations from plan v2 §4 + post-approval deviation D7, generated from
// .sisyphus/plans/evidence/ref-d7.ts (an independent reference written before the implementation).
import type { View } from '../types'
import type { FormatOpts } from '../hooks/format'
import type { TurnUsage } from 'claude-code'
import type { UsageCounts } from '../hooks/pricing'

export type Fixture = { tokens: number | null; window: number; rawMax: number | null; threshold: number | null; autoOn: boolean; cachePct: number | null; cost: number | null; lastCompact: View['lastCompact'] }
export const D: Fixture = { tokens: 0, window: 200000, rawMax: 200000, threshold: 167000, autoOn: true, cachePct: null, cost: null, lastCompact: null }
export const O: FormatOpts = { showCost: true, warnAt: 80, costSource: 'engine', pricingFile: '' }
const M1 = { rawMax: 1000000, window: 1000000, threshold: 967000 }
const M2 = { rawMax: 2000000, window: 2000000, threshold: 1967000 }

export function toView(f: Fixture): View {
  return { tokens: f.tokens, window: f.window, cost: f.cost, cachePct: f.cachePct, lastCompact: f.lastCompact, win: f.rawMax === null ? null : { rawMax: f.rawMax, threshold: f.threshold, autoOn: f.autoOn }, table: null, spend: {}, warned: [], lastModel: null, tableNoted: false }
}

export type Row = { id: string; view: View; opts: FormatOpts; expected: string | undefined }
const row = (id: string, over: Partial<Fixture>, opts: Partial<FormatOpts>, expected: string | undefined): Row => ({ id, view: toView({ ...D, ...over }), opts: { ...O, ...opts }, expected })

export const F_ROWS: readonly Row[] = [
  row("F1", {tokens:null}, {}, "ctx – /200k"),
  row("F2", {tokens:0}, {}, "ctx ▕░░░░░░░░░░▏ 0% 0/200k · compact in 167k"),
  row("F3", {tokens:999}, {}, "ctx ▕░░░░░░░░░░▏ 0% 999/200k · compact in 166k"),
  row("F4", {tokens:1000}, {}, "ctx ▕░░░░░░░░░░▏ 0% 1k/200k · compact in 166k"),
  row("F5", {tokens:1499}, {}, "ctx ▕░░░░░░░░░░▏ 0% 1k/200k · compact in 165k"),
  row("F6", {tokens:1500}, {}, "ctx ▕░░░░░░░░░░▏ 0% 1k/200k · compact in 165k"),
  row("F7", {...M1,tokens:999999}, {}, "!ctx ▕█████████░▏ 99% 999k/1M · compact due"),
  row("F8", {...M1,tokens:1000000}, {}, "!ctx ▕██████████▏ 100% 1M/1M · compact due"),
  row("F9", {tokens:159999}, {}, "ctx ▕███████░░░▏ 79% 159k/200k · compact in 7k"),
  row("F10", {tokens:160000}, {}, "!ctx ▕████████░░▏ 80% 160k/200k · compact in 7k"),
  row("F11", {tokens:160001}, {}, "!ctx ▕████████░░▏ 80% 160k/200k · compact in 6k"),
  row("F12", {tokens:166999}, {}, "!ctx ▕████████░░▏ 83% 166k/200k · compact in 1"),
  row("F13", {tokens:167000}, {}, "!ctx ▕████████░░▏ 83% 167k/200k · compact due"),
  row("F14", {tokens:167001}, {}, "!ctx ▕████████░░▏ 83% 167k/200k · compact due"),
  row("F15", {tokens:233000,autoOn:false,threshold:null}, {}, "!ctx ▕██████████▏ 116% 233k/200k · autocompact off"),
  row("F16", {tokens:45335}, {}, "ctx ▕██░░░░░░░░▏ 22% 45k/200k · compact in 121k"),
  row("F17", {tokens:45335,window:1000000}, {}, "ctx ▕██░░░░░░░░▏ 22% 45k/200k (model 1M) · compact in 121k"),
  row("F18", {tokens:45335,window:200999}, {}, "ctx ▕██░░░░░░░░▏ 22% 45k/200k · compact in 121k"),
  row("F18a", {tokens:45335,window:201000}, {}, "ctx ▕██░░░░░░░░▏ 22% 45k/200k (model 201k) · compact in 121k"),
  row("F18b", {tokens:45335,window:199999}, {}, "ctx ▕██░░░░░░░░▏ 22% 45k/199k"),
  row("F19", {tokens:210000}, {}, "!ctx ▕██████████▏ 105% 210k/200k · compact due"),
  row("F22", {tokens:45335,cachePct:99}, {}, "ctx ▕██░░░░░░░░▏ 22% 45k/200k · cache 99% · compact in 121k"),
  row("F23", {tokens:45335,cachePct:null}, {}, "ctx ▕██░░░░░░░░▏ 22% 45k/200k · compact in 121k"),
  row("F24", {tokens:45335,cost:1.84}, {showCost:false}, "ctx ▕██░░░░░░░░▏ 22% 45k/200k · compact in 121k"),
  row("F24a", {tokens:45335,cost:1.84}, {}, "ctx ▕██░░░░░░░░▏ 22% 45k/200k · compact in 121k · $1.84"),
  row("F24b", {tokens:45335,cost:null}, {}, "ctx ▕██░░░░░░░░▏ 22% 45k/200k · compact in 121k"),
  row("F25", {tokens:45335,cost:1.005}, {}, "ctx ▕██░░░░░░░░▏ 22% 45k/200k · compact in 121k · $1.00"),
  row("F26", {tokens:45335,cost:0.125}, {}, "ctx ▕██░░░░░░░░▏ 22% 45k/200k · compact in 121k · $0.12"),
  row("F27", {tokens:45335,cost:0.29}, {}, "ctx ▕██░░░░░░░░▏ 22% 45k/200k · compact in 121k · $0.29"),
  row("F28", {tokens:45335,cost:0}, {}, "ctx ▕██░░░░░░░░▏ 22% 45k/200k · compact in 121k · $0.00"),
  row("F29", {tokens:45335,cost:1.8399}, {}, "ctx ▕██░░░░░░░░▏ 22% 45k/200k · compact in 121k · $1.83"),
  row("F30", {tokens:199999}, {}, "!ctx ▕█████████░▏ 99% 199k/200k · compact due"),
  row("F31", {tokens:200000}, {}, "!ctx ▕██████████▏ 100% 200k/200k · compact due"),
  row("F32", {tokens:202000}, {}, "!ctx ▕██████████▏ 101% 202k/200k · compact due"),
  row("F33", {tokens:19999}, {}, "ctx ▕░░░░░░░░░░▏ 9% 19k/200k · compact in 147k"),
  row("F34", {tokens:20000}, {}, "ctx ▕█░░░░░░░░░▏ 10% 20k/200k · compact in 147k"),
  row("F35", {tokens:189999}, {}, "!ctx ▕█████████░▏ 94% 189k/200k · compact due"),
  row("F36", {tokens:166001}, {}, "!ctx ▕████████░░▏ 83% 166k/200k · compact in 999"),
  row("F36a", {tokens:166000}, {}, "!ctx ▕████████░░▏ 83% 166k/200k · compact in 1k"),
  row("F37", {...M2,tokens:1099999}, {}, "ctx ▕█████░░░░░▏ 54% 1M/2M · compact in 867k"),
  row("F38", {...M2,tokens:1100000}, {}, "ctx ▕█████░░░░░▏ 55% 1.1M/2M · compact in 867k"),
  row("F39", {...M2,tokens:1050000}, {}, "ctx ▕█████░░░░░▏ 52% 1M/2M · compact in 917k"),
  row("F40", {tokens:179999}, {warnAt:90}, "ctx ▕████████░░▏ 89% 179k/200k · compact due"),
  row("F40a", {tokens:180000}, {warnAt:90}, "!ctx ▕█████████░▏ 90% 180k/200k · compact due"),
  row("F41", {tokens:null,lastCompact:{before:182000,after:24000}}, {}, "ctx – /200k · compacted 182k→24k"),
  row("F42", {tokens:null,lastCompact:{before:182000,after:null}}, {}, "ctx – /200k · compacted 182k→?"),
  row("F42a", {tokens:null,lastCompact:{before:null,after:null}}, {}, "ctx – /200k · compacted ?→?"),
  row("F43", {tokens:45335,window:1000000,rawMax:null,threshold:null}, {}, "ctx ▕░░░░░░░░░░▏ 4% 45k/1M"),
  row("F44", {tokens:45335,threshold:null}, {}, "ctx ▕██░░░░░░░░▏ 22% 45k/200k"),
  row("F46", {tokens:150000,rawMax:1000000,window:200000,threshold:967000}, {}, "ctx ▕███████░░░▏ 75% 150k/200k"),
  row("F47", {tokens:45335,lastCompact:{before:182000,after:24000}}, {}, "ctx ▕██░░░░░░░░▏ 22% 45k/200k · compact in 121k"),
  row("F48", {tokens:0,window:0,rawMax:null}, {}, undefined),
  row("F49", {tokens:45335,rawMax:0}, {}, undefined),
  row("F50", {tokens:45335,window:NaN,rawMax:null}, {}, undefined),
  row("F51", {tokens:45335,cost:-0.5}, {}, "ctx ▕██░░░░░░░░▏ 22% 45k/200k · compact in 121k"),
  row("F52", {tokens:45335,cost:NaN}, {}, "ctx ▕██░░░░░░░░▏ 22% 45k/200k · compact in 121k"),
  row("F45", {tokens:null,window:1000000,cost:0.51}, {}, "ctx – /200k (model 1M) · $0.51"),
]

/** Expected status strings for the engine rows (plan v2 §4d, + E12–E15 from review round 1). */
export const E_STR = {
  E1: "ctx – /200k (model 1M) · $0.00",
  E2: "ctx ▕██░░░░░░░░▏ 22% 45k/200k (model 1M) · cache 99% · compact in 121k · $0.36",
  E3: "ctx ▕██░░░░░░░░▏ 23% 46k/200k (model 1M) · cache 99% · compact in 120k · $0.51",
  E4: "ctx – /200k (model 1M) · compacted 182k→24k · $0.51",
  E4c: "ctx – /200k (model 1M) · compacted 182k→? · $0.51",
  E6: "ctx – /200k (model 1M)",
  E6s: "ctx ▕██░░░░░░░░▏ 22% 45k/200k (model 1M) · cache 99% · compact in 121k",
  E7a: "ctx ▕██░░░░░░░░▏ 22% 45k/200k (model 1M) · cache 99% · compact in 121k · $0.36",
  E7b: "ctx ▕██░░░░░░░░▏ 23% 46k/200k (model 1M) · cache 99% · compact in 120k · $0.37",
  E7c: "ctx ▕██░░░░░░░░▏ 23% 47k/200k (model 1M) · cache 99% · compact in 119k · $0.38",
  E8: "ctx ▕███░░░░░░░▏ 31% 47k/150k (model 1M) · cache 99% · compact in 69k · $0.38",
  E9: "ctx – /1M · $0.00",
  E10: "ctx ▕███████░░░▏ 75% 150k/200k · cache 99% · $0.36",
  E12: "ctx ▕████████░░▏ 89% 179k/200k (model 1M) · cache 99% · compact due",
  E12b: "!ctx ▕█████████░▏ 90% 180k/200k (model 1M) · cache 99% · compact due",
  E13: "ctx ▕█░░░░░░░░░▏ 12% 24k/200k (model 1M) · cache 99% · compact in 143k · $0.52",
  E14: "ctx ▕██░░░░░░░░▏ 23% 46k/200k (model 1M) · cache 99% · compact in 120k · $0.36",
  E15: "ctx ▕██░░░░░░░░▏ 23% 46k/200k · cache 99% · compact in 120k · $0.51",
} as const

/** Plan v2 §4c failing-ID sets, frozen before code (+ F47, F51, F52 added by D7; no existing row changed). */
export const KILL_KROUND = ["F5", "F6", "F7", "F9", "F11", "F12", "F16", "F17", "F18", "F18a", "F18b", "F22", "F23", "F24", "F24a", "F24b", "F25", "F26", "F27", "F28", "F29", "F30", "F33", "F35", "F37", "F39", "F40", "F47", "F51", "F52"] as const
export const KILL_DUEGT = ["F13"] as const

// ---- Pricing fixtures (plan ctx-bar-pricing v2): USD per million tokens.

export const TD_TEXT = '{"m-a":{"input":3,"output":15,"cacheRead":0.3,"cacheWrite":3.75,"longContext":{"above":200000,"input":6,"output":22.5,"cacheRead":0.6,"cacheWrite":7.5}},"m-b":{"input":1,"output":5,"cacheRead":0.1,"cacheWrite":1.25},"default":{"input":0.5,"output":2.5,"cacheRead":0.05,"cacheWrite":0.625}}'
export const TN_TEXT = '{"m-a":{"input":3,"output":15,"cacheRead":0.3,"cacheWrite":3.75,"longContext":{"above":200000,"input":6,"output":22.5,"cacheRead":0.6,"cacheWrite":7.5}},"m-b":{"input":1,"output":5,"cacheRead":0.1,"cacheWrite":1.25}}'

/** One answered call's usage: the four counts and the model that answered. */
export const u = (model: string, input: number, output: number, read: number, write: number): TurnUsage => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: write,
  model,
})

/** A compaction's usage, which names no model. */
export const mu = (input: number, output: number, read: number, write: number): UsageCounts => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: write,
})
