#!/usr/bin/env bash
# Headless A/B runner for the IMPLEMENTATION phase.
#
# Arm = thinking level (same cwd), unlike run.sh where arm = cwd.
# Each task replays a real merged commit: the worktree sits at <commit>^, the
# commit's TEST files are checked out on top (so they exist and fail), and the
# agent must make them pass. Ground truth = the real test suite.
#
# Env:
#   N        runs per (arm × task)              default 5
#   TASKS    space-separated task ids           default: all in tasks.impl.jsonl
#   TIMEOUT  per-run HARD ceiling seconds       default 1800
#   IDLE     seconds of transcript silence that means "done"   default 90
#   SCRATCH  worktree root                      default <repo>/.worktrees/ab-impl
#
# Why the idle watcher: with the dashboard extension loaded, `pi -p` prints its
# answer and then does NOT exit (measured: work done in 24s, process still alive
# at 12min). Waiting for the hard timeout would burn the ceiling on every run AND
# bias the comparison — slower-per-turn arms get truncated more often. Instead we
# watch the session transcript and stop the run once it stops growing.
set -uo pipefail
cd "$(dirname "$0")"
HERE="$PWD"
REPO="$(cd ../.. && pwd)"
N="${N:-5}"; TIMEOUT="${TIMEOUT:-1800}"; IDLE="${IDLE:-90}"
SCRATCH="${SCRATCH:-$REPO/.worktrees/ab-impl}"
SESS_ROOT="$HOME/.pi/agent/sessions"
OUT="$HERE/runs-impl"; mkdir -p "$OUT" "$SCRATCH"

# arms.thinking.json → "name<TAB>model"
ARMS=(); while IFS= read -r l; do ARMS+=("$l"); done < <(node -e '
  const a=require("./arms.thinking.json");
  for(const k of Object.keys(a)) console.log(k+"\t"+a[k].model)')

# tasks.impl.jsonl → "id<TAB>commit<TAB>tests<TAB>b64(verify)<TAB>b64(prompt)"
TASKROWS=(); while IFS= read -r l; do TASKROWS+=("$l"); done < <(node -e '
  const fs=require("fs");
  const want=(process.env.TASKS||"").trim().split(/\s+/).filter(Boolean);
  for(const l of fs.readFileSync("tasks.impl.jsonl","utf8").split("\n").filter(Boolean)){
    const t=JSON.parse(l); if(want.length&&!want.includes(t.id))continue;
    console.log([t.id,t.commit,t.tests.join(" "),
      Buffer.from(t.verify).toString("base64"),
      Buffer.from(t.prompt).toString("base64")].join("\t"));
  }')

echo "arms=${#ARMS[@]} tasks=${#TASKROWS[@]} N=$N scratch=$SCRATCH"
snapshot(){ find "$SESS_ROOT" -name '*.jsonl' 2>/dev/null | sort; }

# ── one worktree per task, provisioned once (pnpm install is the expensive bit) ──
for row in "${TASKROWS[@]}"; do
  IFS=$'\t' read -r tid commit tests vb64 pb64 <<<"$row"
  wt="$SCRATCH/$tid"
  if [ ! -d "$wt/.git" ] && [ ! -f "$wt/.git" ]; then
    echo "◆ provisioning $tid at ${commit}^"
    git -C "$REPO" worktree add --detach "$wt" "${commit}^" >/dev/null 2>&1 \
      || { echo "  ✗ worktree add failed"; continue; }
    ( cd "$wt" && command -v corepack >/dev/null 2>&1 && corepack enable >/dev/null 2>&1
      cd "$wt" && pnpm install >"$OUT/$tid.install.log" 2>&1 ) \
      || echo "  ⚠ pnpm install non-zero — see $OUT/$tid.install.log"
  fi
done

for ((i=1;i<=N;i++)); do
  for row in "${TASKROWS[@]}"; do
    IFS=$'\t' read -r tid commit tests vb64 pb64 <<<"$row"
    wt="$SCRATCH/$tid"; [ -d "$wt" ] || continue
    prompt="$(echo "$pb64" | base64 --decode)"
    verify="$(echo "$vb64" | base64 --decode)"
    for arm in "${ARMS[@]}"; do
      name="${arm%%$'\t'*}"; model="${arm#*$'\t'}"
      tag="$name.$tid.$i"
      echo "▶ $tag  ($model)"

      # pristine: discard the previous run's work, restore the failing tests.
      # MUST be `reset --hard`, not `checkout -- .`: staging the test files below
      # puts the commit's version in the INDEX, so `checkout -- .` would restore
      # the previous run's staged state and each run would inherit the last run's
      # implementation. Verified: without this the impl file survived the reset.
      # `git clean -fd` (no -x) leaves gitignored node_modules alone.
      git -C "$wt" reset --hard HEAD -q >/dev/null 2>&1
      git -C "$wt" clean -fd -q >/dev/null 2>&1
      git -C "$wt" checkout "$commit" -- $tests >/dev/null 2>&1 \
        || { echo "  ✗ could not stage test files"; continue; }

      before="$(snapshot)"
      ( cd "$wt" && PI_DASHBOARD_HIDDEN=1 timeout "$TIMEOUT" \
          pi --model "$model" -p "$prompt" ) >"$OUT/$tag.stdout" 2>&1 &
      pipid=$!

      # Poll: once the new transcript has been silent for $IDLE seconds, the run
      # is finished and we are only waiting on the extension shutdown hang.
      newfile=""; waited=0
      while kill -0 "$pipid" 2>/dev/null && [ "$waited" -lt "$TIMEOUT" ]; do
        sleep 10; waited=$((waited+10))
        [ -n "$newfile" ] || newfile="$(comm -13 <(echo "$before") <(snapshot) | tail -1)"
        [ -n "$newfile" ] && [ -f "$newfile" ] || continue
        mtime=$(stat -f %m "$newfile" 2>/dev/null || echo 0)
        if [ $(( $(date +%s) - mtime )) -ge "$IDLE" ]; then
          echo "  ↳ idle ${IDLE}s — stopping (worked ${waited}s)"
          kill "$pipid" 2>/dev/null; pkill -P "$pipid" 2>/dev/null
          break
        fi
      done
      wait "$pipid" 2>/dev/null
      after="$(snapshot)"

      # ground truth: do the real tests pass?
      ( cd "$wt" && HOME="$(mktemp -d -t ab-impl-XXXXXX)" \
          NODE_OPTIONS="--localstorage-file=$(mktemp -t ab-impl-ls-XXXXXX)" \
          timeout 600 sh -c "$verify" ) >"$OUT/$tag.verify.log" 2>&1
      echo "$?" >"$OUT/$tag.verify"

      # integrity: did the agent edit the tests instead of the implementation?
      if git -C "$wt" diff --quiet "$commit" -- $tests; then
        echo "0" >"$OUT/$tag.testdiff"
      else
        echo "1" >"$OUT/$tag.testdiff"
      fi

      [ -n "$newfile" ] || newfile="$(comm -13 <(echo "$before") <(echo "$after") | tail -1)"
      if [ -n "$newfile" ] && [ -f "$newfile" ]; then
        cp "$newfile" "$OUT/$tag.jsonl"
      else
        echo "  ↳ WARN no new JSONL (crash/timeout?) — see $tag.stdout"
      fi
      echo "  ↳ verify=$(cat "$OUT/$tag.verify") testdiff=$(cat "$OUT/$tag.testdiff")"
      sleep 2
    done
  done
done
echo "done → $OUT"
