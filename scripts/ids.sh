#!/usr/bin/env bash
# V3's per-ID check (pricing plan v2, VT-F1): each new row ID passes exactly once, matched as a whole word.
#   bash scripts/ids.sh <claude plugin test output file>
set -uo pipefail
f="${1:?usage: ids.sh <test output>}"
IDS=(
  PR1 PR2 PR3 PR3b PR3c PR4 PR4b PR4c PR4d PR5 PR6 PR7 PR8 PR9 PR10 PR11 PR12 PR13 PR14 PR14b PR16 PR17
  PT1 PT2 PT3 PT4 PT5 PT6 PT7 PT8 PT9 PT10 PT11 PT12 PT13 PT14 PT15 PT16 PT17 PT18 PT19 PT20 PT21 PT22 PT23 PT23b PT24 PT25 PT26 PT27 PT28 PT29
  PK1 PK2 PK3 PK4 PK5 PK6 PK7 PK8 PK9 PK10 PK11 PK12 PK13 PK14 PK15
  PO1 PO2 PO3 PO4
  PX1 PX2 PX3 PX4 PX5 PX5b PX5c PX5d PX5e PX5f PX6 PX7 PX7b PX8 PX8b PX9 PX10 PX11 PX12 PX12p PX13 PX14 PX15 PX16
)
ok=0; bad=()
for id in "${IDS[@]}"; do
  n="$(grep -cE "^\(pass\) .*\b${id}\b( |$)" "$f")"
  if [[ "$n" -eq 1 ]]; then ok=$((ok + 1)); else bad+=("$id=$n"); fi
done
echo "IDS $ok/${#IDS[@]}"
[[ ${#bad[@]} -eq 0 ]] || { echo "IDS BAD: ${bad[*]}"; exit 1; }
