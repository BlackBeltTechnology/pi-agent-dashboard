#!/usr/bin/env bash
# Headless A/B runner. Serialized + interleaved so the new-JSONL capture is
# unambiguous and provider drift is spread across both arms.
#
# Env:
#   MODEL   model ref (optional; omit → pi default).  e.g. anthropic/claude-haiku-4-5
#   N       runs per (arm × task)                       default 5
#   TASKS   space-separated task ids to include         default: all in tasks.jsonl
#   TIMEOUT per-run seconds                             default 900
set -uo pipefail
cd "$(dirname "$0")"
HERE="$PWD"
N="${N:-5}"; TIMEOUT="${TIMEOUT:-900}"
SESS_ROOT="$HOME/.pi/agent/sessions"
OUT="$HERE/runs"; mkdir -p "$OUT"

# arms.json → "name<TAB>cwd" lines (bash 3.2 portable: no mapfile)
ARMS=(); while IFS= read -r line; do ARMS+=("$line"); done < <(node -e 'const a=require("./arms.json");for(const k of Object.keys(a))console.log(k+"\t"+a[k])')

# tasks.jsonl → "id<TAB>base64(prompt)" lines, filtered by $TASKS
TASKROWS=(); while IFS= read -r line; do TASKROWS+=("$line"); done < <(node -e '
  const fs=require("fs");const want=(process.env.TASKS||"").trim().split(/\s+/).filter(Boolean);
  for(const l of fs.readFileSync("tasks.jsonl","utf8").split("\n").filter(Boolean)){
    const t=JSON.parse(l); if(want.length&&!want.includes(t.id))continue;
    console.log(t.id+"\t"+Buffer.from(t.prompt).toString("base64"));
  }')

echo "arms=${#ARMS[@]} tasks=${#TASKROWS[@]} N=$N model=${MODEL:-<default>}"

snapshot(){ find "$SESS_ROOT" -name '*.jsonl' 2>/dev/null | sort; }

for ((i=1;i<=N;i++)); do
  for row in "${TASKROWS[@]}"; do
    tid="${row%%$'\t'*}"; prompt="$(echo "${row#*$'\t'}" | base64 --decode)"
    for arm in "${ARMS[@]}"; do
      name="${arm%%$'\t'*}"; cwd="${arm#*$'\t'}"
      tag="$name.$tid.$i"
      if [ ! -d "$cwd" ]; then echo "SKIP $tag: cwd missing ($cwd)"; continue; fi
      echo "▶ $tag  ($cwd)"
      before="$(snapshot)"
      ( cd "$cwd" && PI_DASHBOARD_HIDDEN=1 timeout "$TIMEOUT" \
          pi ${MODEL:+--model "$MODEL"} -p "$prompt" ) \
          >"$OUT/$tag.stdout" 2>&1
      after="$(snapshot)"
      newfile="$(comm -13 <(echo "$before") <(echo "$after") | tail -1)"
      if [ -n "$newfile" ] && [ -f "$newfile" ]; then
        cp "$newfile" "$OUT/$tag.jsonl"
        echo "  ↳ captured $(basename "$newfile")"
      else
        echo "  ↳ WARN no new JSONL (crash/timeout?) — see $tag.stdout"
      fi
      sleep 2   # stagger; lets pi flush the transcript
    done
  done
done
echo "done → $OUT"
