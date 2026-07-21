# Pi Dashboard Orchestration Recipes

Multi-step workflows combining dashboard API calls. All recipes assume `$BASE` is set:

```bash
PORT=$(cat ~/.pi/dashboard/config.json 2>/dev/null | grep '"port"' | grep -o '[0-9]*' || echo 8000)
BASE="http://localhost:$PORT"
```

---

## Typed bus scripting

For COMMAND-verb orchestration, prefer the typed WebSocket bus client over curl.
Write an ordinary type-checked `.ts` script importing `{ connect }` from
`@blackbelt-technology/pi-dashboard-bus-client` — it discovers the port itself,
spawn/resume replies are exact-correlated, and other waits are structural
(session-id + status). Run it with `npx tsx <script>.ts`.

```ts
import { connect } from "@blackbelt-technology/pi-dashboard-bus-client";

const bus = await connect();
try {
  // Spawn a session (reply is exact-correlated to this spawn).
  const { sessionId } = await bus.spawn({ cwd: "/path/to/project" });

  // Drive it: prompt → wait until idle → read result.
  await bus.prompt(sessionId, "Run the test suite and fix any failures");
  await bus.until(sessionId, "idle");

  const sessions = await bus.read.sessions();
  const me = sessions.find((s) => s.id === sessionId);
  console.log("status:", me?.status);

  // Follow-up step, then set a goal via the goal plugin.
  await bus.prompt(sessionId, "Now commit the fix");
  await bus.until(sessionId, "idle");
  await bus.plugin("goal", { action: "set", sessionId, text: "green tests" });
} finally {
  await bus.close();
}
```

For one-shot verbs the [`scripts/dashboard-bus.ts`](../scripts/dashboard-bus.ts)
CLI covers the same bus without writing a script (see SKILL.md).

---

## Recipe 1: Spawn a Session, Send a Prompt, Monitor Completion

Spawn a new pi session, wait for it to register, send a task, and poll until it finishes.

```bash
# 1. Spawn
curl -s -X POST "$BASE/api/session/spawn" \
  -H 'Content-Type: application/json' \
  -d '{"cwd":"/path/to/project"}'

# 2. Wait for the new session to appear (poll every 2s, max 30s)
for i in $(seq 1 15); do
  SESSION_ID=$(curl -s "$BASE/api/sessions" | jq -r \
    '.data[] | select(.cwd=="/path/to/project" and .status!="ended") | .id' | head -1)
  if [ -n "$SESSION_ID" ]; then break; fi
  sleep 2
done

if [ -z "$SESSION_ID" ]; then
  echo "ERROR: Session did not appear within 30s"
  exit 1
fi
echo "Session ID: $SESSION_ID"

# 3. Send prompt
curl -s -X POST "$BASE/api/session/$SESSION_ID/prompt" \
  -H 'Content-Type: application/json' \
  -d '{"text":"Run the test suite and fix any failures"}'

# 4. Poll until session goes idle or ends
while true; do
  STATUS=$(curl -s "$BASE/api/sessions" | jq -r \
    ".data[] | select(.id==\"$SESSION_ID\") | .status")
  echo "Status: $STATUS"
  case "$STATUS" in
    idle|ended) echo "Done!"; break ;;
    *) sleep 5 ;;
  esac
done
```

---

## Recipe 2: Health Check Dashboard

Check server health and summarize all session statuses.

```bash
# Server health
echo "=== Server Health ==="
curl -s "$BASE/api/health" | jq '{ok, pid, uptime_minutes: (.uptime / 60 | floor)}'

# Session summary
echo ""
echo "=== Sessions ==="
curl -s "$BASE/api/sessions" | jq -r '
  .data | group_by(.status) | .[] |
  "\(.[0].status): \(length) session(s)" +
  if .[0].status == "active" or .[0].status == "streaming" then
    " — " + ([.[] | .name // .id] | join(", "))
  else "" end
'

# Total cost
echo ""
echo "=== Cost ==="
curl -s "$BASE/api/sessions" | jq '
  .data | map(.cost // 0) | add |
  "Total cost: $\(. | tostring)"
'
```

---

## Recipe 3: Abort All Active Sessions

Emergency stop — abort every session that is currently streaming.

```bash
curl -s "$BASE/api/sessions" | jq -r '.data[] | select(.status=="streaming") | .id' | \
while read -r SID; do
  echo "Aborting: $SID"
  curl -s -X POST "$BASE/api/session/$SID/abort" \
    -H 'Content-Type: application/json' -d '{}'
done
```

---

## Recipe 4: Batch Rename Sessions by Directory

Rename all sessions in a project directory with a prefix.

```bash
PROJECT="/path/to/project"
PREFIX="refactor"

curl -s "$BASE/api/sessions" | jq -r ".data[] | select(.cwd==\"$PROJECT\") | .id" | \
while read -r SID; do
  IDX=$((IDX + 1))
  curl -s -X POST "$BASE/api/session/$SID/rename" \
    -H 'Content-Type: application/json' \
    -d "{\"name\":\"$PREFIX-$IDX\"}"
  echo "Renamed $SID → $PREFIX-$IDX"
done
```

---

## Recipe 5: Fork and Specialize

Fork an ended session and send it a new specialized task.

```bash
ORIGINAL_ID="abc123"

# Fork the session
curl -s -X POST "$BASE/api/session/$ORIGINAL_ID/resume" \
  -H 'Content-Type: application/json' \
  -d '{"mode":"fork"}'

# Wait for the fork to appear
sleep 5
FORK_ID=$(curl -s "$BASE/api/sessions" | jq -r \
  ".data[] | select(.status!=\"ended\" and .id!=\"$ORIGINAL_ID\") | .id" | tail -1)

if [ -n "$FORK_ID" ]; then
  # Send a different task to the fork
  curl -s -X POST "$BASE/api/session/$FORK_ID/prompt" \
    -H 'Content-Type: application/json' \
    -d '{"text":"Now write the documentation for the changes you made"}'
  echo "Forked to $FORK_ID and sent task"
fi
```

---

## Recipe 6: Monitor Session Token Usage

Watch token consumption across sessions in real-time.

```bash
while true; do
  clear
  echo "=== Token Usage ($(date +%H:%M:%S)) ==="
  curl -s "$BASE/api/sessions" | jq -r '
    .data | sort_by(-.cost // 0) | .[] |
    select(.status != "ended") |
    "\(.name // .id | .[0:20])  in:\(.tokensIn // 0)  out:\(.tokensOut // 0)  $\(.cost // 0)"
  '
  sleep 10
done
```

---

## Recipe 7: Git Branch Sync Across Projects

Check git branch status for all pinned directories.

```bash
echo "=== Git Branch Status ==="
curl -s "$BASE/api/pinned-dirs" | jq -r '.data[]' | while read -r DIR; do
  BRANCH=$(curl -s "$BASE/api/git/branches?cwd=$DIR" | jq -r '.data.current // "N/A"')
  echo "$DIR → $BRANCH"
done
```

---

## Recipe 8: Attach OpenSpec Proposal to All Project Sessions

Attach the same proposal to every active session in a project.

```bash
PROJECT="/path/to/project"
CHANGE="add-new-feature"

curl -s "$BASE/api/sessions" | jq -r \
  ".data[] | select(.cwd==\"$PROJECT\" and .status!=\"ended\") | .id" | \
while read -r SID; do
  curl -s -X POST "$BASE/api/session/$SID/attach-proposal" \
    -H 'Content-Type: application/json' \
    -d "{\"changeName\":\"$CHANGE\"}"
  echo "Attached $CHANGE to $SID"
done
```

---

## Recipe 9: Clean Up Ended Sessions

Hide all ended sessions older than 1 hour.

```bash
ONE_HOUR_AGO=$(( $(date +%s) * 1000 - 3600000 ))

curl -s "$BASE/api/sessions" | jq -r \
  ".data[] | select(.status==\"ended\" and (.endedAt // 0) < $ONE_HOUR_AGO) | .id" | \
while read -r SID; do
  curl -s -X POST "$BASE/api/session/$SID/hide" \
    -H 'Content-Type: application/json' -d '{}'
  echo "Hidden: $SID"
done
```

---

## Recipe 10: Tunnel Quick Setup

Enable remote access via tunnel.

```bash
# Check tunnel status
STATUS=$(curl -s "$BASE/api/tunnel-status" | jq -r '.status')
echo "Tunnel: $STATUS"

if [ "$STATUS" = "inactive" ]; then
  # Connect
  RESULT=$(curl -s -X POST "$BASE/api/tunnel-connect")
  URL=$(echo "$RESULT" | jq -r '.url // empty')
  if [ -n "$URL" ]; then
    echo "Tunnel active: $URL"
  else
    echo "Failed: $(echo "$RESULT" | jq -r '.error')"
  fi
elif [ "$STATUS" = "active" ]; then
  URL=$(curl -s "$BASE/api/tunnel-status" | jq -r '.url')
  echo "Already active: $URL"
fi
```

---

## Tips

- **Poll intervals**: Use 2–5s for status checks. Don't poll faster than 1s.
- **Session IDs**: Session IDs are stable UUIDs. Store them for multi-step workflows.
- **Error handling**: Always check `success` field in responses. A `200` status with `success: false` indicates a logical error.
- **jq fallback**: If jq isn't available, use `python3 -m json.tool` for formatting.
- **Parallel operations**: Use `xargs -P` or background jobs (`&`) for parallel session operations.
