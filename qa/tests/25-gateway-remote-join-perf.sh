#!/usr/bin/env bash
# Test: transcript backfill must not block a joining session from being used.
#
#   P2 — join carrying a 44 MB transcript (the observed MAXIMUM across 3471
#        local transcripts, the number the retention cap was sized against).
#        Budget: the session is promptable within 1 s of registering, p95 of
#        20 runs.
#   P3 — join carrying a ~4 MB transcript (p99 size). No budget: this arm
#        RECORDS the register-to-usable p95 as a baseline.
#
# The failure this guards is a design that makes registration wait for the
# backfill. It would look fine on a small transcript and strand a real user's
# session for seconds on a large one — and the only people who would ever hit
# it are the ones with the most history to lose.
#
# DEVIATION, stated rather than implied. A true remote join arrives over TCP
# from another host; this arm connects over the local unix socket. The server
# work being measured — `transcript_chunk` ingestion racing session routing —
# is the same code either way, but the network leg is NOT measured here, so
# these numbers are a floor, not a field prediction.
#
# OPT-IN: not in run-all.sh. Perf arms are timing-sensitive and this one moves
# ~1 GB through a socket.
#
# See change: add-pi-gateway-transport-identity (test-plan #P2, #P3 → tasks
# 12.40, 12.41).
set -euo pipefail

echo "=== Test: remote-join transcript backfill (P2, P3) ==="

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

if ! command -v pi-dashboard >/dev/null 2>&1; then
  echo "SKIP: pi-dashboard not on PATH"; exit 0
fi
if ! node -e "require('ws')" 2>/dev/null; then
  echo "SKIP: ws module unavailable — cannot dial ws+unix://"; exit 0
fi

PORT=18814
GATEWAY=19814
RUNS="${QA_PERF_RUNS:-20}"
QA_HOME=""
SRV_PID=""

cleanup() {
  [ -n "$SRV_PID" ] && kill -9 "$SRV_PID" 2>/dev/null || true
  [ -n "$QA_HOME" ] && rm -rf "$QA_HOME" 2>/dev/null || true
}
trap cleanup EXIT

if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://localhost:$PORT/api/health" 2>/dev/null)" = "200" ]; then
  echo "FAIL: something is already serving on port $PORT"; exit 1
fi

QA_HOME="$(mktemp -d "${TMPDIR:-/tmp}/qa-joinperf-XXXXXX")"
HOME="$QA_HOME" pi-dashboard start --port "$PORT" --pi-port "$GATEWAY" --no-tunnel \
  > "$QA_HOME/start.log" 2>&1 &

WAITED=0
while [ "$WAITED" -lt 90 ]; do
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://localhost:$PORT/api/health" 2>/dev/null)" = "200" ] && break
  sleep 2; WAITED=$((WAITED + 2))
done
[ "$WAITED" -lt 90 ] || { echo "FAIL: dashboard never started"; sed -n '1,40p' "$QA_HOME/start.log"; exit 1; }

SRV_PID="$(curl -s "http://localhost:$PORT/api/health" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(String(JSON.parse(s).pid??'')))")"
SOCK="$QA_HOME/.pi/dashboard/gateway-$GATEWAY.sock"
[ -S "$SOCK" ] || { echo "FAIL: no gateway socket at $SOCK"; exit 1; }

# One measurement harness, both sizes. Emits JSON; bash decides pass/fail so
# the budget lives next to the scenario that owns it.
RESULT="$(node -e '
const WebSocket = require("ws");
const SOCK = process.argv[1];
const PORT = Number(process.argv[2]);
const RUNS = Number(process.argv[3]);

const ENTRY = JSON.stringify({ type: "message", role: "assistant", content: "x".repeat(900) });

function chunksFor(totalBytes) {
  // ~1 MB per frame: large enough that framing overhead is not what is being
  // measured, small enough that a single frame cannot be the whole payload.
  const perChunk = Math.max(1, Math.floor((1024 * 1024) / (ENTRY.length + 1)));
  const total = Math.ceil(totalBytes / (ENTRY.length + 1));
  const out = [];
  for (let sent = 0; sent < total; sent += perChunk) {
    out.push(new Array(Math.min(perChunk, total - sent)).fill(ENTRY));
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sessionVisible(id, deadlineMs) {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(`http://localhost:${PORT}/api/sessions`);
      const body = await res.json();
      if ((body.data ?? []).some((s) => s.id === id)) return true;
    } catch { /* server busy — that is itself what we are measuring */ }
    await sleep(10);
  }
  return false;
}

async function promptAccepted(id, deadlineMs) {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(`http://localhost:${PORT}/api/session/${id}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "qa-perf-probe" }),
      });
      if (res.ok) {
        const body = await res.json();
        if (body.success) return true;
      }
    } catch { /* retry */ }
    await sleep(10);
  }
  return false;
}

async function oneRun(totalBytes, i) {
  const id = `qa-join-${totalBytes}-${Date.now()}-${i}`;
  const ws = new WebSocket(`ws+unix://${SOCK}:/`);
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("open timeout")), 15000);
    ws.on("open", () => { clearTimeout(t); res(); });
    ws.on("error", (e) => { clearTimeout(t); rej(e); });
  });

  const t0 = Date.now();
  ws.send(JSON.stringify({ type: "session_register", sessionId: id, name: id, cwd: "/tmp", source: "tui", pid: 700000 + i }));

  // The backfill starts IMMEDIATELY after register, exactly as a joining
  // bridge would stream it — the whole question is whether it gets in the way.
  const chunks = chunksFor(totalBytes);
  for (let c = 0; c < chunks.length; c++) {
    ws.send(JSON.stringify({
      type: "transcript_chunk",
      sessionId: id,
      entries: chunks[c],
      restarted: c === 0,
      complete: c === chunks.length - 1,
    }));
  }

  if (!(await sessionVisible(id, 60000))) throw new Error(`session never registered: ${id}`);
  const tReg = Date.now();
  if (!(await promptAccepted(id, 60000))) throw new Error(`session never became promptable: ${id}`);
  const tUse = Date.now();

  ws.close();
  await sleep(50);
  return { register: tReg - t0, usable: tUse - tReg, total: tUse - t0 };
}

function p95(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)];
}

(async () => {
  const out = {};
  for (const [label, bytes] of [["p99", 4 * 1024 * 1024], ["max", 44 * 1024 * 1024]]) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) runs.push(await oneRun(bytes, i));
    out[label] = {
      bytes,
      registerP95: p95(runs.map((r) => r.register)),
      usableP95: p95(runs.map((r) => r.usable)),
      totalP95: p95(runs.map((r) => r.total)),
    };
  }
  process.stdout.write(JSON.stringify(out));
})().catch((e) => { console.error("HARNESS ERROR:", e.message); process.exit(1); });
' "$SOCK" "$PORT" "$RUNS")" || { echo "FAIL: measurement harness errored"; exit 1; }

echo "  raw: $RESULT"

read_field() {
  printf '%s' "$RESULT" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(String(JSON.parse(s)['$1']['$2'])))"
}

# P3 — baseline only. Recorded so a future regression has something to be
# compared against; deliberately NOT a budget, because no number was agreed.
echo "  P3 baseline (4 MB): register p95 = $(read_field p99 registerP95) ms, register→usable p95 = $(read_field p99 usableP95) ms"

# P2 — the budget. Measured from registration, not from connect: the claim
# under test is that the backfill does not stand between a registered session
# and its first prompt.
MAX_USABLE="$(read_field max usableP95)"
echo "  P2 (44 MB): register p95 = $(read_field max registerP95) ms, register→usable p95 = $MAX_USABLE ms"
if [ "$MAX_USABLE" -gt 1000 ]; then
  echo "FAIL: a 44 MB backfill delayed first use by ${MAX_USABLE} ms at p95 (budget 1000 ms)"
  exit 1
fi

# The 1000 ms budget is the one the test plan agreed, and on its own it is
# WEAK: it is ~80× the observed value, so it would sleep through a large
# regression. This second bound is what actually carries the scenario, and it
# was CALIBRATED, not guessed — a deliberately blocking ingest (a 100 ms busy
# wait per `RemoteTranscriptStore.append`) moves register→usable p95 from
# 2-12 ms to 315 ms, while leaving the agreed budget satisfied. 150 ms sits an
# order of magnitude above the healthy range and well below the blocking
# signature.
if [ "$MAX_USABLE" -gt 150 ]; then
  echo "FAIL: register→usable p95 is ${MAX_USABLE} ms at 44 MB (calibrated ceiling 150 ms)"
  echo "      the backfill is on the path between registering and first use"
  exit 1
fi
echo "  register→usable stays inside the calibrated 150 ms ceiling"

echo "PASS: transcript backfill does not block a joining session ($RUNS runs per size)"
