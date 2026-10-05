# Supporting DeepSeek Harness (`dsh`) as a Harness Instead of pi — Feasibility Report

Research artifact. Explore-mode output, no OpenSpec change. Source: https://github.com/deepseek-ai/deepseek-harness (repo cloned + docs read 2026-08-18). Question answered: *what would we have to rewrite to support `dsh` as the agent harness instead of pi, and what are the architectural trade-offs?*

> `dsh` is in **developer preview** with explicitly "compatibility-breaking changes." Every interface named here is a moving target. Treat this report as a decision aid, not an implementation contract.

---

## 0. TL;DR

- Supporting `dsh` is **not a harness swap** — it is a **rewrite of the bridge layer and the event/session model**, because pi-dashboard is coupled to pi at the *extension-API level*, and `dsh` has a fundamentally different architecture (Cordis plugin tree + Typert RPC gateway + its own web UI).
- The deepest mismatch is **topology**, not vocabulary: **pi-dashboard sessions are OS processes discovered on disk (fan-in); `dsh` sessions are in-memory objects inside one process (fan-out).** Reconciling that axis is harder than remapping event names.
- `dsh` **already ships a web UI + webserver + API gateway**, so the real fork is: *keep our stack and feed it from a dsh plugin (Bridge/Concept A)*, or *build on dsh's own surface (Native/Concept B)*.
- Rough scope: `extension/` (~15k LoC) is a from-scratch rewrite; `shared/` ~40% and `server/` ~30% are refactors; the React `client/` (~81k LoC) is the most portable asset if the wire protocol stays stable.

---

## 1. The two architectures side by side

| Dimension | **pi** | **dsh** |
|---|---|---|
| Extension model | Module injected inside each session process; patches `ctx.ui`, subscribes `pi.events` | Cordis **plugin tree** composed from profiles/bundles at boot; "no privileged core to patch" |
| Add behavior via | One `ExtensionAPI` object with `activate()` | Register a service / event-listener on shared `ctx`; effects unwind on unload |
| Process topology | 1 OS process per session; bridge lives inside it | One process hosts the whole tree; sessions are entries in `ctx.sessions` |
| Dashboard | External — we built server + client + bridge | **dsh already ships its own web UI + webserver + Typert API gateway** (`dsh web`, default `:3080`) |
| Event stream | Flat: `message_update`, `tool_execution_*`, `agent_start/end/settled` | Two-tier: durable `SessionEventMap` log + live Cordis events (`agent/*`, `tools/*`, `session/*`, …) |
| Turn model | `agent_start … agent_end` per attempt | **turn = N steps**; waterfalls with `next()` (`agent/pre-step`, `agent/request`, `llm/stream`, `tools/*`) |
| Persistence | `~/.pi/agent/sessions/*.jsonl` + `.meta.json` sidecars | `ctx.sessions` in-memory + persistence plugins subscribed to `session/event` |
| Human interaction | `ctx.ui.confirm/select/input/editor/notify` | `ctx.commands` (human command plane) + Chat "conversation nodes" rendered from `session/event` |
| Config home | `~/.pi/agent/settings.json` | Cordis profiles/bundles + config catalog |

**Root cause of the effort:** two different integration philosophies. pi-dashboard *observes runtimes it does not own* (bridge inside each process). dsh expects contributions to *live in the runtime* (plugins beside plugins).

---

## 2. Coupling inventory (measured)

Total dashboard source ≈ **300k LoC**. Where pi is baked in:

| Package | LoC (files) | pi coupling | Verdict |
|---|---|---|---|
| `extension/` | 15.1k (66) | **Total** — the bridge *is* a pi `ExtensionAPI`: `pi.events`, `ctx.ui`, `session.prompt`, `pi.exec`, `ctx.compact`, `ctx.abort` | **Rewrite from scratch** as a dsh plugin |
| `shared/` | 22.8k (93) | **Mixed** — pi-shaped: `protocol.ts`, `state-replay.ts`, `session-meta.ts`, `stats-extractor.ts`, `pi-package-resolver.ts`, `models-json-reader.ts`, `tool-registry/*`, `doctor-core.ts`, `skill-block-parser.ts`, `credential-detect.ts`. Neutral: `bind-reachability`, `mdns-discovery`, `tunnel-provider`, `path-containment`, dialog primitives | **~40% rewrite** |
| `server/` | 55.6k (255) | **Plumbing neutral, deeply pi-fed.** Pi-only subtrees: `pi/` (7 files), `spawn-process/` (spawns `pi` argv), `session/session-scanner.ts` (reads `~/.pi/agent/sessions`), `pi-agent-settings.ts`, `auth/provider-auth-*`, `model-proxy/`, `routes/pi-*`, `routes/provider-*`, `routes/pi-retry-*` | **~30% rewrite** (event-derived state machines + pi subsystems) |
| `client/` | 81.5k (479) | **Low** — only 2 files import pi types (`PiVersionAdvisory`, `UnifiedPackagesSection`); the rest consumes the wire protocol | **Adapt event reducer + protocol types**, UI survives |
| `electron/` | 4.7k (31) | pi update-checker only | Minor |
| ~30 plugins (`flows-plugin`, `goal-plugin`, `roles-plugin`, `kb-*`, `automation-plugin`, `subagents-plugin`, …) | ~40k | Each is both a pi extension *and* a dashboard plugin | **Case-by-case** — many map to dsh natives (§6) |

Measurement commands (reproducible): `grep -rl "@earendil-works/pi" packages --include=*.ts` (33 source files excluding electron build artifacts); per-package LoC via `find … | xargs cat | wc -l`.

---

## 3. Wire protocol — where pi assumptions live

- **`protocol.ts`** (extension↔server): ~80 message types. Pi-specific and hard to translate: `event_forward` (carries pi event payloads verbatim), `set_thinking_level`, `models_list`/`providers_list`/`roles_list` (pi provider/role model), `subagent_resync_request`, `ui_modules_list`, `pi_version_update`, `stop_after_turn`, `flow_*`.
- **`browser-protocol.ts`** (server↔browser): **144 message types**. Mostly dashboard-domain (portable), but the event-bearing ones inherit pi's event shape.

Because the client cares about the *normalized* dashboard model, keeping the wire protocol stable and remapping at the bridge+server boundary insulates the 81k-LoC client.

---

## 4. Event mapping: pi → dsh (the semantic core)

Not relabeling — **re-deriving state machines**, because granularity differs.

| Dashboard needs | pi event(s) today | dsh equivalent | Gap / work |
|---|---|---|---|
| Assistant streaming text | `message_update` / `message_end` | `assistant/chunk` (raw) + `assistant/message` (assembled) | dsh splits raw vs assembled; reducer handles chunk-level replay |
| Tool call + result | `tool_execution_start/update/end` | `tool/call` + `tools/pre-execute`→`execute`→`post-execute` + `tool/result` | dsh has a **waterfall pipeline**; one tool card spans 4 live + 2 durable events |
| Turn boundaries | `agent_start` / `agent_end` | `turn/start` / `turn/end` **+ `step/start`/`step/end`** | dsh exposes inner **steps**; streaming status, elapsed timers, retry assume one cycle |
| Retry lifecycle | `agent_settled` + synthesized `auto_retry_*` | `agent/request-error` + `llm/stream` retry + `llm-retry` plugin | rebuild retry-tracker synthesis against dsh retry events |
| ask_user / dialogs | `ctx.ui.*` via PromptBus | `ctx.commands` + `approval/request` + conversation nodes | **No `ctx.ui` to intercept.** PromptBus + adapters (~15 files) rearchitected |
| notify | `ctx.ui.notify` → `notify` frame | (no direct analogue) | map to a conversation node or command output |
| Subagents | `flow_*` / `subagent_*` forwarded | `subagent/start`/`end`, `workflow/*` | dsh has **native** subagent + workflow events (Ralph loop/rounds) — cleaner but different shape |
| Todos | pi todo events | `todo/write` (whole-list snapshot) | remap |
| Model / route info | `model_update` | `request/header` + `request/context` (`RequestContext`) | dsh logs the request envelope as durable state |
| Goals | `goal-plugin` events | native `goal/changed` + `/goal` command | dsh has first-class goals |
| Session created/ended | `session_register` / `session_unregister` | `session/created` / `session/disposed` + `agent/session-start` | remap + rethink "process = session" |

**Non-obvious hard parts**
- **Steps inside turns.** Unread triggers, attention routing, last-activity stamping, retry banner are written against pi's single `agent_start…agent_end`. dsh is step-granular → re-derive, not rename.
- **Durable vs live split.** dsh contract: "model-visible means logged." Durable facts live in the `SessionEventMap` log; `agent/*`/`tools/*` are ephemeral waterfalls. Decide which tier each dashboard feature reads.
- **Reconstruction invariant.** dsh asserts every model request is a pure function of the log. Injected context must be a logged `SessionEvent`.

---

## 5. How `dsh web` handles multiple sessions

**One process, many in-memory sessions.** No per-session OS processes. Five moving parts:

1. **`ctx.sessions` — SessionStore.** In-memory. `list()` → all live sessions (creation order); `get(id)`; `create/prepare/enter/announce` lifecycle; `fork(source, boundary?, childId?)`. Persistence is *not* here — plugins subscribe to `session/event` and flush on `session/flush`.
2. **`ctx.agents` — AgentRegistry.** One owning **Agent** (driver loop) per session; `get(id)`; status `idle | running`. Many agents run concurrently in the one process.
3. **`session/event` firehose.** Every session's committed events on one shared channel — the multiplex backbone.
4. **`ctx.sessionProjections` — fan-out engine.** Subscribes to `session/event` **once**; each committed event of each session runs each projection unit's pure `apply(state, event)`. Serves client read-models as a history tail page + live **`session/projection` push frames**. `Object.is` same-reference rule makes non-matching events cost nothing.
5. **`ctx.sessionProjectionCache`.** Per-session checkpoints `(key → {ver, seq, val})`. Listing many sessions is O(1) via `cachedSnapshot()` (zero-I/O rung); cold-open of one session walks a read ladder (cache → restore floor → persistence `readFrom` → write-back).

**Browser transport is asymmetric (unlike pi-dashboard's bidirectional WS):**
- **Downlink (server→browser):** two WebSockets per browser — `/api/events.mux` and `/api/events.host` — carry only server→client frames (incl. per-session `session/projection`).
- **Uplink (browser→server):** everything over **HTTP POST to `/api`** — unary Typert `@Remote` RPC + API-proxy fallback.
- **Session targeting:** RPC carries `sessionId`/`agentId`; the gateway's `agentFor()` resolves the id to a live Agent, **auto-resuming a cold session** and de-duplicating concurrent resumes. Documented limitation: first open of history materializes the host agent (latency); no persistence-only read path.

**Inverse topology vs pi-dashboard:**

| | pi-dashboard | dsh web |
|---|---|---|
| Session = | OS process (`pi`), discovered on disk | in-memory object in one process |
| Multi-session = | **fan-in**: N bridges → 1 external server | **fan-out**: 1 process → 1 web server → browser |
| Transport | bidirectional WS (bridge↔server, server↔browser) | HTTP POST up + 2 WS downlinks |
| "List sessions" | scan `*.jsonl` + `.meta.json` | `projectionCache.cachedSnapshot()` in-memory |
| Live updates | forwarded pi events per bridge | `session/projection` frames off one firehose |
| Send prompt | route by sessionId → that bridge's process | RPC `sessionId` → `agentFor()` resolves/resumes |
| Cross-machine sessions | native (many hosts → one server) | **not native** — one process owns its sessions |

---

## 6. pi-ecosystem features → dsh natives

Several dashboard plugins have first-class dsh equivalents (not all loss):

| Dashboard feature | dsh native |
|---|---|
| `goal-plugin` | `ctx.goals`, `goal/changed`, `/goal` command, goal rounds |
| `subagents-plugin` / flows | `subagent/*`, `workflow/*`, Ralph loop |
| `roles-plugin` | agent presets (`agent-presets`) |
| skills | `skills/change`, skill seam |
| commands / slash | `ctx.commands` (human command plane) |
| compaction (`/compact`) | compaction seam (`compaction/*`) |
| MCP | tool registry seam |
| retry settings UI | `llm-retry` plugin config |
| OpenSpec polling | **no equivalent** — pi/dashboard-specific; drop or re-scope |
| KB extension | no equivalent |

---

## 7. The two concepts — pros / cons

Concept A — **Fan-in** (pi-dashboard today): sessions are processes; a bridge in each forwards to one external aggregator; browser talks to the aggregator.
Concept B — **Fan-out** (dsh web): one process owns all sessions in memory; a projection engine streams read-models to the browser; commands are RPCs resolved to in-memory agents.

### Concept A — Fan-in / multi-process aggregator

**Pros**
- **Cross-process & cross-machine by nature.** N harness processes on N hosts → one dashboard. Concept B cannot do this without extra plumbing. This is pi-dashboard's reason to exist.
- **Fault isolation.** One hung/OOM session kills only its process; aggregator + other sessions survive.
- **Attach to sessions you didn't start** (terminal, tmux, Zed) — the bridge connects out; no central spawner needed.
- **Independent lifecycle & versioning.** Bridge and server ship separately; sessions outlive a server restart and reattach.
- **Horizontal scale** across processes/cores/machines; aggregator only moves events.
- **Disk is source of truth** — cold history works even when nothing is live.

**Cons**
- **Distributed-systems tax:** reconnection, heartbeats, liveness watchdogs, event buffering, backpressure, duplicate-bridge guards, spawn-correlation tokens.
- **N WebSocket connections + fan-in bookkeeping** → more failure modes (stale bridges, bridge/server version skew).
- **Event fidelity is a reconstruction** (forwarded, sometimes-truncated stream) → replay logic, `state-replay.ts`, subagent resync.
- **Duplicated model:** each process has its state; the server re-derives a normalized view.

### Concept B — Fan-out / single-process projections

**Pros**
- **One authoritative log, no reconstruction.** Projections are pure folds over real `session/event`s — no lossy forwarding.
- **Cheap multi-session views.** Projection cache serves the list with zero I/O; new per-session widget = register a projection unit.
- **Far less infra** — no reconnect/heartbeat/buffer/backpressure/spawn-token machinery; transport is HTTP POST up + two WS downlinks.
- **Consistency is free** via `asOfSeq` watermarks + whole-value events (last-write-wins) — no version negotiation.
- **Simpler mental model:** sessions are objects; the browser renders projections.

**Cons**
- **No cross-machine / cross-process aggregation.** One process owns its sessions, full stop — the biggest mismatch with what pi-dashboard is.
- **Blast radius:** that process is a single point of failure; a crash takes down every session's live view (durable logs survive; liveness doesn't).
- **Scale ceiling:** all sessions share one event loop / heap / CPU-bound thread. pi-dashboard has *already* hit event-loop starvation as an aggregator-only process; hosting the agents too makes it worse.
- **Lazy-open latency** — cold session resumes/creates the host agent on first access; no pure read-only history path.
- **You inherit dsh's surface** — web app, connection trust fence, `--host 0.0.0.0`-unsupported posture become yours to live with or fork.

### Requirement → concept fit

| Requirement | Concept A (Bridge) | Concept B (Native) |
|---|---|---|
| Monitor sessions across machines/processes | ✅ native | ❌ rebuild fan-in on top |
| Attach to externally-launched sessions | ✅ | ❌ (only sessions this process owns) |
| Fault isolation between sessions | ✅ | ❌ shared process |
| Least code / least infra | ❌ | ✅ |
| Event fidelity & consistency | ❌ reconstructed | ✅ authoritative |
| Reuse React client & server plumbing | ✅ mostly | ❌ inherit dsh's |
| Remote control of a running fleet | ✅ core competency | ⚠️ per-process only |

---

## 8. Migration strategies (file-level scope)

**A. Bridge model** — keep server + client; write a dsh Cordis plugin that subscribes to `session/event` + projections and forwards to our protocol.
- Rewrite: all `extension/` (→ dsh plugin), ~40% `shared/` (protocol/event/session-meta/providers/tools-registry), ~30% `server/` (`pi/`, `spawn-process/`, `session-scanner`, `pi-agent-settings`, provider-auth, model-proxy, event-wiring state machines).
- Keep: server transport (dual-WS, LRU store, backpressure, replay), network/trust/tunnel/mDNS, **the whole client UI**, dialog primitives.
- Net: ~70–90k LoC touched, but client (~81k) mostly survives.

**B. Native model** — build on dsh's own web UI + Typert gateway.
- Inherit dsh server, RPC, session store, projection rendering, conversation nodes.
- Re-implement dashboard *features* (multi-session fleet view, folder grouping, attention routing, remote control, tunnels) as dsh client plugins + `@Remote` services.
- Net: far less of our code survives, far less plumbing to maintain — but give up native cross-machine reach and take on single-process fragility.

**Hybrid worth noting:** Concept B per host + Concept A across hosts — each dsh process owns its sessions and exposes projections; a thin aggregator fans those in. dsh's clean in-process model locally + multi-host reach, at the cost of a two-layer design.

---

## 9. The seam that makes it tractable

Today pi leaks straight through `protocol.ts` into server and client. The enabling refactor — worth doing **even while still pi-only** — is a **`Harness` interface** in `shared/`, with pi and dsh as two implementations, normalizing four things:

1. **Event stream** → dashboard protocol (absorbs turn/step granularity difference).
2. **Session control** (spawn/prompt/abort/resume/fork/model).
3. **Session discovery/persistence.**
4. **Providers / models / settings.**

Introduce that boundary first and a later dsh addition becomes *additive* (a second implementation) instead of a fork of the whole stack.

---

## 10. Effort & risk summary

- **Tier 1 (unavoidable, largest):** bridge rewrite + event-mapping state machines — the "months" bucket regardless of strategy.
- **Tier 2:** session control / discovery / persistence re-homing.
- **Tier 3:** providers / models / settings / retry re-mapping.
- **Tier 4:** per-plugin decision — adopt dsh native vs port vs drop.
- **Standing risk:** dsh is **developer preview with explicit breaking changes** — anything built against its event map or Typert gateway is a moving target. A real cost, not a footnote.

---

## 11. Recommendation

The choice hinges on **one question: is "watch/control many sessions across processes and machines" essential, or would a single-host tool be acceptable?**

- If **fleet/remote aggregation is the product's reason to exist** (it currently is) → **Concept A (Bridge)**: a dsh plugin forwarding to the existing aggregator. Keep the architecture; pay the rewrite cost only at the bridge/event-mapping boundary.
- If a **local, single-process dashboard is acceptable** (or one dsh process per host, aggregated higher up) → **Concept B (Native)**: dramatically less code, authoritative data — but give up native cross-machine reach and accept single-process fragility.

Either way, land the **`Harness` seam (§9) first** so dsh support is additive rather than a fork.

## Sources

- deepseek-harness repo: README, `docs/architecture.md`, `docs/api-gateway.md`, `docs/event-producer-consumer.md`, `docs/subsystems/session.md` + `core.md`, `docs/glossary.md`, `packages/host/webserver/README.md`, `packages/client/connection/README.md`, `packages/session/session-projection{,-cache}/README.md`, `packages/bundle/web-app/README.md`.
- pi-dashboard: `docs/architecture.md`, `packages/{extension,server,shared,client}/src` coupling scan (2026-08-18).
