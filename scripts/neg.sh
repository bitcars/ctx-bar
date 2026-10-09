#!/usr/bin/env bash
# Negative runs (plan v2 §4, V4 and V6's can-fail proof). Each case copies the repo to a
# fresh temp dir under $S, applies one mutation at a `// @neg:<case>` marker, runs the check
# that must catch it, and prints `NEG <case> OK` only when the check fails as it should.
#   bash scripts/neg.sh              # every offline case (V4): v1-fs … shape-v2
#   bash scripts/neg.sh live-throw   # one headless `claude -p` step (spends tokens)
set -uo pipefail
R="$(cd "$(dirname "$0")/.." && pwd)" || exit 2
S="${S:?set S to the session scratchpad}"
[[ -d "$S" && -w "$S" ]] || { echo "neg.sh: S=$S is not a writable directory" >&2; exit 2; }
ALLOW='$.fs.read $.session.usage $.state.get $.state.set $.ui.log $.ui.status'
# V9's pattern (plan v2 §4, widened in review r1 F6; pricing plan v2: `$.fs.read` is allowed, so `fs` moves to V9b,
# and `$[…]` or `{ fs } = $` aliasing is caught): env/config/process use, `full` in any quotes, globalThis.
V9="dev-mods|settings\\.json|\\\$\\.(env|config|process)\\.|\\\$\\[|\\{[^}]*\\bfs\\b[^}]*\\}[[:space:]]*=[[:space:]]*\\\$|['\"\`]full['\"\`]|process\\.|globalThis"
# V9b: the plugin's only file-system use (pricing plan v2).
V9B='hooks/register.ts:$.fs.read'
# cent-round's kill set, measured once and recorded in the plan's §9 (A1): every row whose figure depends on flooring.
CENT_ROUND_SET='PR2 PR5 PX1 PX10 PX11 PX15 PX16 PX5b PX5e PX6'

COPIES=()
cleanup() { local d; for d in "${COPIES[@]:-}"; do [[ -n "$d" && "$d" == "$S"/neg-* ]] && rm -rf "$d"; done; }
trap cleanup EXIT

copy() { # copy <case> → prints the copy's path; every failure stops the script
  local d
  d="$(mktemp -d "$S/neg-$1.XXXXXX")" || { echo "neg.sh: mktemp failed" >&2; exit 2; }
  [[ -n "$d" && -d "$d" && "$d" == "$S"/neg-* ]] || { echo "neg.sh: bad temp dir '$d'" >&2; exit 2; }
  rsync -a --exclude .git --exclude .sisyphus --exclude node_modules "$R/" "$d/" || { echo "neg.sh: rsync failed" >&2; exit 2; }
  echo "$d"
}
mutate() { # mutate <dir> <case> <replacement line> [file under the copy, default hooks/register.ts]
  local f="$1/${4:-hooks/register.ts}"
  grep -q "// @neg:$2\$" "$f" || { echo "NEG $2: marker missing" >&2; exit 2; }
  CASE="$2" REPL="$3" perl -0pi -e 's/^(\s*)\/\/ \@neg:\Q$ENV{CASE}\E$/$1$ENV{REPL}/m' "$f"
}
v9b() { # v9b <dir> → V9b's output: each `$.fs.<call>` site, by file
  (cd "$1" && grep -rnoE '\$\.fs\.[a-zA-Z]+' hooks/ | sed -E 's/:[0-9]+:/:/' | LC_ALL=C sort -u | paste -sd' ' -)
}
fails() { # fails <test output> → the sorted IDs of the failing rows, space-separated
  grep -E '^\(fail\) ' <<<"$1" | sed -E 's/^\(fail\) (.* > )?([A-Za-z0-9-]+) .*/\2/' | LC_ALL=C sort -u | paste -sd' ' -
}
expect_fails() { # expect_fails <case> <dir> <expected sorted IDs>: the run fails with exactly that set
  local out; out="$(cd "$2" && claude plugin test . 2>&1)"; local rc=$?; local got; got="$(fails "$out")"
  [[ $rc -ne 0 && "$got" == "$3" ]] && echo "NEG $1 OK" || { echo "NEG $1 FAILED: exit=$rc fails=[$got] want=[$3]"; return 1; }
}
calls() { # calls <dir> → the sorted `$.noun.method` set of validate's calls line
  (cd "$1" && claude plugin validate . 2>&1) | grep 'calls:' | grep -oE '\$\.[a-z]+\.[a-zA-Z]+' | sort -u | paste -sd' ' -
}

case_v1_fs() {
  local d; d="$(copy v1-fs)" || exit 2; COPIES+=("$d"); mutate "$d" v1-fs "await \$.fs.write('neg', 'x')"
  local got; got="$(calls "$d")"
  [[ "$got" != "$ALLOW" && "$got" == *'$.fs.write'* ]] && echo "NEG v1-fs OK" || { echo "NEG v1-fs FAILED: calls=[$got]"; return 1; }
}
case_v9_full() {
  local d; d="$(copy v9-full)" || exit 2; COPIES+=("$d"); mutate "$d" v9-full "void { breakdown: 'full' }"
  grep -rnE "$V9" "$d/hooks/" >/dev/null
  [[ $? -eq 0 ]] && echo "NEG v9-full OK" || { echo "NEG v9-full FAILED: grep found nothing"; return 1; }
}
case_v9_backtick() {
  local d; d="$(copy v9-backtick)" || exit 2; COPIES+=("$d"); mutate "$d" v9-full 'void { breakdown: `full` }'
  grep -rnE "$V9" "$d/hooks/" >/dev/null
  [[ $? -eq 0 ]] && echo "NEG v9-backtick OK" || { echo "NEG v9-backtick FAILED: grep found nothing"; return 1; }
}
case_guard_off() {
  local d; d="$(copy guard-off)" || exit 2; COPIES+=("$d"); mutate "$d" guard-off "throw err"
  local out; out="$(cd "$d" && claude plugin test . 2>&1)"; local rc=$?
  [[ $rc -ne 0 ]] && grep -qE '^\(fail\) guard > G1 ' <<<"$out" && echo "NEG guard-off OK" \
    || { echo "NEG guard-off FAILED: exit=$rc"; return 1; }
}
case_control() {
  local d; d="$(copy control)" || exit 2; COPIES+=("$d")
  cat > "$d/tests/neg.test.ts" <<'TS'
import { expect, test } from 'claude-code/testing'
test('NEG-C a failing test must fail the run', () => { expect('1k').toBe('1.0k') })
TS
  local out; out="$(cd "$d" && claude plugin test . 2>&1)"; local rc=$?
  [[ $rc -ne 0 ]] && grep -qE '^\(fail\) NEG-C ' <<<"$out" && echo "NEG control OK" \
    || { echo "NEG control FAILED: exit=$rc"; return 1; }
}
case_v9_fs() {
  local d; d="$(copy v9-fs)" || exit 2; COPIES+=("$d"); mutate "$d" v1-fs "await \$.fs.stat('neg')"
  local got; got="$(v9b "$d")"
  [[ "$got" != "$V9B" && "$got" == *'$.fs.stat'* ]] && echo "NEG v9-fs OK" || { echo "NEG v9-fs FAILED: v9b=[$got]"; return 1; }
}
case_v9_alias() {
  local d; d="$(copy v9-alias)" || exit 2; COPIES+=("$d"); mutate "$d" v1-fs 'const { fs } = $'
  grep -rnE "$V9" "$d/hooks/" >/dev/null
  [[ $? -eq 0 ]] && echo "NEG v9-alias OK" || { echo "NEG v9-alias FAILED: grep found nothing"; return 1; }
}
case_env_grep() {
  local d; d="$(copy env-grep)" || exit 2; COPIES+=("$d"); mutate "$d" v1-fs "await \$.env.get('x')"
  local n; n="$( (cd "$d" && claude plugin validate . 2>&1) | grep -cE 'env (reads|writes)|\$\.(env|config|process|http)\.')"
  [[ "$n" -ge 1 ]] && echo "NEG env-grep OK" || { echo "NEG env-grep FAILED: count=$n"; return 1; }
}
case_sub_skip() { # the substitution mutant: subagent usage is not counted
  local d; d="$(copy sub-skip)" || exit 2; COPIES+=("$d"); mutate "$d" sub-skip 'if (e.agentId !== undefined) return r'
  expect_fails sub-skip "$d" 'PX12p PX13 PX2'
}
case_cent_round() { # priceOf rounds to the cent instead of leaving the floor to usd()
  local d; d="$(copy cent-round)" || exit 2; COPIES+=("$d"); mutate "$d" cent-round 'return Number.isFinite(total) ? Math.round(total / 1e4) / 100 : null' hooks/pricing.ts
  expect_fails cent-round "$d" "$CENT_ROUND_SET"
}
case_shape_v2() { # the shape bump forgotten: a stored v2 value is read
  local d; d="$(copy shape-v2)" || exit 2; COPIES+=("$d"); mutate "$d" shape-v2 "viewShape = 'v2'"
  expect_fails shape-v2 "$d" 'PX10'
}
case_live_throw() { # the copy is kept: its debug log is the evidence
  local d; d="$(copy live-throw)" || exit 2; mutate "$d" live-throw "throw new Error('neg live-throw')"
  local run; run="$(mktemp -d "$S/neg-live-run.XXXXXX")" || exit 2
  (cd "$run" && claude -p --plugin-dir "$d" --debug-file "$run/debug.log" \
    "Reply with the single word OK." >"$run/out.txt" 2>"$run/err.txt")
  grep -qiE "ctx-bar.*(skip|fail|threw|timeout|refus|error)|ctx-bar: (turn|session)\.[a-z]+: " "$run/debug.log" \
    && echo "NEG live-throw OK ($run/debug.log)" || { echo "NEG live-throw FAILED: no failure line in $run/debug.log"; return 1; }
}

rc=0
if [[ $# -eq 0 ]]; then
  case_v1_fs || rc=1; case_v9_full || rc=1; case_v9_backtick || rc=1; case_guard_off || rc=1; case_control || rc=1
  case_v9_fs || rc=1; case_v9_alias || rc=1; case_env_grep || rc=1; case_sub_skip || rc=1; case_cent_round || rc=1; case_shape_v2 || rc=1
else
  for c in "$@"; do "case_${c//-/_}" || rc=1; done
fi
exit $rc
