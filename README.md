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
| `$0.36` | session cost (turn off with `showCost`) |
| `!` prefix | fill at or above `warnAt` (default 80%) |
| `ctx – /200k · compacted 182k→24k` | no reading yet: a fresh session, after `/clear`, or after a compaction (the note clears on the next response) |
| (blank) | no usable window yet, or the mod's own work failed (a `ctx-bar:` line in the debug log says why) |

Requires Claude Code 2.1.295 or later (the function-hooks API is early access; names may move).

## Use

```
claude --plugin-dir /path/to/ctx-bar
```

Options (`userConfig`): `showCost` (boolean, default true), `warnAt` (number, default 80).

## How it works

- `turn.step` (main thread only): after each model response, `$.session.usage()` gives the live fill.
- `session.measure`: the engine's pushed figures, used as they are.
- `turn.complete`: a local `summary` breakdown refreshes the auto-compact window. `full` is never used.
- `session.compact`: shows `compacted before→after` (not for precomputes or subagents).
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
npx -y -p typescript@5.6.3 tsc -p .
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

- Subagents are ignored: their requests don't move the bar (the main thread's next response includes their cost).
- After a `/model` switch to a model with a larger window, the bar keeps the old auto-compact window until the turn ends (LOW). A switch to a smaller window is clamped at once.
- Two updates racing can paint the older figures until the next event (LOW).
- The `compacted X→Y` note clears on the next response.
- The auto-compact threshold falls back to `rawMax − buffer` (33k on 2.1.295) when the engine gives none. That fallback is a heuristic.
