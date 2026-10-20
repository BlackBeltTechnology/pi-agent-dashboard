# Design — supervised mode (dashboard tool-approval gate)

> **Refreshed 2026-10-19 against shipped code.** Citations checked against
> `@earendil-works/pi-coding-agent@1.3.0` (the pinned floor, `package.json:155`,
> `packages/extension/package.json:59`) and current `develop`. Since the first draft
> (2026-09-18) the **agent path gate** shipped (change `ask-agent-file-access-in-chat`,
> `packages/extension/src/path-gate/`), plus YOLO for the path gate
> (`openspec/specs/access-grant-yolo/spec.md`) and the opt-in path-containment guard
> (`packages/path-containment-guard/`). The path gate already implements most of the
> machinery this design proposed; supervised mode **follows its pattern** (D3, D8, D10,
> D14–D16) instead of inventing a parallel one.

## Origin

One of six adaptations mapped from a research pass over
[`pingdotgg/t3code`](https://github.com/pingdotgg/t3code). t3code's runtime modes offer
**Full access** (`approvalPolicy: never`) and **Supervised** (`approvalPolicy: on-request`
+ `sandboxMode: workspace-write`). We already run pi sessions full-access; the question is
whether "supervised" is buildable on pi's runtime.

## Spike — how pi surfaces tool approvals in `--mode rpc`

**Answer: pi has no built-in approval prompt, but exposes a blockable `tool_call` hook. All
rails to surface it in the dashboard exist — and one shipped gate (the path gate) already
uses every one of them.**

| Fact | Source | Consequence |
|---|---|---|
| pi "does not ask for approval before every tool call"; safety comes from OS/virtualization limits | `node_modules/@earendil-works/pi-coding-agent/docs/security.md:3-7` | Nothing to catch passively; no in-process sandbox to wire. |
| `tool_call` "can mutate input or block execution"; handlers run in extension-load then registration order | `docs/extensions.md:98,106` | The interception point. Order is behaviourally load-bearing. |
| First result with `block` set wins; later handlers do not run | `dist/core/extensions/runner.js:957-971` | A gate earlier in the chain can starve a later one. |
| "A `tool_call` handler failure blocks the tool as a fail-safe" | `docs/extensions.md:263` | True for pi — but see D8: the bridge's `safe()` wrapper defeats it. |
| `ctx.hasUI` is `true` in RPC mode | `docs/extensions.md:254`, `docs/rpc-extension-ui.md:25` | Dialogs work in dashboard-spawned sessions. |
| `pi.getAllTools()` reports each tool's `annotations` (`readOnlyHint`, `destructiveHint`, …); doc example gates on them | `docs/extensions.md:165-178` | Hints are unverified by pi; supervised does NOT use them (D2). |
| Nested `ctx.executeTool` calls go through `tool_call` with `parentToolCallId` | `docs/extensions.md:149` | `codemode` script calls are individually gateable (verify, D2). |
| Built-ins: `read, bash, powershell, edit, write, grep, find, ls`; built-in extensions add `codemode`, `tool_search` | `docs/cli.md:140-155` | Default risky set + read family (D2). |
| `user_bash` is a separate event | `docs/extensions.md:128` | Operator `!` commands never traverse `tool_call` (D1 caveat). |
| **Shipped precedent — agent path gate**: a `tool_call` handler registered WITHOUT `safe()`, own try/catch → block, `PromptBus.requestWithId` + `cancel(id)`, one timeout budget (default 120 s), per-session mutex, fail-closed reasons by cause, attention flag, Security-tab toggle | `bridge.ts:1950-1956`; `path-gate/handler.ts:39-41,119-131,224,293-297,330-346`; `path-gate/index.ts:85-98`; `packages/shared/src/config.ts:840-845`; `SettingsPanel.tsx:343,2613` | Supervised gate copies this shape (D3, D8, D10). |
| **Shipped precedent — chat-gateway guard**: `createToolCallGuard` + pure `decideToolCall` | `packages/chat-gateway/src/guard/index.ts`, `policy.ts` | Policy engine to extract (D6, D7, D9). |
| PromptBus `requestWithId(id, opts)` / `cancel(id)` | `packages/extension/src/prompt-bus.ts:139-145,230-252` | A caller owns its prompt id → single clock (D10). |

**Composed mechanism:**

```mermaid
flowchart TD
  A["agent emits tool call<br/>e.g. bash: rm -rf build"] --> B["pi fires tool_call"]
  B --> F1["bridge forwarder (safe, never blocks)"]
  F1 --> F2["fan-out admission (Agent only)"]
  F2 --> PG["agent path gate (read/write/edit outside roots)"]
  PG -->|blocked| BLK
  PG -->|"in-root / allowed"| SG["supervised gate (this change)"]
  SG --> D{"supervised(session)<br/>AND risky(tool)?<br/>AND not already answered by path gate?"}
  D -->|no| RUN["pi runs the tool"]
  D -->|yes| E["PromptBus.requestWithId(select)<br/>kind: supervised-tool-approval"]
  E --> G{"answer"}
  G -->|Allow once| RUN
  G -->|"Deny / reason"| BLK["{ block: true, reason }"]
  G -->|timeout → cancel(id)| BLK
  G -->|gate error| BLK
```

## Design decisions

### D1 — Approval gating only; sandboxing is out of scope (delegated to containers)
Supervised gates **whether** a risky tool runs; it does not confine what an approved tool
touches. Copy never says "sandboxed" / "safe" / "isolated"; it says "approve each action
the agent takes" and "not a sandbox" — the same framing as the shipped path-gate copy
("This is an approval prompt, not a sandbox", `AgentPathGateSection.tsx:40-44`). Users who
need isolation run the session in the Docker path.

**Coverage caveat (in the copy).** The gate sees **agent-initiated** tool calls only. It
does NOT cover `user_bash` (the operator's own `!` prefix, `docs/extensions.md:128`;
bridge handling at `bridge.ts:1166`, pass-through `bridge-handlers/forwarders.ts:44`),
extension-initiated execution, or — pending open question 5 — tool calls inside an `Agent`
subagent process.

### D2 — Risky-tool set is a matcher, default `{bash, powershell, write, edit, Agent}`
Read family (`read`, `grep`, `find`, `ls`) is not in the default set. The set is
configurable (`supervisedMode.tools`, D10). Matching consumes `event.input` so the prompt
shows the command / path + change summary, not an opaque name.

**The configured set is authoritative** — no hidden read-family exemption. An operator who
adds `read` gets `read` gated.

**`allow` beats `approval` in the shipped engine** (`policy.ts:42-53`). Under supervised's
allow-first posture an `allow` entry is a silent un-gate, so the supervised config UI
exposes no allow list.

**Policy shape** (`policy.ts`): supervised =
`{ approval: <supervisedMode.tools>, defaultAction: "allow" }` (needs D7).

**`powershell` is in the default set** (`docs/cli.md:144`); the repo supports Windows (`qa/`).

**Name drift is fail-OPEN under `defaultAction: "allow"`.** Mitigations, both required:
- **Allow-first, decided (user, 2026-10-19).** Only the configured set is gated. A tool
  outside `readFamily ∪ riskySet ∪ wrapperTools` runs, and the gate logs it once per
  session (`[supervised] unclassified tool <name>`). Tool `annotations` are **not** used:
  pi says they are unverified hints (`docs/extensions.md:166-178`), and almost no repo tool
  sets them, so annotation-gating would prompt on `ask_user`/`kb_*` while letting a tool that
  lies about `readOnlyHint` through. Operators add MCP or plugin tools to
  `supervisedMode.tools` in Settings. This is an accepted fail-open for tools nobody
  classified, stated in the Settings hint and the docs note — which name the concrete case
  of extension tools that run shell commands (e.g. context-mode's `ctx_execute`), which
  are not asked about until added. `readFamily` and `wrapperTools` are classification
  inputs for the drift test and the log line only; they never exempt a configured tool.
- **Drift test pinned to the host's built-ins.** `wrapperTools = {codemode, tool_search}`
  (their nested calls traverse `tool_call` individually, `docs/extensions.md:149`; verify
  for `codemode`, spike 0.3). **Spike result (0.3, 2026-10-19 — answered: YES).** `codemode`'s
  `tools.<name>()` calls `ctx.executeTool` (`pi-coding-agent/dist/extensions/codemode/execute.js:421`) →
  `_beforeToolCall(context, parentId)` (`agent-session.js:405`) → every `tool_call` handler, with
  `parentToolCallId` and id `<codemode id>/<n>`; parallel nested calls each raise their own approval,
  serialised by the gate's mutex. `codemode` is a wrapper, not a gated tool. Proof:
  `pi-runtime-spikes.test.ts`. The L1 test checks a fixture of the pinned pi version's
  built-in tool list (`docs/cli.md:140-155`); a pi bump that adds a built-in outside
  `readFamily ∪ riskySet ∪ wrapperTools` fails it and forces a classification. The fixture
  is regenerated by the `bump-pi-version` procedure.
- Case-insensitive comparison (`"Agent"` is capitalised at `subagent-fanout-admission.ts:176`)
  happens in the **supervised policy builder** (both sides lower-cased before calling
  `decideToolCall`). The shared engine stays exact-match (`policy.ts:37-39`), so
  chat-gateway decisions do not change.
- **Cost.** The non-supervised path reads an in-memory per-session boolean only.

**`Agent` is gated** because a subagent can run shell out of the parent's sight (D1, Q5).

### D3 — Transport and renderer: follow the path gate
Approval is a PromptBus `select` sent with `requestWithId` (the path gate's `GatePrompter`
shape, `path-gate/index.ts:85-98`, `handler.ts:44-48`), not `ctx.ui.confirm` — the gate
owns the prompt id it must `cancel()` (D10).

- Options: **`Allow once`**, **`Deny`** — same labels as the path gate
  (`path-gate/decide.ts:110-119`). No preselection, no autofocus (matches
  `agent-path-confinement` "No option SHALL be preselected").
- `metadata.kind = "supervised-tool-approval"` plus `{ tool, summary, cwd, path?,
  diffStat?, diff?, command?, deadline, toolCallId }`, and a `plainMessage` twin for the
  terminal adapter (path-gate precedent, `handler.ts:170-180`).
- **Metadata reaches the renderer.** The client copies only `message`, `questions`,
  `allowOther`, `plugin`, `toolCallId` out of `prompt.metadata`, at two sites: live
  (`client/src/hooks/useMessageHandler.ts:1858-1882`) and replay
  (`client/src/hooks/useSessionState.ts:161-178`). Both sites pass through the supervised
  keys (`kind`, `deadline`, `tool`, `summary`, `command`, `path`, `diffStat`, `diff`,
  `cwd`); a replay test pins it.
- **Client renders a dedicated card**: `ToolApprovalCard.tsx` in `interactive-renderers/`,
  selected by a `SelectRenderer` branch on `metadata.kind === "supervised-tool-approval"`
  (the registry is keyed by method, `registry.ts:11-28`; no new method). It adds the
  countdown from `deadline`, the collapsed diff, and **Deny with a reason** (mockup b-*).
  Surfaces that do not know the kind (TUI) render the plain options.
- **Deny with a reason** uses the inline "Other" free-text answer: the request sets
  `allowOther: true` (`shared/src/prompt-answer.ts:73-75`, change
  `add-ask-user-inline-other`). An answer equal to `Allow once` → allow; every other answer
  → deny; a non-label answer becomes the reason. Only the dashboard card offers a reason
  field; the TUI adapter has no free-text arm (`tui-prompt-adapter.ts:67-68`) and shows
  plain Allow once / Deny. (The path gate deliberately leaves `allowOther` off, pinned by
  `path-gate/__tests__/handler.test.ts:218`; supervised turns it on only for its own kind.) Unknown or empty answers fail closed (path-gate precedent,
  `handler.ts:224`).
- **Diff cap.** `metadata.diff` (and the enriched path prompt's diff / new content) is
  capped at **16 KiB**; a truncated diff ends with `… (truncated)` (decided 2026-10-19).
- **Reason hygiene.** The reason is operator text entering the agent's context: strip
  control characters, cap at 500 characters, deliver as
  `supervised: denied — operator said: "<text>"`.
- **The chat gateway does not render supervised approvals** (D17).
- Inherits first-response-wins, cross-surface dismissal, reconnect replay and the
  answered-prompt history from PromptBus.

### D4 — Mode flag wiring (SETTLED — both arms ship)
- **(b) Shared-config default** `supervisedMode.default: "full" | "supervised"` in
  `~/.pi/dashboard` (D10), read at session start.
- **(a) Session-scoped control message** dashboard → bridge (`set_supervised {on}`) for the
  live toggle. Not an event-protocol change; not part of the approval round-trip.

**Mode persistence (no silent fail-open).** Two durable copies, keyed by session id:
- **Session file.** Every flip writes `pi.appendEntry("supervised-mode", { on })` into the
  session; on `session_start` (new, resumed, forked or switched session,
  `packages/extension/src/session-sync.ts:226-267`) the bridge restores the last entry for
  THAT session id before handling any tool call. A session with no entry starts at the
  config default. This survives `/reload`, a pi restart/resume, and a server that is down.
- **Server metadata.** The server persists the mode in the session meta written by
  `packages/server/src/session/session-to-meta.ts` (explicit field list, so the field is
  added there) and restores it on registration (`server.ts:792-888`,
  `memory-session-manager.ts:358-371`); it re-sends `set_supervised` after register and
  reconnect. On disagreement the more restrictive value wins (Supervised), and the bridge
  reports the reconciled mode back.
- **Restore failure fails closed.** If reading the `supervised-mode` entry throws, the
  session is set to Supervised and the error is logged (`[supervised] mode restore failed`).
- **Race rule — revisioned.** Every flip carries a per-session monotonic `rev`, stored in
  both the session entry (`{ on, rev }`) and the server meta. Registration carries the
  bridge's `{ on, rev }`; the higher `rev` wins (so an OFF the server holds but the bridge
  missed is not reverted). Only when `rev` ties with different values, or either side has
  no `rev`, does the restrictive value (Supervised) win. The server persists the winner and
  sends `set_supervised { on, rev }`; the bridge applies it and appends the entry.
- **Wire data (accepted beyond the single control message).** Bridge → server: `{ on, rev }`
  and `toolGateOwner` as fields on the existing session registration, plus a
  `supervised_state { on, rev, toolGateOwner }` report when either changes after
  registration. Server → bridge: `set_supervised`. None of these is part of the approval
  round-trip.
- Bridge state is a `Map<sessionId, boolean>` in process-global `BridgeState`, never one
  flag, so a session switch never inherits the previous session's mode. The mode map, the
  mutex chains and the D14 hand-off sets are all cleared for a session id on
  `session_shutdown` (`docs/extensions.md:263-266`).

**`set_supervised` control message.** Server → bridge over the session's authenticated
bridge connection (same channel as existing server → extension controls,
`packages/server/src/server.ts:4031`, `bridge-handlers/dispatch.ts:321`). Payload
`{ on: boolean }`; a malformed payload is ignored (mode kept). It never resolves a pending
prompt. The browser → server request is **session-owner only** — the same gate as `send_prompt`
(`server/src/identity/ws-message-scope.ts:48`); anyone else is dropped silently (the owner gate answers no frame — no oracle, same as `send_prompt`) and the mode is kept.
The server logs each flip as
`[supervised] mode on|off rev=<n> session=<id> source=<connId>` (only the server knows the
connection) (decided 2026-10-19).

**Mid-turn semantics:** the flag is read **per tool call**; flips apply to the next call in
the same turn, both directions. A pending approval is never auto-resolved by a flip.

**Performance budget:** on a non-supervised session the gate is a flag check; **p95 added
latency per `tool_call` < 1 ms** (L1 timed test). The path gate holds the same budget for
in-root calls (`agent-path-confinement/spec.md:278`); the two are measured separately.

### D5 — Deny semantics fail closed
Timeout, explicit deny, dismissal and gate error all return `{ block: true, reason }`.
**No UI:** when `!ctx.hasUI` (print/JSON mode, `docs/extensions.md:250-254`) a Supervised
session blocks a risky call at once with `supervised: no-ui` — no 120 s wait (path-gate
precedent, `path-gate/handler.ts:293-297`). The
agent receives the reason and continues. Mirrors the path gate (`handler.ts:293-297,342-346`)
and chat-gateway.

### D6 — Extract the shipped chat-gateway policy engine into a shared module
`packages/chat-gateway/src/guard/{index,policy}.ts` is live code (archived change
`2026-09-18-add-chat-gateway`). Lift the **policy engine and guard core** into a
surface-agnostic module and migrate chat-gateway to consume it.

**What is shared, exactly.** The shared module is `decideToolCall` + `parseToolPolicy` +
the guard's settlement core (decide → request → single timeout → map outcome →
`{ block, reason }`, fail-closed on throw). Each surface injects its transport:
chat-gateway keeps `ctx.ui.confirm` and its 60 s timeout (user-visible behaviour
unchanged); the dashboard surface uses PromptBus `requestWithId` (D3).

**Supervised-only layers sit OUTSIDE the shared core**, in the bridge gate, each failing
closed through the gate's own try/catch (D8): the per-call flag read, case-folding (D2),
the unclassified-tool logging (D2), the per-session prompt mutex (D8), the
path-gate hand-off (D14), the gateway self-disable (D12). chat-gateway gains none of them.

Constraints:
- `openspec/specs/chat-gateway/spec.md` "Hard in-session tool policy for spawned sessions"
  (`:216`) stays satisfied; `guard.test.ts` / `policy.test.ts` **assertions** pass unchanged.
- `./guard` export of `@blackbelt-technology/pi-dashboard-chat-gateway-plugin` keeps
  working (re-export file); `toolPolicy` / `guardExtension` config surface unchanged.
- chat-gateway `defaultAction` stays `"deny"`; `"allow"` is supervised-only.

### D7 — Widen `ToolDefaultAction` with `"allow"` — type AND resolution AND validators
Today `type ToolDefaultAction = "deny" | "approve"` (`policy.ts:18`) and resolution is a
binary ternary (`policy.ts:54-56`). Widening the type alone makes `"allow"` fall into
`deny`. Four coordinated edits:
1. `decideToolCall` gains an explicit `"allow"` branch.
2. Absent `defaultAction` still resolves to `"deny"`.
3. `normalizeToolPolicy` (`packages/chat-gateway/src/server/config.ts:98-106`) keeps
   coercing non-`approve|deny` to `deny`; gateway `configSchema.json` enum stays
   `["deny","approve"]`.
4. `policyFromEnv` (`guard/index.ts:125-137`) stays in chat-gateway and calls a shared
   pure `parseToolPolicy(raw, { allowedDefaults: ["deny","approve"] })`.

### D8 — Handler ordering and error semantics — fail closed ITSELF
Current bridge `tool_call` handlers, in registration order:
1. pass-through forwarder — `safe()`-wrapped, never blocks (`bridge.ts:1912,1915`;
   `bridge-handlers/forwarders.ts:42,602-616`);
2. subagent fan-out admission — `safe()`-wrapped, `Agent` only (`bridge.ts:1945-1948`;
   order rationale `:1919-1928`);
3. agent path gate — NOT `safe()`-wrapped, own try/catch (`bridge.ts:1950-1956`).

The supervised gate is the **fourth**, registered **after the path gate** (tasks.md
coordination note from `ask-agent-file-access-in-chat`): an out-of-root call is decided
by the path gate first, so a denied path never raises an action prompt.

- **Registered WITHOUT `safe()`** — `safe()` returns `undefined` (= allow) on any throw
  (`bridge.ts:956-970`). Own `try/catch` → `{ block: true, reason: "supervised: error" }`;
  path-gate precedent (`handler.ts:342-346`). L1 test: internals throw ⇒ block.
- **Per-session mutex** for prompts (path-gate precedent, `handler.ts:330-338`): concurrent
  tool calls (parallel `codemode` scripts, sibling calls) raise approvals one at a time per
  session; other sessions never queue.
- **The mutex is the supervised gate's own** — distinct from the path gate's mutex. The path
  gate asks its YOLO question before taking its own mutex (`handler.ts:303-329`), so a
  pending supervised approval never delays a path-gate YOLO answer
  (`agent-path-confinement/spec.md:331`).
- **Abort.** The gate listens on `ctx.signal` (`docs/extensions.md:214`); an abort cancels
  the pending prompt (`PromptBus.cancel(id)`) and blocks with `supervised: aborted`. The
  signal is checked before AND after acquiring the mutex, so a call queued behind another
  approval never opens a card after the turn was aborted.
- **Fan-out permit window (spike 0.2).** Fan-out adds a permit on admission and releases it
  on `tool_execution_end` (`bridge.ts:1965`); the bridge comment says that event fires on
  "normal, blocked AND aborted paths" (`bridge.ts:1957-1960`), written for fan-out's own
  block. Verify for a block by a later handler. If it does not fire, the supervised gate
  releases the permit itself when it blocks an `Agent` call (a release hook on the fan-out
  admission object). The order never changes: no pre-check ahead of fan-out (starves the
  forwarder, `bridge.ts:1919-1928`) and never ahead of the path gate.
  **Spike result (0.2, 2026-10-19 — answered: it DOES fire).** A block from ANY handler makes
  pi's `prepareToolCall` return an `immediate` result, and the agent loop emits
  `tool_execution_end` for every `immediate` result (`pi-agent-core/dist/agent-loop.js:397`
  sequential, `:427` parallel; forwarded to extensions at `pi-coding-agent/dist/core/agent-session.js:958`).
  So the fan-out permit is released when the supervised gate (a later handler) blocks — no release
  hook on the fan-out admission object is needed and the order never changes. Executable proof:
  `supervised-gate/__tests__/pi-runtime-spikes.test.ts` (#X10) drives a real `AgentSession` with
  fan-out → supervised-deny and limit+1 `Agent` calls: all admitted, `inFlight` back to 0 (a control
  run without the release shows call limit+1 refused, so the scenario discriminates).
- **Permit held during the wait (accepted trade-off).** Fan-out admits an `Agent` call
  before the supervised gate runs, so a pending `Agent` approval holds a permit for up to the
  timeout; sibling `Agent` calls may meet a "not now" refusal meanwhile. Accepted for v1 (an
  `Agent` approval is rare and short); test 8.10 pins the release, and the spike records
  occupancy during the wait.
- **Pending approval and the tool row.** The forwarder runs first, so the transcript shows
  the call as running while it awaits approval; the card carries `metadata.toolCallId`, so
  the client can tie the card to the row.
- **The approval covers the input as the gate saw it — no more.** `tool_call` handlers may
  mutate `event.input` (`docs/extensions.md:98-106`); a handler in an extension loaded
  after the bridge could change it after approval. The contract is therefore "approves the
  shown input snapshot", not "nothing runs unseen"; the spec and the user-facing note say
  so. Detecting a later mutation is out of scope (unverified whether pi exposes a final
  pre-execution input).
- Separately loaded extensions with `tool_call` handlers (path-containment-guard
  `packages/path-containment-guard/src/extension.ts:71`, untrusted-content-guard
  `packages/untrusted-content-guard/src/extension.ts:54`, chat-gateway guard
  `guard/index.ts:142`) compose by first-block-wins; a call runs only if none blocks
  (`openspec/specs/path-containment-guard/spec.md:287-289`). Order relative to the bridge
  depends on extension load order — no supervised behaviour depends on it.

### D9 — The extraction is a parameterisation, not a byte-for-byte lift
The shipped guard hardcodes chat copy (`guard/index.ts:102-104`), prefixes reasons
`chat-gateway:` (`:96,108`), discards `event.input` (`:89-93`), and reads a
gateway-specific env name (`:125-137`).

```ts
interface ApprovalSurface {
  buildPrompt(event: ToolCallEvent): { title: string; body: string; plain: string; metadata: object };
  reasonPrefix: string;                       // "chat-gateway" | "supervised"
  request(prompt, ctx: GuardCtx):             // ctx: chat-gateway needs ctx.ui.confirm per call
    { decision: Promise<{ answer: string | undefined; surface: string }>; cancel(): void };
  onDecision(record: DecisionRecord): void;   // required
}
type GateOutcome = "approved" | "denied" | "dismissed" | "timeout" | "aborted" | "error";
```

The dashboard surface implements `request` over `PromptBus.requestWithId` / `cancel`
(D3). The chat-gateway surface wraps `ctx.ui.confirm` (`guard/index.ts:99-106`): `true` →
answer `"Allow once"`, `false` → `undefined`; its `cancel()` is a no-op, so its card
lifetime is unchanged — the "card withdrawn on expiry" invariant is supervised-only. Its
`onDecision` writes one `[chat-gateway]` console line (no durable entry). chat-gateway's surface maps all three negatives to its existing single reason
`chat-gateway: approval_denied_or_timed_out`, so its agent-visible behaviour is
byte-identical; supervised maps them to distinct reasons. `guard.test.ts` keeps its
assertions; its setup gains a thin adapter. **No default presenter** — a call site that
forgets to inject fails to compile.

### D10 — One approval clock; config mirrors `agentPathGate`
Config key `supervisedMode` in `~/.pi/dashboard`, shaped like the shipped
`agentPathGate` (`packages/shared/src/config.ts:840-845`):

```ts
supervisedMode: {
  default: "full" | "supervised";   // default "full"
  timeoutSeconds: number;           // default 120, minimum 10
  tools: string[];                  // default ["bash","powershell","write","edit","Agent"]
}
```

- **Timeout default 120 s**, the same as `agentPathGate.timeoutSeconds`; not inherited from
  `askUserPromptTimeoutSeconds` (300, `config.ts:1381`). **Minimum 10 s**; values below
  are rejected by the Settings field and coerced to the default by the config parser —
  there is no "wait forever" (fail-closed).
- **One effective clock, bus timer kept as backstop.** PromptBus arms its bus-wide timer
  on every submit from `askUserPromptTimeoutSeconds` (`prompt-bus.ts:147-155`, applied at
  `bridge-handlers/lifecycle.ts:338`), and the shipped `ask-user-tool` spec says that
  timeout applies uniformly to every PromptBus prompt (`openspec/specs/ask-user-tool/spec.md:176`).
  So no per-request override: the gate's deadline is
  `max(1 s, min(supervisedMode.timeoutSeconds, busTimeout − 1 s))` (bus timeout ≤ 0 =
  infinite → supervised value). The 10 s floor applies to the **configured** value; an
  operator who sets the ask_user/bus timeout below 11 s (allowed today,
  `bridge-handlers/lifecycle.ts:69-81`) gets a shorter effective approval window, and the
  Settings section warns when that is the case. The gate's timer fires before the bus
  timer; the bus timer remains only as a backstop. The bridge exposes the session's bus
  timeout through a read accessor on the PromptBus options.
- **When the clock starts.** The timer starts when the prompt opens, i.e. after the D8 mutex
  is acquired; `metadata.deadline` is set then. A call queued behind other approvals waits
  for them first (bounded by abort, D8); this is accepted.
- **Outcome attribution — by what the gate did, not by response shape.** Every
  `PromptBus.cancel` resolves `{ cancelled: true, source: "__bus__" }`
  (`prompt-bus.ts:230-252`), so the shape cannot tell causes apart. The gate keeps a
  per-request `selfCancel` reason (`timeout` | `aborted`) set just before it calls
  `cancel(id)` itself. Outcome: `approved`; `denied` (explicit Deny or a reason);
  `dismissed` (a cancel the gate did not initiate — a client dismiss, or the backstop);
  `timeout` / `aborted` (self-cancel); `error` (gate threw). All non-approved outcomes
  block, each with its own reason. `GateOutcome` (D9) and the spec use this one vocabulary.
- **Bounds** 10–3600 s; outside, non-numeric, or a config parse error → the default 120 s.
  The server normalises on write too: `PUT /api/config` with an out-of-range value persists
  120, so `GET` returns 120 (decided 2026-10-19).
- The shared core's timeout parameter is strictly positive milliseconds; each surface
  converts its own convention (the gateway guard's `Math.max(0, …)` and the bus's
  `≤ 0 = infinite` never meet in the core). The "card withdrawn on expiry" invariant is
  supervised-only (D9). The card shows a countdown from `metadata.deadline`. An abort (Esc) cancels the
  pending approval. chat-gateway keeps its own 60 s (`guard/index.ts:49`); the shared guard
  takes the timeout as a parameter.
- **Settings**: Security tab, a "Tool approval (Supervised mode)" section next to
  `AgentPathGateSection` (`SettingsPanel.tsx:2613`) — mockup state c-*.

### D11 — `answeredBy` is not obtainable; v1 logs the surface
`prompt_response.source` is an adapter label (`useSessionActions.ts:183` hardcodes
`"dashboard-default"`). v1 logs `answeredSurface` (`dashboard` | `tui` | `chat-gateway` |
`timeout` | `error`). Each record also carries `via: "supervised" | "path-gate"` (D14).
**Redaction:** the action summary is capped at 500 characters and passed through the
bridge's existing secret redaction (vault redaction precedent, `bridge.ts:1166`) before it
is logged. Sink: `pi.appendEntry("supervised-tool-decision", record)` (the
fan-out gate's durable-entry precedent, `bridge.ts:1937`) plus a control-character-free
`[supervised]` console line (path-gate audit-line precedent).

### D12 — A supervised, gateway-spawned session must not double-gate
The chat-gateway guard wins in a spawned session; the supervised gate self-disables there.
The toggle is replaced by a static "Gateway policy" note (mockup a-gateway).

**Detection.** The shared package exposes `markToolGateOwner(sessionId, "chat-gateway")` /
`clearToolGateOwner(sessionId)` / `toolGateOwner(sessionId)`, backed by a **process-global** slot
`globalThis[Symbol.for("pi-dashboard.toolGateOwner")]`, holding a
`Map<sessionId, owner>` — pi loads every extension through
jiti with `moduleCache: false` (`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js:477-479`),
so a module-level variable would be a different copy in the guard and in the bridge. An
L1 test loads two module instances and asserts the flag crosses. **Lifecycle:** the guard
(which gains `session_start` / `session_shutdown` handlers in the extraction; today its
`GuardPi` only uses `on("tool_call")`, `guard/index.ts:23-28`) marks its session in its `session_start` handler and clears it in
`session_shutdown` (pi requires cleanup across reload and session replacement,
`docs/extensions.md:263-266`), so a removed or reconfigured guard never leaves a stale
owner. The guard's `GuardPi` / `GuardCtx` widen for this (session hooks + session id) — an
explicit extraction task. **Version skew:** an older installed guard never marks the slot,
so a newer bridge's supervised gate also runs there → up to two prompts (fail-safe,
accepted). The bridge reads the slot per tool call (authoritative) and reports it to the server
after `session_start` completes, re-reporting if a later read differs, so the UI can lag but
never decides. **Trust model:** any extension in the pi process could write the slot — but
any in-process extension can already patch or unregister the bridge's handlers, so the slot
adds no new trust boundary; supervised mode does not defend against hostile extensions. Sniffing `PI_EXT_CHAT_GATEWAY_GUARD_POLICY` is rejected.

**The UI keys off the same fact.** The bridge reports `toolGateOwner` to the server with the
session (one field on the existing session registration); the client hides the toggle only
when it is `"chat-gateway"`. A gateway-spawned session without the guard (no `toolPolicy`
+ `guardExtension`, `chat-gateway/src/server/config.ts:88-93`) keeps the toggle and
supervised works normally there.

**Attached sessions.** The gateway never gates an attached session (chat-gateway spec). The
operator may still turn on supervised there; that is the operator's choice, not a gateway
gate, and the approvals are answered on dashboard/TUI only (D17).

**At most one supervised/gateway approval** per call in a spawned session, decided by the
gateway policy alone — zero when the gateway policy allows the tool. The agent path gate is
independent and still runs there (`bridge.ts:1953-1956`); an out-of-workspace call can
additionally raise its path prompt.

### D13 — Packaging and an honest rollback
`packages/extension` cannot depend on the chat-gateway plugin, so the shared policy engine
becomes its own workspace package (open question 4; the shared-module precedent is
`packages/shared/src/tool-path-resolve.ts`). chat-gateway's `./guard` stays a real
re-export. Rollback = revert the whole change as one unit (no persisted state). Release
order: shared package published before the chat-gateway version that depends on it;
post-release rollback is a forward fix, never an unpublish.

### D14 — Composition with the agent path gate (one prompt per call)
The path gate gates `read`/`write`/`edit` outside the session roots
(`path-gate/handler.ts:39`). For `write`/`edit` both gates can apply. Today the path-gate
card shows only path, tool and "N edit(s)" / a byte count (`handler.ts:156-170`) — no
content. Rule (one prompt, nothing approved unseen):
- Path gate runs first (D8). If it blocks, the supervised gate never runs.
- **When the session is Supervised and the tool is in the risky set**, the path gate's
  prompt carries the supervised action content: the same `+N −M` stat and byte-capped diff
  (or new content for `write`) the supervised card would show, appended to its markdown
  `message` and `plainMessage`, built by the shared supervised summary builder. The path
  gate reads **supervised-in-effect** (mode on AND `toolGateOwner(sessionId) !==
  "chat-gateway"`) + the risky set through a narrow accessor — so in a guard-owned
  gateway session path prompts are never enriched and stay visible in chat; it does not import
  the supervised policy.
- The enriched path prompt carries `metadata.supervised: true`; the chat gateway skips it
  like a supervised prompt (D17), so a chat channel can never answer it.
- If the operator answered that enriched path prompt with **Allow once**, the path gate
  records the `toolCallId` in a per-session hand-off set. **Always allow + confirm** is a
  durable directory grant, not consent to this content, so it records nothing and the
  supervised gate asks. The response `source` is NOT used for trust (it is a client-supplied
  string, `bridge-handlers/dispatch.ts:310`); chat answers are excluded structurally (the
  gateway skips enriched prompts, D17) and REST answers by the question stack (D17). The
  `GatePrompter` interface is unchanged; the
  supervised gate consumes the id (removes it) and allows without asking, logging the
  decision with `via: "path-gate"` (D11). The set is bounded (64 ids, FIFO eviction; an
  evicted id simply means the supervised gate asks), keyed by the captured session id, and
  holds nested ids (`<parent>/<n>`) as plain strings.
- If the path gate allowed **without asking** (in-root, an existing grant, or YOLO
  auto-allow), nothing is recorded and the supervised gate asks as usual.
- **Accepted exceptions (fail safe — a second prompt, never a skipped one):** a call with no
  `toolCallId` (optional in the event type, `handler.ts:262`); a session switched to
  Supervised while its path prompt was already open (the prompt was not enriched).
- `decidePathAccess` stays pure and separate (`path-gate/decide.ts:60`).

### D15 — YOLO does not cover supervised approvals
YOLO applies to the filesystem plane, the working-directory plane and the agent path gate
**only** (`openspec/specs/access-grant-yolo/spec.md:12-19`). Supervised mode is an explicit
per-session opt-in to be asked; YOLO auto-answering it would silently undo the choice. The
supervised menu copy says so. The YOLO spec is unchanged.

Consequence: an active YOLO session's path-gate auto-allow does not suppress the supervised
prompt (D14 third bullet). The path gate's "YOLO question SHALL NOT wait behind another
prompt of the same session" (`agent-path-confinement/spec.md:331`) is unaffected because the
path gate runs before the supervised gate and the supervised prompt opens only after it.

### D16 — Attention routing: `awaitingToolApproval`
The server derives `awaitingFileAccess` from pending prompts of the two path-gate kinds
(`packages/server/src/event-wiring.ts:377-390`). Add a sibling flag
`awaitingToolApproval` derived from pending `supervised-tool-approval` prompts. Every
consumer of `awaitingFileAccess` reads a shared predicate
`awaitingOperatorApproval(session) = awaitingFileAccess || awaitingToolApproval` in
`packages/shared/src/` instead of the single flag: `SessionCard.tsx:127-131` ("Needs you"),
`client/src/lib/session/session-lanes.ts` (needs-you lane), `session-status-visuals.ts`
(urgency), `server/src/pairing/browser-gateway.ts`, and the toast hook
(`client/src/hooks/useFileAccessToasts.ts:39`, mirrored for the new kind). No modal
(`session-attention-routing/spec.md:93-99` precedent). No separate "Supervised" badge in the
session list in v1 (mockup ui-plan Q1).

### D17 — The chat gateway does not render supervised approvals
The gateway renders every `prompt_request` for a bound channel
(`packages/chat-gateway/src/server/gateway.ts:1538-1565`), including owner-attached
sessions. A channel member could then approve a supervised tool call in the owner's
session — a privilege raise the operator never chose. The gateway skips prompts whose
`metadata.kind === "supervised-tool-approval"` and enriched path prompts
(`metadata.supervised === true`, D14); they are answered on the dashboard or the TUI only.
This narrows the shipped chat-gateway requirement "Interactive prompts rendered natively
via PromptBus" (`openspec/specs/chat-gateway/spec.md:144-157`), so the change carries a
MODIFIED delta for it. Consequence: an operator who works only from chat cannot answer
supervised approvals; with supervised on, such a session's risky calls time out and are
blocked. The toggle menu says approvals are answered on the dashboard or terminal.

**Question stack.** The server's question stack lists pending prompts and accepts answers
over REST (`POST /api/questions/:id/answer`, `server/src/questions/question-routes.ts:87-117`)
and may brief them with an LLM (`brief-policy.ts:34-35`). File-access kinds are excluded as
read-only, never briefed (`question-store.ts:43-44,190-191`). Supervised prompts (and
enriched path prompts, which already carry a file-access kind) join that exclusion: listed
read-only, never answerable over REST, never briefed, and command text is never sent to a
model. **Limit (stated, same as path-gate prompts today):** the browser WebSocket
`prompt_response` road is owner-gated like `send_prompt`
(`server/src/identity/ws-message-scope.ts:48`) and forwards answers without a kind check
(`server/src/questions/question-answer.ts:41-55`). Any principal with session-owner
WebSocket access — the dashboard, by definition — can answer. Supervised mode does not add
a per-principal check there; REST and chat are the roads it closes. `answeredSurface: "chat-gateway"` is therefore never produced by supervised
mode (it remains a value for the gateway's own guard).

## Open questions

1. **Parallel tool calls.** Several risky calls (siblings, or a `codemode` script with
   `Promise.allSettled`) → N prompts serialized by the per-session mutex (D8). Revisit
   batching if noisy.
2. ~~Diff preview cost~~ — **Answered:** compact `+N −M` summary, diff collapsed, expand on
   demand (mockup b-edit). Large diffs are truncated in `metadata.diff` with a byte cap.
3. ~~Live toggle mid-turn~~ — **Answered (D4).**
4. ~~Shared package home.~~ — **Settled (spike 0.4, 2026-10-19): `packages/shared/src/tool-gate/`**
   (import `@blackbelt-technology/pi-dashboard-shared/tool-gate/<file>.js`). Both `packages/extension`
   and `packages/chat-gateway` already depend on `pi-dashboard-shared`; its `./*` export map needs no
   change, and no new published workspace package / release-ordering step is required (D13's
   publish-order note is moot). The tool-gate files import no dashboard protocol types.
5. **Do `Agent` subagent tool calls reach the parent's `tool_call`?** pi documents nested
   `ctx.executeTool` calls traversing `tool_call` (`docs/extensions.md:149`), but an `Agent`
   subagent is a separate process — unverified. Gating `Agent` itself (D2) is the coverage
   until answered, and the `Agent` card states (required copy) that the subagent's own
   commands and edits are not approved one by one. **Spike before implementation.**
   **Spike result (0.1, 2026-10-19 — answered: NO).** The `Agent` child is a separate in-process
   `AgentSession` (`createAgentSession` in pi-dashboard-subagents `extensions/agent.ts:364`) with its own
   `ExtensionRunner`; `_beforeToolCall` emits only to its own session's runner
   (`agent-session.js:323-333`). The parent's `tool_call` never sees the child's calls, and the bridge
   never registers in the child either (`initBridge` returns on re-entry, `bridge.ts:161`, before any
   `pi.on`), so no supervised gate runs there. Gating `Agent` itself (D2) is therefore the ONLY
   subagent coverage; the required `Agent` card caveat stands. Executable proof:
   `supervised-gate/__tests__/pi-runtime-spikes.test.ts` (#X11) — real parent + child sessions: child
   `bash` runs, the parent handler sees only the `Agent` call.
6. ~~Richer payload~~ — **Answered (D3):** stock `select` + kind-branched card; persistent
   allow-rules remain a follow-up.

## Alternatives considered

- **OS sandbox to mirror `workspace-write`.** Rejected — pi declines in-process sandboxing
  (`docs/security.md:3-7`); containers already exist (D1).
- **Replace built-in tools with gated custom tools.** Rejected — brittle, redundant with
  `tool_call` block.
- **Server-side gating.** Rejected — the veto must run in-process with pi.
- **Fold supervised into the path gate.** Rejected — different facts (where vs what), and
  the coordination note keeps `decidePathAccess` pure; composition rule in D14.
- **Stock `SelectRenderer` with markdown only (no dedicated card).** Rejected for the
  dashboard — no countdown, no deny reason, uncollapsible diff — but it is exactly the
  fallback every other surface uses (D3).
