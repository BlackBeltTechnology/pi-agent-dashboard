## Context

- **Pending-prompt registry.** `packages/server/src/pairing/browser-gateway.ts:707`
  (`pendingPromptRequests`, in-memory `Map<sessionId, Map<promptId, msg>>`);
  `trackPromptRequest` `:814`, `clearPromptRequest` `:826` (pure map op, no
  broadcast), `reconcilePromptRequests` `:834` (drops ids missing on replay),
  `clearPendingRequestsForSession` (bulk drop, `browser-gateway.ts:2774`).
  Session death drops both pending registries
  (`packages/server/src/event-wiring.ts:700`). `prompt_dismiss`/`prompt_cancel`
  clear at `event-wiring.ts:2470`. Notify-shaped requests are filtered before
  tracking (notify guard in `event-wiring.ts`; spec `notify-message-channel`).
  File-access prompts carry `metadata.kind ∈ {agent-path-gate,
  agent-path-gate-confirm}` (`event-wiring.ts:366`).
- **Prompt shape.** `PromptRequest { id, pipeline, type, question, options,
  defaultValue, metadata }` (`packages/extension/src/prompt-bus.ts:27`); `type`
  includes `editor` and `batch`. The `ask_user` `message` is passed as a UI
  option (`packages/extension/src/ask-user-tool.ts:366`, `:419`); the UI patch
  builds metadata from it for confirm and sets `metadata.questions` for batch
  (`packages/extension/src/bridge-handlers/ui-prompt-patch.ts:124`, `:168`).
- **Timeout.** Default 300 s (`packages/shared/src/config.ts:1062`); the bridge
  maps `<= 0` to infinite (`packages/extension/src/bridge-handlers/lifecycle.ts:301`);
  PromptBus cancels on expiry (`prompt-bus.ts:151`).
- **Answer delivery.** Browser `prompt_response` forwarded at
  `browser-gateway.ts:2271` (ignores the `sendToSession` boolean,
  `packages/server/src/pi/pi-gateway.ts:124`); client encodes renderer results in
  `packages/client/src/lib/chat/prompt-answer-encoder.ts` (client-only today).
- **Ownership.** Spec `session-ownership-scoping`: owner equality per item on every
  road; automation sessions stay ownerless and are hidden from human principals
  while a resolver is active. Route families:
  `packages/server/src/identity/http-road-classification.ts:43`
  (`FAMILY_BY_SEGMENT`); unclassified → 403 under an active policy
  (`identity-road-gate.ts`).
- **MCP completeness.** `packages/server/src/__tests__/mcp-manifest-completeness.test.ts`
  requires every route bound or denylisted
  (`packages/mcp-server-plugin/src/server/tools.denylist.ts`) and listed in
  `ROUTE_TIERS`.
- **Chat gateway.** Invoker-only applies to Discord controls; answering on another
  surface (web UI) is specified ("Answer elsewhere dismisses the chat prompt",
  spec `chat-gateway`). Sessions carry `pluginRef.kind === "chat-gateway"`.
- **Model access.** No server-side role resolver exists (lookup lives in
  `packages/extension/src/role-manager.ts`). Pieces available: `parseRoleConfig`
  (`packages/shared/src/role-schema.ts:232`, the mandated shared normalizer),
  `resolveModelRef` (`role-schema.ts:204`), providers file path
  (`packages/server/src/routes/provider-routes.ts:31`), `getModelRegistry`
  (`packages/server/src/model-proxy/registry-singleton.ts:88`),
  `getStreamSimpleFn` (`registry-singleton.ts:153`).
- **Reconnect timing.** Bridge reconnect backoff caps at 30 s, quarantine at 5 min
  (`packages/extension/src/connection.ts:366`, `:1181`); the event store is an
  in-memory LRU (`packages/server/src/persistence/memory-event-store.ts`).
- **Spawn env.** `scope.extensionConfig` → `PI_EXT_<NAME>_<KEY>`, values
  `string | string[]` (spec `plugin-spawn-scope`;
  `packages/server/src/spawn-process/process-manager.ts:446`).
- **Decomposition.** Spec `browser-gateway-decomposition` extracts handlers out of
  `browser-gateway.ts`; new logic goes in its own module.

## Goals / Non-Goals

**Goals:** one visibility-scoped list of all open questions; answer without the
chat log; the same data over REST; snapshot + brief computed once, stored,
restart-safe; automation and goal questions do not silently expire.

**Non-Goals:** MCP tool exposure (routes denylisted with a reason; follow-up);
changing the global 300 s default; auto-answers; changing inline placement, push,
the folder rollup or widget-bar card suppression; answering file-access prompts
through the new surfaces; wiring workflow spawns (done in `add-project-workflows`,
whose executor does not exist yet).

## Decisions

**D1 — `question-store.ts`, hooked from the registry; one removal funnel.** A new
server module owns `QuestionRecord`s. The gateway calls `onTracked` from
`trackPromptRequest` (after the notify guard) and `removeQuestion(sessionId,
promptId, reason)` from every removal path: `clearPromptRequest`,
`reconcilePromptRequests`, `clearPendingRequestsForSession`, session death. A
transmitted answer hides the row immediately; the `prompt_dismiss` echo then
removes it. `hasPendingPromptRequests` and the `embed-session-lifecycle` union
signal are unchanged; the raw map stays private (spec `prompt-derived-tool-state`).
Question id = random 128-bit base64url mapped from `(sessionId, promptId)`;
prompt ids are fresh UUIDs (`packages/extension/src/prompt-bus.ts:134`), so a
repeated `(sessionId, promptId)` is always a re-send and maps to the same id
(lookup by key happens before minting).

**D2 — Best-effort snapshot at first observation.** Last assistant text (≤ 8 KB)
and ≤ 5 tool calls from the in-memory event store; `metadata.workflowRun` when
present. Absent parts recorded with reason `none` or `evicted`. Redaction with a
shared pattern set `REDACTION_PATTERNS_V1` in `packages/shared` before persisting
and before generation: `Authorization: Bearer …`, `sk-[A-Za-z0-9_-]{16,}`,
`(api|access|secret)[_-]?key\s*[:=]\s*\S+`, `password\s*[:=]\s*\S+`,
`-----BEGIN [A-Z ]*PRIVATE KEY-----…-----END …-----`, AWS `AKIA[0-9A-Z]{16}`. The
set is versioned; the version is stored with the snapshot. Reviewed by `Audit`
before the generator lands.

**D3 — Context message carriage.** Verify that the `ask_user` `message` reaches
prompt metadata for every type (confirm already does; check select, input,
editor, batch top-level) and add carriage only where a test fails.

**D4 — Brief policy.** `provided` when `len(message) ≥ questions.minBriefChars`
(240). Else generate unless `questions.autoBrief=false`. "Summarize" in the
dialog generates on demand for non-generated briefs. Fixed prompt: question,
options, message, snapshot → ≤ 120 words: task / why asking / per-option outcome.
Timeout 20 s; global concurrency cap 2 with a FIFO queue; async I/O only.
Per-option outcomes are required only for option-bearing types; a snapshot
without assistant text yields a brief labelled "limited context".

**D12 — Settings.** `questions.autoBrief` (default true) and
`questions.minBriefChars` (default 240, clamp 0–4000) are dashboard config fields
following the existing `shared-config` rules (defaults not written by
`ensureConfig`; invalid → default).

**D5 — Server-side `@fast` resolution.** Read `~/.pi/agent/providers.json`,
normalize with `parseRoleConfig`, resolve `@fast` with `resolveModelRef`, find the
resolved `provider/id` in `getModelRegistry()`, call `getStreamSimpleFn()` with
that model. Credentials come from the dashboard's single auth store (same as the
model proxy). Unbound role, unknown model or missing registry → `unavailable` (no
call). *Alternative:* round-trip through the extension `role:resolve-model`
listener; rejected because it needs a live session and the brief must work for
any session.

**D6 — Durable per-question files.** `~/.pi/dashboard/questions/<id>.json`
(mode 0600, atomic tmp+rename) holding `(sessionId, promptId)`, snapshot, brief,
`briefStatus` incl. the `failed` tombstone. One file per question avoids
read-modify-write races. No timer-based sweep: a file is deleted by
`removeQuestion`, on session end, or at boot when its session is unknown to the
persisted session store or recorded as ended (a live headless session awaiting a
quarantined reconnect is present in the persisted store, so its files survive).
A re-send after restart rebinds the file by `(sessionId, promptId)`.

**D7 — Light broadcast, lazy detail.** `questions_update` carries rows only;
adds and brief changes debounced (trailing 250 ms), removals immediate. Each
receiving socket gets only rows whose session passes that socket's session-list
visibility predicate (computed per recipient).

**D8 — Answer path.** REST validates the answer string per type with a validator
moved to `packages/shared` with the encoder (round-trip tested; wire format equals
today's chat). A synchronous claim in the question store is taken before
forwarding through the existing `prompt_response` path; the browser's
`prompt_response` takes the same claim. If `sendToSession` returns false the claim
is released and `{ transmitted: false }` returned. Bridge-side cancels/timeouts
remove the question; they are not claims. A transmitted claim is kept 10 min
(409 window, in memory only; after a restart an old id returns 404). The row is
hidden from the stack on transmit; the registry entry (and so the pending-ask
reaping veto) stays until the bridge's `prompt_dismiss` echo, which already
reaches every PromptBus adapter including the chat gateway. File-access → 403 (they keep
`/api/access/prompts/:promptId`, `operate`). Chat-gateway sessions: same
authorization as the existing dashboard-chat answer.

**D9 — Routes, tiers, identity, MCP.** `route-tiers.ts`: GET `observe`, POST
`control`. `http-road-classification.ts`: `questions` family with per-item
visibility check (list filters; detail/answer 404). MCP: denylist the three
routes ("agent prompt answers stay human-in-the-loop; follow-up").

**D10 — Visibility routing (client).** Visible = board session not hidden.
Visible → select (reveal through filters/collapsed folder) + open chat + scroll to
the pending prompt; widget-bar prompt → focus the owning slot. Otherwise → dialog.

**D11 — Timeout override (scoped, user decision).** The bridge reads
`PI_EXT_PI_DASHBOARD_ASK_USER_PROMPT_TIMEOUT_SECONDS` before building PromptBus
(`lifecycle.ts:301`); precedence override > config. Spawners pass
`scope.extensionConfig: { "pi-dashboard": { askUserPromptTimeoutSeconds: "0" } }`.
This change wires the automation engine spawn and goal `spawnDriver`. The
cwd-policy rejection of `extensionConfig`
(`packages/server/src/spawn-process/cwd-policy.ts:286`) applies only to
`registerCwdPolicy`, not to spawn scope.

## Risks / Trade-offs

- **Chat content to the `@fast` provider** (may differ from the session's).
  Mitigation: redaction, bounded snapshot, `autoBrief` off switch, documented.
- **Generated brief quality.** Always labelled; raw context one click away.
- **Multi-principal installs hide ownerless automation questions** from humans,
  matching the board. Workflow-started runs get an owner via the owned-spawn road
  in `add-project-workflows`.
- **Indefinite waits pin automation slots** until the max-age reaper finalizes
  the run and terminates its session.
- **Registry coupling.** Removals funnel through one function; a test enumerates
  the removal paths.
- **Widget-bar double signal.** Stack lists widget-bar prompts while card pulse
  suppression stays; accepted (user: the stack shows all open questions).
- **Rollback:** remove the stack component and routes; delete
  `~/.pi/dashboard/questions/`; the env override is inert without spawners
  setting it.
