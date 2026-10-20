# Tasks — add-supervised-tool-approval

Test tasks are folded from `test-plan.md` (the manifest). Each carries its harness exemplar,
its Triple, and its manifest id. Manifest dispositions — not tags here — are the source of
truth for automated vs manual. Design refreshed 2026-10-19 against shipped code (path gate,
YOLO, pi 1.3.0) — see `design.md`.

## 0. Blocking spikes (settle before the dependent tasks land)

- [x] 0.1 Spike: does an `Agent` child's tool call surface on the parent session's
      `tool_call` stream? Settles design open question 5 and whether `Agent`-in-the-risky-set
      is the only subagent coverage. Author as a test (folded below).
- [x] 0.2 Spike: does pi emit `tool_execution_end` for a tool blocked by a *later*
      `tool_call` handler? Settles design D8's fan-out permit risk. If it does not, the
      supervised gate releases the fan-out permit itself when it blocks an `Agent` call (no
      pre-check ahead of fan-out). Author as a test (folded below).
- [x] 0.3 Spike: do `codemode` script calls (`tools.<name>(args)`) traverse `tool_call`
      individually, as `ctx.executeTool` nested calls do (`docs/extensions.md:149`)? Settles
      whether `codemode` is a wrapper tool (D2).
- [x] 0.4 Settle design open question 4: home for the shared tool-gate package
      (`packages/tool-gate` vs a `packages/shared` subpath). `packages/extension` must not
      depend on the chat-gateway plugin (D13).

## 1. Shared tool-gate package (extraction of shipped code)

- [x] 1.1 Create the shared workspace package at the location settled in 0.4.
- [x] 1.2 Move `decideToolCall` + `ToolPolicy` from
      `packages/chat-gateway/src/guard/policy.ts` into the shared package.
- [x] 1.3 Move `createToolCallGuard` from `packages/chat-gateway/src/guard/index.ts` into the
      shared package, replacing its hardcoded chat copy, `chat-gateway:` reason prefix and
      bare-boolean confirm with the injected `ApprovalSurface`
      (`buildPrompt` · `reasonPrefix` · cancellable `request` · required `onDecision`) and the
      `GateOutcome` result per design D9. The guard takes its timeout as a parameter.
- [x] 1.4 `ApprovalSurface` is a required argument with no chat-flavoured default (design D9).
- [x] 1.5 Export a pure `parseToolPolicy(raw, { allowedDefaults })` validator (design D7#4).
- [x] 1.6 Export `markToolGateOwner(sessionId, owner)` / `clearToolGateOwner(sessionId)` /
      `toolGateOwner(sessionId)` over a `Map<sessionId, owner>` at
      `globalThis[Symbol.for("pi-dashboard.toolGateOwner")]` (jiti `moduleCache: false` →
      module-level state is not shared) (design D12).
- [x] 1.6a Widen chat-gateway `GuardPi` / `GuardCtx` (`guard/index.ts:23-36`) with
      `session_start` / `session_shutdown` hooks and session-id access (design D12).
- [x] 1.7 Migrate chat-gateway: keep `policyFromEnv` in `packages/chat-gateway`, calling
      `parseToolPolicy` with `allowedDefaults: ["deny","approve"]`; add a chat-gateway
      `ApprovalSurface` adapter supplying its existing copy, prefix, `ctx.ui.confirm`
      transport and 60 s timeout (user-visible behaviour unchanged; `true` → `"Allow once"`,
      `false` → `undefined`, `cancel()` no-op, `onDecision` = one console line); mark the
      owner in the guard's `session_start` and clear it in `session_shutdown` — never at
      registration (no session id there).
- [x] 1.7a The chat-gateway `./guard` `createToolCallGuard({ policy })` entry validates its
      policy through `parseToolPolicy` with `allowedDefaults: ["deny","approve"]`, so a raw
      `"allow"` can never reach the gateway path (design D7).
- [x] 1.8 Keep the published `./guard` export subpath of
      `@blackbelt-technology/pi-dashboard-chat-gateway-plugin` working as a re-export.
- [x] 1.9 Move `guard.test.ts` / `policy.test.ts` to the shared package with their
      **assertions unchanged**; only imports and `ApprovalSurface` setup change (design D9).
- [x] 1.10 Record release ordering: shared package published before the chat-gateway version
      that re-exports it; post-release rollback is a forward fix (design D13).

## 2. Policy widening (`defaultAction: "allow"`)

- [x] 2.1 Widen `ToolDefaultAction` (`policy.ts:18`) to `"deny" | "approve" | "allow"` AND add
      the explicit `"allow"` branch to the resolution (`policy.ts:54-56`) (design D7).
- [x] 2.2 Keep an absent `defaultAction` resolving to `"deny"`.
- [x] 2.3 Leave `normalizeToolPolicy` (`chat-gateway/src/server/config.ts:98-106`) coercion and
      the chat-gateway `configSchema.json` enum at `["deny","approve"]`.

## 3. Bridge gate

- [x] 3.1 Register the supervised gate in `packages/extension/src/bridge.ts` AFTER the agent
      path gate (`bridge.ts:1950-1956`) — fourth handler (design D8), subject to 0.2.
- [x] 3.2 Register it WITHOUT `safe()`; own `try/catch` returns `{ block: true, reason:
      "supervised: error" }` on any internal failure (design D8).
- [x] 3.3 Per-session prompt mutex (path-gate `handler.ts:322-330` pattern): concurrent risky
      calls raise approvals one at a time per session; other sessions never wait.
- [x] 3.4 Read the supervised flag per tool call (design D4).
- [x] 3.5 Build the prompt from `event.input`: command text for `bash`/`powershell`; target
      path + `+N −M` stat + diff capped at 16 KiB (`… (truncated)`) for `edit`/`write` (create vs replace); subagent
      type + task for `Agent`; `plainMessage` for the terminal (design D3).
- [x] 3.6 Send via `PromptBus.requestWithId` as a `select` with options `Allow once` / `Deny`,
      `metadata.kind: "supervised-tool-approval"`, `deadline`, `toolCallId`; map exact
      `Allow once` → allow, any other answer → deny, non-label answer → reason (design D3).
- [x] 3.7 Match tool names case-insensitively by lower-casing both sides in the supervised
      policy builder; the shared `decideToolCall` stays exact-match (design D2).
- [x] 3.8 Allow-first: only the configured set is gated; a tool outside
      `readFamily ∪ riskySet ∪ wrapperTools` runs and is logged once per session; annotations
      are ignored. Drift test over a fixture of the pinned pi built-in tool list; add its
      regeneration to the `bump-pi-version` procedure (design D2).
- [x] 3.8a No UI: when `!ctx.hasUI`, a Supervised session blocks a risky call at once with
      `supervised: no-ui` (design D5).
- [x] 3.9 Self-disable when `toolGateOwner() === "chat-gateway"` — do NOT sniff
      `PI_EXT_CHAT_GATEWAY_GUARD_POLICY` (design D12).
- [x] 3.10 Path-gate enrichment: when the session is Supervised and the tool is risky, the
      path gate appends the supervised summary (stat + byte-capped diff / new content /
      command) to its prompt `message` and `plainMessage` and sets `metadata.supervised: true`,
      via a narrow accessor for supervised-in-effect (mode on AND owner ≠ chat-gateway) + the
      risky set; a guard-owned gateway session never enriches (design D14).
- [x] 3.11 Path-gate hand-off: the path gate records a `toolCallId` whose enriched prompt the
      operator answered **Allow once** (Always + confirm records nothing; `source` is not used
      for trust) in a per-session set (64 ids, FIFO, keyed by captured session id); the
      supervised gate consumes the id and allows,
      logging `via: "path-gate"`. Silent allows (in-root, grant, YOLO) are not recorded (design D14).
- [x] 3.12 Abort: the gate listens on `ctx.signal`, checked before and after acquiring the
      mutex; abort → `PromptBus.cancel(id)` and block with `supervised: aborted` (design D8).
- [x] 3.13 Deny reason hygiene: strip control characters, cap at 500 characters, deliver as
      `supervised: denied — operator said: "<text>"` (design D3).
- [x] 3.14 Report `toolGateOwner` to the server with the session registration (design D12).

## 4. Mode flag + config

- [x] 4.1 Add `supervisedMode: { default: "full" | "supervised", timeoutSeconds, tools }` to
      shared config (`packages/shared/src/config.ts`, shaped like `agentPathGate` at `:840-845`):
      defaults `"full"`, 120, `["bash","powershell","write","edit","Agent"]`; a timeout absent,
      non-numeric or below 10 resolves to 120 (design D10).
- [x] 4.2 Add the session-scoped `set_supervised {on}` control message (server → bridge over
      the session's authenticated bridge connection, `server.ts:4031` /
      `bridge-handlers/dispatch.ts:321` pattern); malformed payload ignored. Not an
      event-protocol change.
- [x] 4.2a Bridge persistence: each flip writes `pi.appendEntry("supervised-mode", {on})`;
      `session_start` (new / resume / fork / switch) restores the last entry for that session
      id before any tool call; state is a `Map<sessionId, boolean>` in process-global
      `BridgeState`; no entry → config default (design D4).
- [x] 4.2b Server persistence: add `{ on, rev }` to `session/session-to-meta.ts`, restore it
      on registration, reconcile with the bridge's `{ on, rev }` (higher `rev` wins;
      Supervised only on tie/missing), persist, send `set_supervised { on, rev }` (design D4).
- [x] 4.2d Bridge → server `supervised_state { on, rev, toolGateOwner }` report when either
      changes after registration; registration carries the same fields (design D4, D12).
- [x] 4.2c Browser → server mode change is session-owner only (the `send_prompt` gate,
      `ws-message-scope.ts:48`; others dropped silently, mode kept); server logs
      `[supervised] mode on|off rev=<n> session=<id> source=<connId>` (design D4).
- [x] 4.3 A flag flip never auto-resolves an already-pending approval (design D4).
- [x] 4.4 Add a read accessor for the session's PromptBus timeout; the gate's deadline is
      `max(1 s, min(supervisedMode.timeoutSeconds, busTimeout − 1 s))` (bus ≤ 0 → supervised
      value), started when the prompt opens (after the mutex); Settings warns when the bus
      timeout undercuts it; on expiry it calls `PromptBus.cancel(id)`. No per-request
      override — the bus timeout stays uniform (`ask-user-tool` spec) (design D10).
- [x] 4.4a Outcome attribution by a per-request `selfCancel` reason set before the gate
      cancels: `approved` / `denied` / `dismissed` (cancel the gate did not initiate) /
      `timeout` / `aborted` / `error`, each with its own block reason (design D10).
- [x] 4.5 Timeout bounds: below 10, above 3600, non-numeric or a parse error → 120; the
      shared core takes strictly positive ms (design D10).
- [x] 4.5a Server normalises `supervisedMode.timeoutSeconds` on `PUT /api/config`: out of
      range persists 120 (design D10).
- [x] 4.6 Restore failure → Supervised + `[supervised] mode restore failed` log (design D4).
- [x] 4.7 On `session_shutdown`, clear the session's mode entry, mutex chain and hand-off
      set (design D4).

## 5. Client + server UI

UI reference: `mockups/index.html` + `mockups/ui-plan.md` (states a-*, b-*, c-*).

- [x] 5.1 Mode chip in the composer settings row (`CommandInput.tsx` `toolbarExtra`) with the
      two-option menu and scope caveat; folds into ⋯ below `@[44rem]`; static "Gateway policy"
      note on gateway-spawned sessions (mockup a-*).
- [x] 5.1a Pass the supervised metadata keys (`kind`, `deadline`, `tool`, `summary`,
      `command`, `path`, `diffStat`, `diff`, `cwd`) through at BOTH client prompt sites:
      `hooks/useMessageHandler.ts:1858-1882` (live) and `hooks/useSessionState.ts:161-178`
      (replay) (design D3).
- [x] 5.2 Approval card `ToolApprovalCard.tsx`, selected by a `SelectRenderer` branch on
      `metadata.kind === "supervised-tool-approval"` in `packages/client/src/components/interactive-renderers/`:
      verb title, tool chip, command / path + collapsed diff, countdown from `deadline`,
      Allow once / Deny / Deny with a reason (a reason equal to an option label is
      rejected by the field); no Cancel, no preselection or autofocus;
      collapsed resolved rows per outcome (mockup b-*).
- [x] 5.3 Server: derive `awaitingToolApproval` from pending `supervised-tool-approval` prompts
      beside `awaitingFileAccess` (`packages/server/src/event-wiring.ts:377-390`) (design D16).
- [x] 5.4 Shared predicate `awaitingOperatorApproval` in `packages/shared/src/`; every
      `awaitingFileAccess` consumer switches to it: `SessionCard.tsx` ("Needs you"),
      `lib/session/session-lanes.ts`, `session-status-visuals.ts`,
      `server/src/pairing/browser-gateway.ts`; plus a toast for the new kind
      (`useFileAccessToasts.ts` pattern) (design D16).
- [x] 5.4a Client hides the mode chip only when the session's `toolGateOwner` is
      `"chat-gateway"` (design D12).
- [x] 5.5 Settings → Security "Tool approval (Supervised mode)" section next to
      `AgentPathGateSection`: default mode, timeout (min 10 s), editable tool list; no
      allow-list field (design D2, D10; mockup c-*).

## 5a. Question stack

- [x] 5a.1 Add `supervised-tool-approval` to the read-only, never-briefed kinds in
      `packages/server/src/questions/question-store.ts` (`FILE_ACCESS_KINDS` pattern, `:43-44`,
      `originOf` `:190-191`); the REST answer route rejects it (design D17).

## 5b. Chat gateway

- [x] 5b.1 The gateway skips `prompt_request` frames whose `metadata.kind ===
      "supervised-tool-approval"` or `metadata.supervised === true`
      (`chat-gateway/src/server/gateway.ts:1538-1565`) for spawned and attached sessions
      alike (design D17; delta `specs/chat-gateway/spec.md`).

## 6. Observability

- [x] 6.1 `onDecision` writes a `supervised-tool-decision` durable entry via `pi.appendEntry`
      plus a control-character-free `[supervised]` console line: session id, tool, action
      summary (≤ 500 chars, secret-redacted), `GateOutcome`, `answeredSurface` (incl.
      `error`), `via` (design D11).

## 7. Docs & safety wording

- [x] 7.1 Copy says "approve each action the agent takes" / "not a sandbox"; never "sandboxed" /
      "safe" / "isolated"; names the container path; states operator `!` shell and
      extension-initiated execution are not covered; states YOLO does not answer approvals;
      the `Agent` card states the subagent's own calls are not approved one by one; the
      user-facing note states that a later-loaded extension can still change an approved
      tool's input (design D8); Settings hint + docs name the allow-first gap: extension tools
      that run commands (e.g. context-mode's `ctx_execute`) are not asked about until added
      (design D2).
- [x] 7.2 Delegate the `docs/` note (supervised mode: scope, approval ≠ sandbox,
      container-for-isolation, config keys, path-gate composition) to DocScribe in caveman style.

## 8. Folded test scenarios

### L1 — vitest

- [x] 8.1 Configurable risky-tool set — default set — see
      `packages/chat-gateway/src/guard/__tests__/policy.test.ts`. Triple: supervised policy
      builder with unset `supervisedMode.tools` →
      `{approval:["bash","powershell","write","edit","Agent"],defaultAction:"allow"}` ·
      `decideToolCall(name)` for
      `bash`,`powershell`,`write`,`edit`,`Agent`,`read`,`grep`,`find`,`ls` · first five
      `action:"approve"`; last four `action:"allow"` (test-plan #E1)
- [x] 8.2 Widen `ToolDefaultAction` with `"allow"` — see
      `packages/chat-gateway/src/guard/__tests__/policy.test.ts`. Triple:
      `{approval:["bash"],defaultAction:"allow"}` · `decideToolCall("read")` · `{action:"allow"}`
      — not `deny` (guards type-widened-without-branch bug) (test-plan #E2)
- [x] 8.3 Chat-gateway posture unchanged (absent default) — see
      `packages/chat-gateway/src/guard/__tests__/policy.test.ts`. Triple: `{allow:["read"]}`,
      `defaultAction` absent · `decideToolCall("rm_tool")` ·
      `{action:"deny",reason:"denied_by_default"}` (test-plan #E3)
- [x] 8.4 `"allow"` not exposed in gateway config — see
      `packages/chat-gateway/src/server/__tests__/config.test.ts`. Triple: gateway config
      `toolPolicy.defaultAction:"allow"` · `normalizeToolPolicy` + `configSchema.json` validation
      · normaliser coerces to `"deny"`; schema rejects (`enum:["deny","approve"]`) (test-plan #E4)
- [x] 8.5 `"allow"` not exposed via env — see
      `packages/chat-gateway/src/guard/__tests__/guard.test.ts`. Triple:
      `PI_EXT_CHAT_GATEWAY_GUARD_POLICY='{"defaultAction":"allow"}'` · `policyFromEnv()` →
      `parseToolPolicy(raw,{allowedDefaults:["deny","approve"]})` · resolved
      `defaultAction:"deny"` (test-plan #E5)
- [x] 8.6 Case-insensitive matching (supervised builder only) — see
      `packages/chat-gateway/src/guard/__tests__/policy.test.ts`. Triple:
      `supervisedMode.tools:["Agent"]` · supervised builder decides `agent`, `AGENT`, `Agent` ·
      all three `approve`; the shared `decideToolCall` is called with lower-cased names on both
      sides (test-plan #E6)
- [x] 8.7 Configured set authoritative (no read exemption) — see
      `packages/chat-gateway/src/guard/__tests__/policy.test.ts`. Triple:
      `supervisedMode.tools:["read"]` · supervised gate sees `read` · `approve` → a prompt is
      requested for `read` (test-plan #E7)
- [x] 8.8 Default set does not drift from pinned built-ins — see
      `packages/shared/src/__tests__/config.test.ts`,
      `packages/extension/src/__tests__/empty-actionable-guard-config.test.ts`. Triple: fixture of
      pinned pi 1.3.0 built-ins `read,bash,powershell,edit,write,grep,find,ls` +
      `codemode,tool_search`; variant fixture adds `patch_file` · drift test classifies each
      against `readFamily ∪ riskySet ∪ wrapperTools` · pinned fixture passes; variant FAILS with a
      message naming `patch_file` (test-plan #E8)
- [x] 8.9 Approval timeout boundary (single clock) — see
      `packages/extension/src/path-gate/__tests__/handler.test.ts`. Triple: `timeoutSeconds:120`,
      bus timeout 300, fake timers · answer arrives at 119.9 s / 120.0 s / 120.1 s after prompt
      opens · 119.9 s → honoured; 120.0 s and 120.1 s → `{block:true}`, outcome `timeout`,
      `PromptBus.cancel(id)` called once (test-plan #E9)
- [x] 8.10 Timeout config default — see `packages/shared/src/__tests__/config.test.ts`,
      `packages/extension/src/__tests__/empty-actionable-guard-config.test.ts`. Triple:
      `~/.pi/dashboard` without `supervisedMode` / with `timeoutSeconds:45` · resolve config · 120
      / 45 (test-plan #E10)
- [x] 8.11 Full access — flag off is inert — see
      `packages/extension/src/path-gate/__tests__/handler.test.ts`. Triple: session mode `false` ·
      `bash` call reaches the supervised gate · returns `undefined`; surface `request` never
      called; no decision entry written (test-plan #E11)
- [x] 8.12 Config default starts sessions Supervised — see
      `packages/shared/src/__tests__/config.test.ts`,
      `packages/extension/src/__tests__/empty-actionable-guard-config.test.ts`. Triple:
      `supervisedMode.default:"supervised"`, new session, no `supervised-mode` entry ·
      `session_start` · session mode `true` before the first `tool_call`; first `bash` requests a
      prompt (test-plan #E12)
- [x] 8.13 `allow` beats `approval` (pinned precedence) — see
      `packages/chat-gateway/src/guard/__tests__/policy.test.ts`. Triple:
      `{allow:["bash"],approval:["bash"],defaultAction:"allow"}` · `decideToolCall("bash")` ·
      `{action:"allow"}` (test-plan #E13)
- [x] 8.14 Timeout bounds — see `packages/shared/src/__tests__/config.test.ts`,
      `packages/extension/src/__tests__/empty-actionable-guard-config.test.ts`. Triple:
      `timeoutSeconds` = 9 / 10 / 11 / 3599 / 3600 / 3601 / `"abc"` / `-5` / config file with a
      JSON parse error · resolve config · 120 / 10 / 11 / 3599 / 3600 / 120 / 120 / 120 / 120
      (test-plan #E14)
- [x] 8.15 Effective deadline = `max(1, min(cfg, bus−1))` — see
      `packages/extension/src/path-gate/__tests__/handler.test.ts`. Triple: (cfg, bus s):
      (120,300) (120,60) (10,11) (10,10) (120,2) (120,1) (120,0) (120,−1) · gate opens prompt;
      read `metadata.deadline − openedAt` and the bus-timeout accessor · 120 / 59 / 10 / 9 / 1 / 1
      / 120 / 120; gate timer always fires before the bus backstop (test-plan #E15)
- [x] 8.16 Answer mapping — see `packages/extension/src/path-gate/__tests__/handler.test.ts`.
      Triple: answers `"Allow once"`, `"Deny"`, `"allow once"`, `""`, `"run it in /tmp"` · gate
      maps the select answer · allow / deny (no operator text) / deny with reason `allow once` /
      deny / deny with reason `run it in /tmp`; only exact `Allow once` runs the tool
      (test-plan #E16)
- [x] 8.17 Deny reason hygiene — see `packages/extension/src/path-gate/__tests__/handler.test.ts`.
      Triple: reason `"\x1b[31mno\x07pe\r\n"`; reason of 499 / 500 / 501 chars · deny with reason
      · block reason `supervised: denied — operator said: "<text>"`; text contains no
      U+0000–U+001F/U+007F; 499/500 intact, 501 truncated to 500 (test-plan #E17)
- [x] 8.18 Card rejects a reason equal to an option label — see
      `packages/client/src/components/__tests__/SelectRenderer.test.tsx`,
      `packages/client/src/components/__tests__/ConfirmRenderer.test.tsx`. Triple:
      `ToolApprovalCard`, reason field `Allow once` / `Deny` / `nope` · submit Deny-with-reason ·
      first two: field error, no `prompt_response` sent; `nope`: response sent with answer `nope`
      (test-plan #E18)
- [x] 8.19 Path-gate hand-off set bound — see
      `packages/extension/src/path-gate/__tests__/handler.test.ts`. Triple: one session; 63 / 64 /
      65 enriched path prompts answered `Allow once` (ids `t1..t65`) · supervised gate sees `t1` ·
      63, 64: `t1` consumed, allowed without prompt, decision `via:"path-gate"`; 65: `t1` evicted
      → supervised prompt requested (test-plan #E19)
- [x] 8.20 Hand-off only for Allow once on an enriched prompt — see
      `packages/extension/src/path-gate/__tests__/handler.test.ts`. Triple: path-gate outcomes:
      Allow once (enriched) / Always allow + confirm / silent in-root allow / existing grant /
      YOLO auto-allow · supervised gate sees the same `toolCallId` · only Allow once skips the
      prompt (and only once: a 2nd call with the same id prompts); the other four request a
      supervised prompt; `source` value never changes the result (test-plan #E20)
- [x] 8.21 Path-prompt enrichment decision table — see
      `packages/extension/src/path-gate/__tests__/handler.test.ts`,
      `packages/extension/src/path-gate/__tests__/prompt-bus-wiring.test.ts`. Triple: (mode, tool,
      owner): (on,`edit`,none) (on,`write`,none) (off,`edit`,none) (on,`read`,none)
      (on,`edit`,`chat-gateway`) · path gate builds its out-of-root prompt · rows 1–2: `message`
      and `plainMessage` contain `+N −M` stat + diff/new content, `metadata.supervised:true`; rows
      3–5: unchanged prompt, no `metadata.supervised` (test-plan #E21)
- [x] 8.22 Accepted double-prompt exceptions — see
      `packages/extension/src/path-gate/__tests__/handler.test.ts`. Triple: (a) out-of-root `edit`
      with no `toolCallId`; (b) path prompt opened while session Full, then flipped Supervised,
      answered Allow once · supervised gate runs · both raise a supervised prompt (never zero)
      (test-plan #E22)
- [x] 8.23 Unclassified tool runs, logged once, annotations ignored — see
      `packages/extension/src/path-gate/__tests__/handler.test.ts`. Triple: Supervised session A
      calls `ctx_execute` twice; session B once; tool `x_tool` with
      `annotations:{destructiveHint:true}`; `bash` registered with `readOnlyHint:true` · gate sees
      each call · `ctx_execute`/`x_tool` run, no prompt; `[supervised] unclassified tool
      ctx_execute` logged exactly once for A and once for B; `bash` still prompts (test-plan #E23)
- [x] 8.24 Custom set extends default — see
      `packages/extension/src/path-gate/__tests__/handler.test.ts`. Triple:
      `supervisedMode.tools:[...default,"ctx_execute"]` · `ctx_execute` call · prompt requested;
      not logged as unclassified (test-plan #E24)
- [x] 8.25 Case-folding does not leak into gateway — see
      `packages/chat-gateway/src/guard/__tests__/policy.test.ts`. Triple: gateway policy
      `{allow:["bash"]}` (default deny) · gateway guard sees tool `Bash` ·
      `{block:true,reason:"chat-gateway: …"}` exactly as pre-extraction (exact match); shared
      engine never lower-cases (test-plan #E25)
- [x] 8.26 `./guard` entry rejects `"allow"` — see
      `packages/chat-gateway/src/guard/__tests__/guard.test.ts`. Triple:
      `createToolCallGuard({policy:{defaultAction:"allow"}})` imported from
      `@blackbelt-technology/pi-dashboard-chat-gateway-plugin/guard` · unlisted tool `foo` called
      · blocked (policy parsed with `allowedDefaults:["deny","approve"]` → `deny`)
      (test-plan #E26)
- [x] 8.27 Owner slot crosses module instances — see
      `packages/extension/src/path-gate/__tests__/production-wiring.test.ts`. Triple: two fresh
      imports of the shared package (`vi.resetModules`) · instance A
      `markToolGateOwner("s1","chat-gateway")` · instance B
      `toolGateOwner("s1")==="chat-gateway"`, `toolGateOwner("s2")===undefined`; A
      `clearToolGateOwner("s1")` → B sees `undefined`; slot is
      `globalThis[Symbol.for("pi-dashboard.toolGateOwner")]` Map (test-plan #E27)
- [x] 8.28 Owner lifecycle in the guard — see
      `packages/chat-gateway/src/guard/__tests__/guard.test.ts`. Triple: chat-gateway guard
      extension with fake `pi` · register → `session_start(s1)` → `session_shutdown(s1)` →
      `session_start(s2)` · after register: no owner; after start s1: `chat-gateway`; after
      shutdown: `undefined`; s2 marked, s1 not (test-plan #E28)
- [x] 8.29 Supervised gate self-disables on guard-owned session — see
      `packages/extension/src/path-gate/__tests__/handler.test.ts`. Triple: mode `true`, owner
      `chat-gateway`; env `PI_EXT_CHAT_GATEWAY_GUARD_POLICY` set but owner unset · `bash` call ·
      owner set → `undefined`, no request; env-only → prompt requested (env never sniffed)
      (test-plan #E29)
- [x] 8.30 Mode restore per session id; no inheritance — see
      `packages/extension/src/__tests__/session-sync.test.ts`. Triple: session file s1 has
      `supervised-mode` entries `{on:true,rev:1}`,`{on:false,rev:2}`; s2 none; config default
      `full` · `session_start` for s1 (resume), then switch/fork to s2 · s1 mode `false` (last
      entry) before first tool call; s2 `false` from config default even though previous session
      was `true` in an earlier variant; state is `Map<sessionId,boolean>` (test-plan #E30)
- [x] 8.31 Revisioned reconciliation — see
      `packages/server/src/__tests__/meta-persistence.test.ts`,
      `packages/server/src/__tests__/memory-session-manager.test.ts`. Triple: (bridge, server):
      ({false,5},{true,4}) ({true,4},{false,5}) ({false,5},{true,5}) ({false,∅},{false,3})
      ({true,2},{true,2}) · bridge registration · winner false / false / true / true / true;
      server meta persists winner; server sends `set_supervised{on,rev}` with winner; bridge
      appends entry (test-plan #E31)
- [x] 8.32 Malformed `set_supervised` ignored — see
      `packages/chat-gateway/src/server/__tests__/dispatch.test.ts`,
      `packages/extension/src/__tests__/prompt-bus.test.ts`. Triple: payloads `{on:"yes"}`, `{}`,
      `null`, `{on:1}`; one pending approval · bridge dispatch · mode unchanged; pending prompt
      still open, not resolved (test-plan #E32)
- [x] 8.33 Metadata pass-through live + replay — see
      `packages/client/src/hooks/__tests__/useMessageHandler.interactive-carry.test.tsx`,
      `packages/client/src/hooks/__tests__/useSessionState.test.ts`. Triple: `prompt_request` with
      `metadata:{kind:"supervised-tool-approval",deadline,tool,summary,command,path,diffStat,diff,cwd,toolCallId}`
      · (a) live `useMessageHandler`; (b) replay `useSessionState` · both produce a prompt object
      carrying all ten keys verbatim (test-plan #E33)
- [x] 8.34 Question stack read-only, REST rejects, never briefed — see
      `packages/server/src/questions/__tests__/question-store.test.ts`,
      `packages/server/src/questions/__tests__/question-routes.test.ts`. Triple: pending prompts
      of kind `supervised-tool-approval` and enriched `agent-path-gate`
      (`metadata.supervised:true`) · `GET /api/questions`, `POST /api/questions/:id/answer`, brief
      scheduler · listed with read-only origin; POST → 403 (file-access precedent) and no
      `prompt_response` forwarded; `briefStatus:"unavailable"`, brief model never called
      (test-plan #E34)
- [x] 8.35 Chat gateway skips supervised + enriched, keeps plain path — see
      `packages/chat-gateway/src/server/__tests__/prompts.test.ts`,
      `packages/chat-gateway/src/server/__tests__/gateway.test.ts`. Triple: bound channel, spawned
      AND attached session; frames: `kind:"supervised-tool-approval"`; `kind:"agent-path-gate",
      supervised:true`; `kind:"agent-path-gate"` (plain); `ask_user` select · gateway receives
      each `prompt_request` · first two: no message/controls posted; plain path prompt and
      ask_user: posted with controls (test-plan #E35)
- [x] 8.36 Attention predicate + consumers — see
      `packages/client/src/lib/__tests__/session-lanes.test.ts`,
      `packages/client/src/lib/__tests__/session-status-visuals.test.ts`. Triple: sessions
      (fileAccess,toolApproval): (F,F) (T,F) (F,T) (T,T) · `awaitingOperatorApproval`;
      `SessionCard`, `session-lanes`, `session-status-visuals`, `browser-gateway` · predicate
      F/T/T/T; card "Needs you" + needs-you lane + urgency on rows 2–4 only (test-plan #E36)
- [x] 8.37 Server derives `awaitingToolApproval` — see
      `packages/server/src/__tests__/path-gate-attention.integration.test.ts`. Triple: session
      with no prompts · `prompt_request(kind supervised)` → `prompt_response` / `prompt_cancel` /
      timeout cancel · flag false → true → false on each resolution path (test-plan #E37)
- [x] 8.38 Per-session mutex serialises — see
      `packages/extension/src/path-gate/__tests__/handler.test.ts`. Triple: session A two
      concurrent `bash` calls; session B one `bash` · dispatch all three · A2's `request` called
      only after A1 resolves; B's `request` called while A1 pending; A2's deadline starts at its
      own open (test-plan #E38)
- [x] 8.39 Agent card states the caveat — see
      `packages/client/src/components/__tests__/SelectRenderer.test.tsx`,
      `packages/client/src/components/__tests__/ConfirmRenderer.test.tsx`. Triple:
      `ToolApprovalCard` with `tool:"Agent"` · render · text states the subagent's own commands
      and edits are not approved one by one (test-plan #E39)
- [x] 8.40 Decision record content, cap, redaction — see
      `packages/extension/src/path-gate/__tests__/handler.test.ts`. Triple: approve a `bash` whose
      command is 600 chars and contains a vault secret value · `onDecision` ·
      `supervised-tool-decision` entry: sessionId, tool, summary ≤500 chars with secret literal
      absent, outcome `approved`, `answeredSurface:"dashboard"`, `via:"supervised"`; console line
      `[supervised] …` with no control chars (test-plan #E40)
- [x] 8.41 Copy never claims isolation — see
      `packages/extension/src/__tests__/no-tui-multiselect-arm-regression.test.ts`. Triple: string
      sources of `ToolApprovalCard`, mode menu, Settings section, docs note · static scan · no
      match for `/\bsandboxed\b|\bsafe\b|\bisolated\b|\bprotected\b/i`; `not a sandbox` present;
      menu names `!` commands + YOLO caveats (test-plan #E41)
- [x] 8.42 No preselection / no autofocus — see
      `packages/client/src/components/__tests__/SelectRenderer.test.tsx`,
      `packages/client/src/components/__tests__/ConfirmRenderer.test.tsx`. Triple: rendered
      `ToolApprovalCard` · mount, then press Enter · no option `aria-checked/selected`;
      `document.activeElement` not inside the card; no `prompt_response` sent (test-plan #E42)
- [x] 8.43 Default config shape — see `packages/shared/src/__tests__/config.test.ts`,
      `packages/extension/src/__tests__/empty-actionable-guard-config.test.ts`. Triple: no
      `supervisedMode` key · resolve config ·
      `{default:"full",timeoutSeconds:120,tools:["bash","powershell","write","edit","Agent"]}`
      (test-plan #E43)
- [x] 8.44 Diff byte cap 16 KiB, truncation marked — see
      `packages/extension/src/path-gate/__tests__/handler.test.ts`. Triple: `edit` whose diff is
      16383 / 16384 / 16385 bytes · build supervised summary (`metadata.diff`) · 16383 and 16384:
      diff verbatim, no marker; 16385: first 16384 bytes kept, then trailing `… (truncated)`
      (test-plan #E44)
- [x] 8.45 Supervised Settings has no allow list — see
      `packages/client/src/components/__tests__/SettingsPanel.test.tsx`. Triple: Security tab
      "Tool approval (Supervised mode)" section · render · fields: default mode, timeout, tools
      chips; no allow-list field (test-plan #E45)
- [x] 8.46 Non-supervised sessions add negligible cost — see
      `packages/extension/src/__tests__/subagent-fanout-admission.test.ts`. Triple: 10 000
      `tool_call` dispatches (`bash`) through the supervised gate, mode `false`, owner slot
      populated with 100 other sessions · measure added latency · p95 added latency per call < 1
      ms (vs no-gate baseline) (test-plan #P1)
- [x] 8.47 Supervised gate on an unclassified/read call — see
      `packages/extension/src/__tests__/subagent-fanout-admission.test.ts`. Triple: 10 000 `read`
      calls, mode `true` (allow path, no prompt) · measure added latency · p95 added latency per
      call < 1 ms (test-plan #P2)
- [x] 8.48 Toggle replaced on guard-owned session — see
      `packages/client/src/components/__tests__/CommandInput.test.tsx`. Triple: `CommandInput`
      rendered with `toolGateOwner:"chat-gateway"` · render · mode chip absent; "Gateway policy"
      note present (test-plan #F11)
- [x] 8.49 Unanswered approval fails closed — see
      `packages/chat-gateway/src/guard/__tests__/guard.test.ts`. Triple: surface never answers ·
      effective deadline elapses · `{block:true}`, outcome `timeout`, `cancel(id)` called, tool
      not run (test-plan #X1)
- [x] 8.50 Sync throw fails closed — see
      `packages/chat-gateway/src/guard/__tests__/guard.test.ts`. Triple: `request` throws
      synchronously · risky call · `{block:true,reason:"supervised: error"}`, outcome `error`
      (test-plan #X2)
- [x] 8.51 Rejected decision fails closed — see
      `packages/chat-gateway/src/guard/__tests__/guard.test.ts`. Triple: `decision` promise
      rejects · risky call · `{block:true}`, outcome `error` (test-plan #X3)
- [x] 8.52 Gate not wrapped in `safe()` — see
      `packages/extension/src/__tests__/no-tui-multiselect-arm-regression.test.ts`. Triple:
      `bridge.ts` registration · source assertion · supervised gate registered 4th, after path
      gate, without `safe(` (test-plan #X4)
- [x] 8.53 Blocked outcomes distinguishable — see
      `packages/chat-gateway/src/guard/__tests__/guard.test.ts`. Triple: deny / timeout / gate
      error / client dismiss / abort · inspect records + reasons · five distinct outcomes
      `denied`,`timeout`,`error`,`dismissed`,`aborted`, five distinct block reasons
      (test-plan #X5)
- [x] 8.54 Chat-gateway reason unchanged — see
      `packages/chat-gateway/src/guard/__tests__/guard.test.ts`. Triple: gateway surface: confirm
      false, timeout, confirm throws · each path · all `{block:true,reason:"chat-gateway:
      approval_denied_or_timed_out"}`; moved `guard.test.ts` assertions unchanged (test-plan #X6)
- [x] 8.55 Decision logged durably — see
      `packages/chat-gateway/src/guard/__tests__/guard.test.ts`. Triple: approve then deny · each
      · two `supervised-tool-decision` entries with sessionId, tool, summary, outcome,
      answeredSurface, via (test-plan #X7)
- [x] 8.56 Timeout attributed to `timeout` surface — see
      `packages/chat-gateway/src/guard/__tests__/guard.test.ts`. Triple: never answered · timeout
      · `answeredSurface:"timeout"`, outcome `timeout` (test-plan #X8)
- [x] 8.57 Guard-owned session: at most one approval — see
      `packages/chat-gateway/src/guard/__tests__/guard.test.ts`,
      `packages/extension/src/path-gate/__tests__/handler.test.ts`. Triple: owner slot marked
      `chat-gateway`, mode `true`, gateway policy approval:[`bash`] / allow:[`bash`] · `bash` call
      through both handlers · exactly one gateway confirm / zero prompts; supervised `request`
      never called; out-of-root path prompt unenriched (test-plan #X9)
- [x] 8.58 Fan-out permit released on supervised block — see
      `packages/extension/src/__tests__/subagent-fanout-admission.test.ts`. Settles spike 0.2.
      Triple: `Agent` admitted by fan-out, then supervised deny, ×(limit+1) · each · permits
      return to pool; call limit+1 is admitted (via `tool_execution_end` or the gate's release
      hook — order never changed) (test-plan #X10)
- [x] 8.59 Subagent tool-call visibility (spike 0.1) — see
      `packages/extension/src/__tests__/subagent-fanout-admission.test.ts`. Settles spike 0.1.
      Triple: Supervised; `Agent` child calls `bash` · child call · records whether child `bash`
      reaches parent `tool_call`; result recorded in design Q5 (test-plan #X11)
- [x] 8.60 Missing ApprovalSurface — see
      `packages/chat-gateway/src/guard/__tests__/guard.test.ts`. Triple: `createToolCallGuard`
      call without `surface` · `tsc --noEmit` on a `@ts-expect-error` fixture · type error present
      (no default presenter) (test-plan #X12)
- [x] 8.61 No UI blocks at once — see
      `packages/extension/src/path-gate/__tests__/handler.test.ts`. Triple: `ctx.hasUI:false`,
      Supervised · `bash` call, fake timers not advanced · `{block:true,reason:"supervised:
      no-ui"}` resolved with 0 ms timer advance; `request` never called (test-plan #X13)
- [x] 8.62 Mode restore failure fails closed — see
      `packages/extension/src/path-gate/__tests__/handler.test.ts`. Triple: reading
      `supervised-mode` entries throws; config default `full` · `session_start` · mode `true`; log
      `[supervised] mode restore failed`; next `bash` prompts (test-plan #X14)
- [x] 8.63 Abort before mutex — see `packages/extension/src/path-gate/__tests__/handler.test.ts`.
      Triple: A1 pending; A2 queued · abort A2's `ctx.signal` · A2
      `{block:true,reason:"supervised: aborted"}`; `request` never called for A2; A1 untouched
      (test-plan #X15)
- [x] 8.64 Abort after mutex — see `packages/extension/src/path-gate/__tests__/handler.test.ts`.
      Triple: A1 prompt open · abort signal · `cancel(id)` called; outcome `aborted`; block; mutex
      released (next call opens) (test-plan #X16)
- [x] 8.65 Signal already aborted at entry — see
      `packages/extension/src/path-gate/__tests__/handler.test.ts`. Triple:
      `ctx.signal.aborted===true` · `bash` call · blocked `supervised: aborted`, no prompt
      (test-plan #X17)
- [x] 8.66 Path-gate block suppresses supervised — see
      `packages/extension/src/path-gate/__tests__/handler.test.ts`. Triple: path gate returns
      block · chain dispatch · supervised gate never invoked (first-block-wins) (test-plan #X18)
- [x] 8.67 Pending supervised does not delay path-gate YOLO — see
      `packages/extension/src/path-gate/__tests__/handler.test.ts`. Triple: session A supervised
      prompt pending; path gate YOLO question for another call · YOLO question raised · YOLO
      question opens immediately (not queued behind supervised mutex) (test-plan #X19)
- [x] 8.68 `session_shutdown` clears per-session state — see
      `packages/extension/src/path-gate/__tests__/handler.test.ts`. Triple: s1 with mode entry,
      mutex chain, hand-off ids · `session_shutdown(s1)` · mode map, mutex, hand-off set have no
      `s1`; s2 entries intact (test-plan #X20)
- [x] 8.69 Client dismiss → `dismissed` — see
      `packages/chat-gateway/src/guard/__tests__/guard.test.ts`. Triple: prompt cancelled by a
      client dismiss (gate set no `selfCancel`) · resolution `{cancelled:true,source:"__bus__"}` ·
      outcome `dismissed`, block (test-plan #X21)
- [x] 8.70 Bus backstop fires first (misconfig) — see
      `packages/chat-gateway/src/guard/__tests__/guard.test.ts`. Triple: gate timer stubbed not to
      fire, bus timeout 5 s · 5 s · outcome `dismissed`, block — never allow (test-plan #X22)
- [x] 8.71 Server meta persists mode across server restart — see
      `packages/server/src/__tests__/meta-persistence.test.ts`,
      `packages/server/src/__tests__/memory-session-manager.test.ts`. Triple: `session-to-meta`
      with `{on:true,rev:3}` · write → reload meta → registration · restored `{on:true,rev:3}`;
      `set_supervised` re-sent after register and after reconnect (test-plan #X23)
- [x] 8.72 Version skew: old guard never marks slot — see
      `packages/extension/src/path-gate/__tests__/handler.test.ts`. Triple: gateway guard active,
      owner slot empty, mode `true` · `bash` · supervised prompt requested (≤2 prompts, never 0)
      (test-plan #X24)
- [x] 8.73 Approved tool runs with full permissions — see
      `packages/extension/src/path-gate/__tests__/handler.test.ts`. Triple: Supervised, Allow once
      on `bash` · gate result · `undefined` returned, `event.input` unmodified by the gate
      (test-plan #X25)
- [x] 8.74 Out-of-range timeout via API — see `packages/server/src/__tests__/config-api.test.ts`.
      Triple: `PUT /api/config {supervisedMode:{timeoutSeconds:5}}` sent directly (bypassing the
      Settings field) · request, then `GET /api/config` · PUT succeeds; persisted and returned
      `supervisedMode.timeoutSeconds` is 120 (normalised, not 5, no 400) (test-plan #X26)
- [x] 8.75 Unauthorised mode flip — see
      `packages/server/src/identity/__tests__/ws-message-scope.test.ts`,
      `packages/server/src/__tests__/browser-gateway-owner-gate.test.ts`. Triple: browser
      connection that is not the session owner sends `set_supervised{on:true}` for session s1
      (mode `false`, rev 3) · server WS handler (same owner gate as `send_prompt`,
      `ws-message-scope.ts:48`) · frame dropped by the owner gate (no error frame, as for `send_prompt`); mode stays `false`, rev 3; no `set_supervised`
      forwarded to the bridge; the owner's same message is accepted (test-plan #X27)
- [x] 8.76 Flip audited — see `packages/server/src/identity/__tests__/ws-message-scope.test.ts`,
      `packages/server/src/__tests__/browser-gateway-owner-gate.test.ts`. Triple: owner flips
      session s1 on, then off (console spy on the server) · each accepted flip · log lines
      `[supervised] mode on rev=<n> session=s1 source=<connId>` then `[supervised] mode off
      rev=<n+1> session=s1 source=<connId>`; the rejected flip of X27 logs no mode line
      (test-plan #X28)

### L3 — Playwright vs the docker harness (read the harness port from `.pi-test-harness.json` `dashboardPort`; never hardcode `:18000`)

- [x] 8.77 Supervised session prompts before a risky tool — see `tests/e2e/faux-ask.spec.ts`,
      `tests/e2e/optimistic-prompt.spec.ts`. Triple: Supervised session; faux `bash` `echo hi` ·
      tool call reaches the gate · card titled "Run this command?" with chip `bash` and text `echo
      hi`; no `hi` tool output yet; transcript row is running with matching `toolCallId`
      (test-plan #F1)
- [x] 8.78 Allow once runs the tool — see `tests/e2e/faux-ask.spec.ts`,
      `tests/e2e/optimistic-prompt.spec.ts`. Triple: pending `bash` approval · click `Allow once`
      · tool result `hi` appears; card collapses to resolved row naming surface `dashboard`
      (test-plan #F2)
- [x] 8.79 Deny blocks; turn continues — see `tests/e2e/faux-ask.spec.ts`,
      `tests/e2e/optimistic-prompt.spec.ts`. Triple: pending `bash` approval · click `Deny` · no
      `hi` output; tool row shows block reason starting `supervised: denied`; assistant turn
      reaches its end (faux final text rendered) (test-plan #F3)
- [x] 8.80 Reconnect replay — see `tests/e2e/pending-prompt-recovery.spec.ts`. Triple: pending
      approval · browser reload · card re-renders with command, countdown from same `deadline`,
      still answerable (Allow once runs the tool) (test-plan #F4)
- [x] 8.81 First response wins across surfaces — see `tests/e2e/pending-prompt-recovery.spec.ts`.
      Triple: pending approval; two browser contexts · `Allow once` in A · B's card leaves pending
      state; exactly one `supervised-tool-decision` entry (test-plan #F5)
- [x] 8.82 Live toggle ON mid-turn — see `tests/e2e/composer-session-strip.spec.ts`,
      `tests/e2e/split-composer-overflow.spec.ts`. Triple: Full session; faux turn: `bash sleep 5`
      then `bash echo two` · flip chip to Supervised during `sleep 5` · no card for call 1; card
      for `echo two` (test-plan #F6)
- [x] 8.83 Live toggle OFF mid-turn — see `tests/e2e/composer-session-strip.spec.ts`,
      `tests/e2e/split-composer-overflow.spec.ts`. Triple: Supervised; same faux turn; call 1
      approved · flip to Full access during `sleep 5` · `echo two` runs with no card
      (test-plan #F7)
- [x] 8.84 Flip never resolves a pending approval — see
      `tests/e2e/pending-prompt-recovery.spec.ts`. Triple: approval pending · flip to Full access
      · card stays pending; tool not run until answered (test-plan #F8)
- [x] 8.85 `write`/`edit` card shows concrete action — see `tests/e2e/faux-ask.spec.ts`,
      `tests/e2e/optimistic-prompt.spec.ts`. Triple: Supervised; faux `write` to in-root
      `notes/x.txt` (inside the session workspace, so the path gate stays silent) · gate · card
      "Create this file?" shows path and `+N −0` summary; diff collapsed; expand shows content
      (test-plan #F9)
- [x] 8.86 Expired approval leaves no answerable card — see
      `tests/e2e/pending-prompt-recovery.spec.ts`. Triple: `askUserPromptTimeoutSeconds:3` via
      `PUT /api/config` (effective 2 s by E15), `supervisedMode.timeoutSeconds:120` · 2 s elapse ·
      card cancelled in both contexts; tool row shows `supervised: timeout`-family reason; no
      Allow once control remains clickable (test-plan #F10)
- [x] 8.87 Mode survives reload / server restart / reconnect — see
      `tests/e2e/headless-reload-dispatch.spec.ts`, `tests/e2e/keeper-restart-survival.spec.ts`.
      Triple: session flipped Supervised · (a) extension reload; (b) `POST /api/restart`; (c)
      browser reload · after each: chip shows Supervised; next faux `bash` raises a card
      (test-plan #F14)
- [x] 8.88 One prompt per out-of-root edit, content shown — see
      `tests/e2e/agent-path-gate.spec.ts`. Triple: Supervised; faux `edit` outside workspace;
      variant with a 20 KiB diff · gate chain · single path-gate card showing path + `+N −M` stat
      + collapsed diff; `Allow once` → edit applied, no second card; 20 KiB variant: rendered diff
      ≤ 16384 bytes and ends `… (truncated)` (test-plan #F15)
- [x] 8.89 Always allow on enriched prompt still asks supervised — see
      `tests/e2e/agent-path-gate.spec.ts`. Triple: as F15 · answer path card `Always allow` +
      confirm · supervised card appears for the same edit (test-plan #F16)
- [x] 8.90 Path-gate deny suppresses supervised — see `tests/e2e/agent-path-gate.spec.ts`. Triple:
      as F15 · path card `Deny` · no supervised card; tool row blocked (test-plan #F17)
- [x] 8.91 YOLO does not answer supervised — see `tests/e2e/agent-path-gate.spec.ts`. Triple:
      Supervised; unscoped YOLO active; faux out-of-root `edit` · gate chain · no path card (YOLO
      auto-allow); supervised card raised (test-plan #F18)
- [x] 8.92 Needs you + lane + toast — see `tests/e2e/agent-path-gate.spec.ts`. Triple: pending
      supervised approval in session not in view · observe list · card "Needs you", needs-you lane
      membership, one toast; all clear after Allow once / Deny / timeout (test-plan #F19)
- [x] 8.93 Deny with a reason reaches agent — see `tests/e2e/faux-ask.spec.ts`,
      `tests/e2e/optimistic-prompt.spec.ts`. Triple: pending `bash` card · Deny with reason `use a
      dry run` · tool row reason `supervised: denied — operator said: "use a dry run"`
      (test-plan #F20)
- [x] 8.94 Abort withdraws pending card everywhere — see
      `tests/e2e/pending-prompt-recovery.spec.ts`. Triple: pending card in two contexts · abort
      turn (Esc / abort button) · card cancelled in both; tool row reason `supervised: aborted`;
      no late allow (test-plan #F21)
- [x] 8.95 Settings section bounds + undercut warning — see
      `tests/e2e/blackhole-settings.spec.ts`, `tests/e2e/agent-path-gate.spec.ts`. Triple:
      Security tab section · enter 9, 3601, 10; set ask_user timeout 30 with supervised 120 ·
      9/3601 show field error, save disabled; 10 saves; undercut → warning visible stating
      effective 29 s (test-plan #F22)
- [x] 8.96 Chip folds into ⋯ on narrow container — see `tests/e2e/composer-session-strip.spec.ts`,
      `tests/e2e/split-composer-overflow.spec.ts`. Triple: viewport 375 px · open composer · mode
      control absent from settings row, present inside ⋯ menu with both options (test-plan #F23)

### Manual (deferred post-merge by `ship-change`)

- [ ] 8.97 Copy makes no isolation claim: toggle menu, card, Settings, docs note; human reads
      shipped strings — judgment: reads as approval, not protection; container path named
      (complements automated E41) (test-plan: manual-only, #F12)
- [ ] 8.98 Card visual fit: card beside `ConfirmRenderer` in base dark / base light / nord dark at
      375 and 1440; human looks — judgment: consistent with interactive-renderer surface
      (test-plan: manual-only, #F13)

### Coordination note (from change `ask-agent-file-access-in-chat`)

The shipped agent path gate (`packages/extension/src/path-gate/`, a standalone `tool_call` handler)
exports the pure `decidePathAccess` decision. When supervised mode extracts the shared tool-gate
package, compose them in a fixed order: **path gate first, then the action gate** — a path outside
the session roots is asked about (or blocked) before any per-action approval is raised, so one tool
call never raises two overlapping prompts for the same fact. Do not fold the path gate into the
action gate's policy; keep `decidePathAccess` pure and importable.
