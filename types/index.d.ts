export type Win = { rawMax: number; threshold: number | null; autoOn: boolean }

export type LastCompact = { before: number | null; after: number | null }

export type View = {
  tokens: number | null
  window: number
  cost: number | null
  cachePct: number | null
  win: Win | null
  lastCompact: LastCompact | null
}

declare module 'claude-code' {
  interface PluginState {
    'ctx-bar': { view: Shaped<View> }
  }
}
