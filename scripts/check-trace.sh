#!/usr/bin/env bash
# V7 (plan v2 §4): checks the debug-log trace of a headless run against a 200k compaction window.
# Needs ≥ 6 rendered `ctx-bar: status: [!]ctx ▕` lines, each `/200k (model 1M)`, raw=200000, fill (tokens)
# non-decreasing, and pct === floor(tokens*100/raw) on every line.
set -euo pipefail
LOG="${1:?usage: check-trace.sh <debug.log>}"
grep -aE 'ctx-bar: status: !?ctx ▕' "$LOG" | python3 -I -c '
import re, sys
# control characters are replaced before anything is printed (review r1, security LOW-4)
lines = [re.sub(r"[\x00-\x1f\x7f-\x9f]", "?", l) for l in sys.stdin.read().splitlines()]
pat = re.compile(r"ctx-bar: status: (?:!)?ctx \S+ (\d+)% \S+ \(model 1M\).*\[fill=(\d+) raw=(\d+)\]")
prev, bad = -1, []
for i, l in enumerate(lines):
    m = pat.search(l)
    if not m or "/200k (model 1M)" not in l: bad.append(f"line {i}: shape: {l[-160:]}"); continue
    pct, tok, raw = map(int, m.groups())
    if raw != 200000: bad.append(f"line {i}: raw={raw}")
    if tok < prev: bad.append(f"line {i}: tokens fell {prev}->{tok}")
    if pct != tok * 100 // raw: bad.append(f"line {i}: pct {pct} != floor({tok}*100/{raw})")
    prev = tok
print(f"trace lines: {len(lines)}")
for l in lines: print("  " + l[l.find("ctx-bar: status: "):])
if len(lines) < 6: bad.append(f"only {len(lines)} lines (need >= 6)")
for b in bad: print("BAD " + b)
sys.exit(1 if bad else 0)
'
