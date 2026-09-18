# Test Plan — bound-session-heap-and-gc-telemetry

Stage: design   Generated: 2026-09-17

Clarifications resolved before writing (no open markers):
- Effective-ceiling observable → tolerance band `[request, request + 300 MB]`.
- GC observer performance budget → none; no perf scenario is written.
- Fallback observable → server-log line **and** a health-endpoint field.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | shared-config: defaults | EP | L1 | automated | config file `{}` | `loadConfig()` | `sessionHeap.maxOldSpaceMb === 512` and `serverHeap.maxOldSpaceMb === 1536`; `initialOldSpaceMb` and `maxSemiSpaceMb` are `undefined`, not `0` |
| E2 | heap-limits: floor is 64 | BVA | L1 | automated | `sessionHeap.maxOldSpaceMb: 63` | `loadConfig()` | returns `512` (default), no throw |
| E3 | heap-limits: floor is 64 | BVA | L1 | automated | `sessionHeap.maxOldSpaceMb: 64` | `loadConfig()` | returns `64` — the floor itself is valid |
| E4 | heap-limits: floor is 64 | BVA | L1 | automated | `sessionHeap.maxOldSpaceMb: 65` | `loadConfig()` | returns `65` |
| E5 | heap-limits: invalid falls back | EP | L1 | automated | values `0`, `-1`, `1024.5`, `"lots"`, `null`, `[]` | `loadConfig()` each | every case returns `512`; `loadConfig()` never throws |
| E6 | shared-config: partial block | EP | L1 | automated | `{"sessionHeap":{"maxSemiSpaceMb":8}}` | `loadConfig()` | `maxSemiSpaceMb === 8` **and** `maxOldSpaceMb === 512` — sibling default still applied |
| E7 | shared-config: `memoryLimits` independence | decision-table | L1 | automated | config sets `sessionHeap` only | `loadConfig()` | `memoryLimits` equals `DEFAULT_MEMORY_LIMITS` exactly — no cross-contamination between the two similarly-named keys |
| E8 | shared-config: partial write | state-transition | L1 | automated | persisted `sessionHeap`, then a `PUT` partial omitting it | config write + reload | persisted `sessionHeap` survives |
| E9 | settings: sub-block deep-merge | decision-table | L1 | automated | persisted `{maxOldSpaceMb:512, initialOldSpaceMb:64}`, panel saves `maxOldSpaceMb:256` only | config write | `initialOldSpaceMb` still `64` — the sibling is not dropped |
| E10 | process-manager: argv normalization | decision-table | L1 | automated | `piCmd` = `["/abs/pi"]` (bare) and `[node,"/abs/cli.js"]` (pair) | build the invocation | both yield `[runtime, …heapArgs, entry, …piArgs]`; heap args strictly before the entry |
| E11 | process-manager: ordering vs re-point | state-transition | L1 | automated | a `[node, cli.js]` pair plus a resolved runtime that differs | build the invocation | the runtime re-point still happens **and** heap args are present — proves normalization ran after re-pointing, not before |
| E12 | process-manager: pi args untouched | EP | L1 | automated | session options producing pi flags | build the invocation | pi's own args keep order and content; no heap flag appears among them |
| E13 | heap-limits: strip is provenance-based | decision-table | L1 | automated | 4 cases: marker+matching flag · marker+different flag · no marker+flag · neither | build the child env | stripped only in case 1; cases 2–3 preserve the operator flag verbatim |
| E14 | heap-limits: strip is surgical | EP | L1 | automated | `NODE_OPTIONS="--enable-source-maps --max-old-space-size=8192"` with a matching marker | build the child env | result is exactly `--enable-source-maps` — the unrelated flag survives |
| E15 | headless-spawn: no other var dropped | EP | L1 | automated | parent env with `PATH`, `HOME`, `PI_DASHBOARD_URL`, `NODE_OPTIONS` | build the child env | every var except the dashboard's own heap token is passed through unchanged |
| E16 | shared-protocol: optional fields | decision-table | L1 | automated | heartbeat metrics with all new fields · with none · with a subset | server ingest | accepted in every case; absent fields stay `undefined`, never coerced to `0` |
| E17 | shared-protocol: GC major classification | decision-table | L1 | automated | GC entries with `detail.kind` = 1 (minor), = 4 (major), and `detail` absent | fold into counters | `gcCount` counts all three; `gcMajorCount` counts only the `4`; the `detail`-less entry does not throw |
| E18 | shared-protocol: read-and-reset | state-transition | L1 | automated | GC activity, read, then a quiet interval, read again | two successive collections | first read reports the activity; second reports `gcCount === 0`, not a cumulative total |
| E19 | settings: page attribution | decision-table | L1 | automated | edit `sessionHeap` / edit `serverHeap` | compute dirty pages | `sessions` / `server` respectively; neither leaks onto the other page |
| E20 | settings: save payload | EP | L1 | automated | change a heap field | `computeConfigPartial` | the changed top-level key is present in the partial — it is not silently dropped |
| E21 | settings: entry validation | BVA | L3 | automated | enter `63`, `64`, `8192`, `8193` | blur the field | `63` refused with the floor explained; `64` and `8192` accepted silently; `8193` accepted with a warning |
| E23 | heap-limits: coupling guard fires | BVA | L1 | automated | ceiling `512` with `maxConcurrentSubagents` `2`, `4`, `5`, `8` | compute per-child figure | `512/(n+1)` = 171, 102, 85, 57 MB; warning absent at `2` and `4`, present at `5` and `8` |
| E24 | settings-panel: coupling warning rendered | decision-table | L3 | automated | ceiling `512`, raise `maxConcurrentSubagents` to `8` | blur the field | a non-blocking warning naming the per-child figure appears; the value stays saveable |
| E28 | heap-limits: server reports its own heap/GC telemetry | EP | L1 | automated | a running dashboard server | request `/api/health` | the server block carries `heapSizeLimit`, a major-GC count, and the effective ceiling the process was started with |
| E29 | heap-limits: effective ceiling tracks the process, not the config | state-transition | L1 | automated | configured ceiling changed without a cold start | request `/api/health` | the reported effective ceiling is still the value the running process started with |
| E32 | settings-panel: configured-vs-effective divergence surfaced | state-transition | L3 | automated | configured ceiling differs from the running process's effective ceiling | render the Server settings page | the panel surfaces that the running value differs |
| E31 | settings-panel: server ceiling is labelled cold-start-only | decision-table | L3 | automated | operator edits `serverHeap.maxOldSpaceMb` | blur the field | the panel states a full cold start is required and does not imply the in-place restart suffices |
| E22 | server-launch: standalone config-derived | EP | L2 | automated | config `serverHeap.maxOldSpaceMb: 4096` | start via the standalone wrapper | the server's `heap_size_limit` is within `[4096, 4396]` MB |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | settings: effect boundary copy | state-transition | L3 | automated | Settings → Sessions and → Server | render | the session fields state they apply to newly started sessions; the server field states a cold start is required |
| F2 | settings: round-trip | state-convergence | L3 | automated | change a heap field, save, reload the panel | save + reload | the panel converges on the saved value — no revert to default after reload |
| F3 | heap-limits: telemetry is readable | state-convergence | L3 | automated | a running session with a configured ceiling | health endpoint after a heartbeat | that session's metrics carry `heapSizeLimit`, `external`, `arrayBuffers` and the GC counters as numbers |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | server-launch: unreadable config | fault-injection (corrupt) | L2 | automated | config file is malformed JSON | standalone wrapper start | the server starts and runs at the `1536` default — the wrapper does not crash on a bad config |
| X2 | server-launch: absent config | fault-injection (missing) | L2 | automated | no config file | standalone wrapper start | starts at the `1536` default |
| X3 | heap-limits: fallback is recorded | fault-injection (no argv slot) | L2 | automated | a resolution yielding no runtime position | spawn a session | a fallback line appears in the server log **and** the health endpoint reports the fallback in use |
| X4 | heap-limits: no false fallback report | fault-injection (control) | L1 | automated | every session spawned through the normal argv route | read the health endpoint | the fallback is not reported as in use |
| X5 | heap-limits: below-floor cannot reach a process | fault-injection (bad config) | L1 | automated | `sessionHeap.maxOldSpaceMb: "lots"` | build the invocation | no non-integer token appears in the argv or any command string; the default is used |
| X6 | heap-limits: session ceiling applied end-to-end | state-transition | L2 | automated | `sessionHeap.maxOldSpaceMb: 512` | spawn a session, read its metrics | the session's `heapSizeLimit` is within `[512, 812]` MB and is not the server's ceiling |
| X7 | heap-limits: tooling is not capped | state-transition | L2 | automated | a capped session | the session starts a Node subprocess | that subprocess's heap ceiling is the runtime default, not the session ceiling — proves the cap did not travel through the environment |
| X8 | headless-spawn: keeper not capped | state-transition | L2 | automated | a capped session on the headless strategy | inspect keeper and pi | pi runs under the ceiling; the keeper process does not |
| X9 | heap-limits: reload adopts new config | state-transition | L3 | automated | a running headless session, then the ceiling is changed | reload the session | the replacement process runs under the **new** ceiling — no stale invocation reused |
| X10 | heap-limits: running sessions untouched | state-transition | L2 | automated | running sessions | lower the ceiling without restarting them | every running session keeps its original `heapSizeLimit` |
| X11 | server-restart: cold-start-only | state-transition | L2 | automated | change `serverHeap`, then restart in place | in-place restart | the restarted server keeps the previous ceiling; a cold start adopts the new one |
| X12 | server-launch: bridge path stamps | fault-injection (stripped env) | L2 | automated | a pi session whose env carries no heap flag | that session auto-starts a dashboard server | the server runs under the configured server ceiling, not the runtime default — the regression the strip would otherwise cause |
| X17 | heap-limits: 24 h steady-state + RSS | soak observation | — | manual-only | live dashboard on the new defaults for ≥24 h | observe `/api/health` | *sustained* `heapUsed` stays near the ~1187 MB prediction (transient peaks above it are expected from pinned overshoot and rehydration), `gcMajorCount` is not climbing, and RSS is recorded next to heap |
| X13 | process-manager: multiplexer delivery | state-transition | L2 | manual-only | a tmux server started before the ceiling was configured | spawn a session into a new pane | the pane's pi process runs under the configured ceiling |
| X14 | heap-limits: Windows Terminal reach | state-transition | — | manual-only | a Windows host with an existing Windows Terminal process | spawn a session | the pi process runs under the configured ceiling |
| X15 | heap-limits: WSL-tmux reach | state-transition | — | manual-only | a Windows host with WSL + tmux | spawn a session | the pi process inside WSL runs under the configured ceiling |

---

## Coverage summary

- Requirements covered: 20/20 (every `SHALL`-bearing requirement across the eight spec deltas has at least one row)
- Scenarios by class: edge 24 · perf 0 · frontend 3 · error 15
- Scenarios by level: L1 18 · L2 12 · L3 7 · manual-only 3
- Scenarios by disposition: automated 39 · manual-only 3

Perf is deliberately empty: no performance budget exists in the specs, and the
GC-observer overhead question was explicitly answered "no budget". Inventing a
threshold here would fabricate a requirement.

## New infra needed

- **X7 (tooling not capped)** needs a session to start a Node subprocess and
  report that subprocess's heap ceiling. No existing qa/ test does this; it is a
  new smoke test, not a new harness.
- **X17** (`manual-only`) is the 24 h soak: after the live server has run a full
  day on the new defaults, confirm `heapUsed` holds below ~1200 MB, that
  `gcMajorCount` is not climbing, and record **RSS alongside heap** so the
  "native overhead shrinks with the string churn" hypothesis is measured rather
  than assumed. This is the only guard for D9's 84% occupancy and for D12's
  container sizing.
- **X13–X15** are the multiplexer and Windows reach scenarios. X13 is
  automatable in principle but needs a pre-existing tmux server with a divergent
  environment, which the current harness does not construct; X14/X15 need real
  Windows and WSL hosts. All three are `manual-only` here and deferred
  post-merge rather than faked.
