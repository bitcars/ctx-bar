/** USD per million tokens, per kind of token (pricing plan v2). */
export type Rates = { input: number; output: number; cacheRead: number; cacheWrite: number }
/** A price-table entry: its rates, and optionally the long-context tier's. */
export type Entry = Rates & { longContext?: Rates & { above: number } }
/** A parsed price table: model id (or `default`) → entry. */
export type Table = Record<string, Entry>
/** Integer token counts of one model, one tier. */
export type Counts = Rates
export type Tiers = { normal: Counts; long: Counts }
/** Token counts per answering model. */
export type Spend = Record<string, Tiers>

export type Win = { rawMax: number; threshold: number | null; autoOn: boolean }

export type LastCompact = { before: number | null; after: number | null }

export type View = {
  tokens: number | null
  window: number
  cost: number | null
  cachePct: number | null
  win: Win | null
  lastCompact: LastCompact | null
  /** The parsed price table, loaded once at session.start (null: none, or unusable). */
  table: Table | null
  /** Integer token counts per answering model, split by long-context tier. */
  spend: Spend
  /** Unpriced model ids already logged this session. */
  warned: string[]
  /** The last main step's answering model: compaction usage is priced at it. */
  lastModel: string | null
  /** A pricing debug line has fired, so a missing table is not reported again. */
  tableNoted: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'ctx-bar': { view: Shaped<View> }
  }
}
