# ctx-bar

A Claude Code mod that keeps the context window in the status line and updates it on every model
request of a turn, not only at its end.

```
ctx ▕██░░░░░░░░▏ 22% 45k/200k (model 1M) · cache 99% · compact in 121k · $0.36
```

| Segment | Meaning |
|---|---|
| bar, `22%`, `45k/200k` | tokens the last request was answered over, against the auto-compact window |
| `(model 1M)` | the model's own window, shown only when its k-units differ from the auto-compact window's |
| `cache 99%` | share of the last main-thread request served from the prompt cache |
| `compact in 121k` / `compact due` / `autocompact off` | headroom until auto-compaction |
| `$0.36` | session cost (turn off with `showCost`): the engine's figure, or your price table's (`costSource`) |
| `$0.36 (est $0.41)` | `costSource: both`: the engine's figure, then your table's estimate |
| `!` prefix | fill at or above `warnAt` (default 80%) |
| `ctx – /200k · compacted 182k→24k` | no reading yet: a fresh session, after `/clear`, or after a compaction (the note clears on the next response) |
| (blank) | no usable window yet, or the mod's own work failed (a `ctx-bar:` line in the debug log says why) |

Requires Claude Code 2.1.295 or later (the function-hooks API is early access; names may move).

## Use

```
claude --plugin-dir /path/to/ctx-bar
```

Options (`userConfig`):

| Option | Type, default | Meaning |
|---|---|---|
| `showCost` | boolean, `true` | show the `$` segment |
| `warnAt` | number, `80` | prefix the line with `!` at or above this fill percentage |
| `pricingFile` | string, `""` | a JSON price table (below); relative to the session's working directory, or absolute; `~` is not expanded |
| `costSource` | string, `"engine"` | `engine` (the engine's cost), `table` (your table's), or `both` (`$engine (est $table)`); any other value is `engine` |

### Custom pricing

With `costSource` set to `table` or `both`, ctx-bar prices the session itself from `pricingFile`, in USD
per million tokens:

```json
{
  "claude-opus-5-5": { "input": 5, "output": 25, "cacheRead": 0.5, "cacheWrite": 6.25 },
  "claude-sonnet-5": {
    "input": 3, "output": 15, "cacheRead": 0.3, "cacheWrite": 3.75,
    "longContext": { "above": 200000, "input": 6, "output": 22.5, "cacheRead": 0.6, "cacheWrite": 7.5 }
  },
  "default": { "input": 3, "output": 15, "cacheRead": 0.3, "cacheWrite": 3.75 }
}
```

```
claude --plugin-dir /path/to/ctx-bar --settings '{"pluginConfigs":{"ctx-bar":{"options":{"pricingFile":"/path/to/prices.json","costSource":"both"}}}}'
```

- A model is matched by its exact id (the one that answered, subagents included), else by `default`; there is no prefix match.
- `longContext` applies to a request whose input + cache-read + cache-write tokens are strictly above `above`.
- Rates are numbers from 0 to 1,000,000; `above` is a whole number of at least 1; at most 256 models.
- The file is read once, at session start. A table edit needs a new session (`/clear` keeps the table).
- If the file is missing or invalid, or a model with usage has no price and there is no `default`, the
  segment shows the engine's figure and one `ctx-bar: pricing:` line goes to the debug log.
- `/clear` and resume start the spend at zero.
- An admin-managed `modelPricing` (machine-level managed settings only) reprices the engine's own figure;
  a user-level or `--settings` one does not (spike V0). The managed path was not tested.

## How it works

- `turn.step` (main thread only): after each model response, `$.session.usage()` gives the live fill. With a
  price table, every response's usage (subagents' too) is added to the spend.
- `session.measure`: the engine's pushed figures, used as they are.
- `turn.complete`: a local `summary` breakdown refreshes the auto-compact window. `full` is never used.
- `session.compact`: shows `compacted before→after` (not for precomputes or subagents). With a price table,
  the compaction's own usage is added to the spend, precomputes' and subagents' included.
- `session.end` (`/clear`, resume): resets the live figures and keeps the window.

The mod never changes a turn: each hook calls `next` first and returns its result, and every streamed
chunk, untouched (tests E2, E7, G1–G4 assert both). Its own work runs in a guard; if that fails the
line goes blank and a `ctx-bar:` line goes to the debug log.

It can delay one: after each main-thread response the mod awaits one `$.session.usage()` call. A slow
host `session.usage()` can delay a request up to the slow-hook budget (10 s on 2.1.295); measured 0–1 ms
per call in spike 1 and V6.

## Develop

```
mkdir -p .claude-plugin/types/claude-code   # types for tsc (gitignored), from the plugin-authoring skill
cp <skill>/types/claude-code.d.ts .claude-plugin/types/claude-code/index.d.ts
claude plugin validate .
npm ci --ignore-scripts && npm run typecheck   # typescript 5.6.3, pinned and integrity-checked by package-lock.json
claude plugin test .                       # pure rows, control, mutant kill sets, engine rows
S=<scratch dir> bash scripts/neg.sh        # negative runs: each mutation must be caught
```

The expected status strings in `tests/fixtures.ts` were generated from an independent reference of the
format rules (kept with the private planning records) before the implementation existed. Because that
reference follows the same written rules, rows hand-checked against them (F12, F25–F29, F39, plus the
reviewer's spot-checks) are the cross-check against a mistake shared by both.

```
```

## Known limitations

Not yet checked in a live interactive session: real compaction figures, status-line rendering next to
a custom `statusLine`, a real subagent, hot reload, redraw cadence, per-step latency.

- Subagents are ignored by the bar: their requests don't move it (the main thread's next response includes their cost). With a price table their usage still counts toward the table's spend.
- After a `/model` switch to a model with a larger window, the bar keeps the old auto-compact window until the turn ends (LOW). A switch to a smaller window is clamped at once.
- Two updates racing can paint the older figures until the next event (LOW).
- The `compacted X→Y` note clears on the next response.
- The auto-compact threshold falls back to `rawMax − buffer` (33k on 2.1.295) when the engine gives none. That fallback is a heuristic.

Custom pricing (`costSource` `table` or `both`):

- (MED) One `cacheWrite` rate. The engine bills 5-minute and 1-hour cache writes at different rates (a 1-hour write costs 2× input), and the usage counts don't say which, so the table can drift from the engine. `costSource: both` shows the drift.
- (LOW) Resume starts the spend at zero: the mod's state is not kept across a resume.
- (LOW) Calls the mod cannot see (other plugins' model calls, side queries) are not counted.
- (LOW) Per-use fees for server-side tools are not priced, only their tokens.
- (LOW) Compaction usage names no model: it is priced at the last main-thread model, else `default`, else dropped (with a debug line).
- (LOW) A table edit needs a new session.
- (INFO) A machine-level, admin-managed `modelPricing` reprices the engine's figure; not tested.
- (LOW) If the compaction's summarizer request also reaches `turn.step`, compaction is counted twice (not checkable headless).
