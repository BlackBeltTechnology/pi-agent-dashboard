# Tasks — add-supervised-tool-approval

Test tasks are folded from `test-plan.md` (the manifest). Each carries its harness exemplar,
its Triple, and its manifest id. Manifest dispositions — not tags here — are the source of
truth for automated vs manual.

## 0. Blocking spikes (settle before the dependent tasks land)

- [ ] 0.1 Spike: does an `Agent` child's tool call surface on the parent session's
      `tool_call` stream? Settles design open question 5 and whether `Agent`-in-the-risky-set
      is the only subagent coverage. Author as a test — see task 8.11.
- [ ] 0.2 Spike: does pi emit `tool_execution_end` for a tool blocked by a *later*
      `tool_call` handler? Settles design D8's open risk. If it does not, register the
      supervised gate BEFORE the fan-out gate. Author as a test — see task 8.10.
- [ ] 0.3 Settle design open question 4: home for the shared tool-gate package
      (`packages/tool-gate` vs a `packages/shared` subpath). `packages/extension` must not
      depend on the chat-gateway plugin (D13).

## 1. Shared tool-gate package (extraction of shipped code)

- [ ] 1.1 Create the shared workspace package at the location settled in 0.3.
- [ ] 1.2 Move `decideToolCall` + `ToolPolicy` from
      `packages/chat-gateway/src/guard/policy.ts` into the shared package.
- [ ] 1.3 Move `createToolCallGuard` from `packages/chat-gateway/src/guard/index.ts` into the
      shared package, replacing its hardcoded chat copy, `chat-gateway:` reason prefix and
      bare-boolean confirm with the injected `ApprovalSurface`
      (`buildPrompt` · `reasonPrefix` · cancellable `request` · required `onDecision`) and the
      `GateOutcome` result per design D9. The guard takes its timeout as a parameter — it owns
      no constant.
- [ ] 1.4 `ApprovalSurface` is a required argument with no chat-flavoured default, so a call
      site that forgets to inject fails to compile (design D9).
- [ ] 1.5 Export a pure `parseToolPolicy(raw, { allowedDefaults })` validator from the shared
      package (design D7#4).
- [ ] 1.6 Migrate chat-gateway to consume the shared package: keep `policyFromEnv` (the
      gateway-specific env name) in `packages/chat-gateway`, calling `parseToolPolicy` with
      `allowedDefaults: ["deny","approve"]`; add a chat-gateway `ApprovalSurface` adapter
      supplying its existing copy and prefix.
- [ ] 1.7 Keep the published `./guard` export subpath of
      `@blackbelt-technology/pi-dashboard-chat-gateway-plugin` working as a re-export.
- [ ] 1.8 Move `guard.test.ts` / `policy.test.ts` to the shared package with their
      **assertions unchanged**; only the import path and the `ApprovalSurface` construction in
      setup change (design D9).
- [ ] 1.9 Record release ordering in the change notes: publish the shared package before the
      chat-gateway version that re-exports it; post-release rollback is a forward fix, never
      an unpublish (design D13).

## 2. Policy widening (`defaultAction: "allow"`)

- [ ] 2.1 Widen `ToolDefaultAction` to `"deny" | "approve" | "allow"` AND add the explicit
      `"allow"` branch to `decideToolCall` — the type alone makes `"allow"` resolve to `deny`
      (design D7).
- [ ] 2.2 Keep an absent `defaultAction` resolving to `"deny"` so no existing caller or
      persisted policy changes meaning.
- [ ] 2.3 Leave `normalizeToolPolicy` coercion and the chat-gateway `configSchema.json` enum
      at `["deny","approve"]` — the widened type is shared, the widened config surface is not.

## 3. Bridge gate registration

- [ ] 3.1 Register the supervised gate in `packages/extension/src/bridge.ts` after the
      pass-through forwarder and (pending 0.2) the fan-out admission gate.
- [ ] 3.2 Register it WITHOUT `safe()`; the gate's own `try/catch` is the total error boundary
      and returns `{ block: true }` on any internal failure (design D8).
- [ ] 3.3 Read the `supervised` flag per tool call so a mid-turn flip affects the next call
      (design D4).
- [ ] 3.4 Build the action summary from the tool-call `input`: command text for
      `bash`/`powershell`; target path + compact change summary for `write`/`edit`.
- [ ] 3.5 Match tool names case-insensitively against the configured set.
- [ ] 3.6 Add the session-start tool-inventory drift check: fail when the host exposes a tool
      outside `readFamily ∪ riskySet`.
- [ ] 3.7 Self-disable in a chat-gateway-spawned session via the shared package's
      `markToolGateOwner(...)` signal — do NOT sniff `PI_EXT_CHAT_GATEWAY_GUARD_POLICY`
      (design D12).

## 4. Mode flag wiring

- [ ] 4.1 Add `supervised.default` (boolean) and `supervised.approvalTimeoutSeconds`
      (default 120) to shared config (`~/.pi/dashboard`), read at session start (design D4/D10).
- [ ] 4.2 Add the session-scoped `set_supervised` control message (dashboard → bridge) for
      the live toggle. Not an event-protocol change and not part of the approve/deny round-trip.
- [ ] 4.3 A flag flip never auto-resolves an already-pending approval (design D4).

## 5. Approval UI (client)

- [ ] 5.1 Add a Full-access ↔ Supervised toggle to the session view, reflecting current mode
      and hidden on gateway-spawned sessions.
- [ ] 5.2 Add a tool-approval interactive renderer variant alongside `ConfirmRenderer` in
      `packages/client/src/components/interactive-renderers/`: tool name, command/args or
      file + change summary, Approve / Deny.
- [ ] 5.3 The dashboard `ApprovalSurface` talks to PromptBus directly (not through the patched
      `ctx.ui.confirm`) so it holds the prompt id needed for `cancel()` on timeout (design D10).

## 6. Observability

- [ ] 6.1 `onDecision` writes a `supervised-tool-decision` durable entry via `pi.appendEntry`
      plus a console line, recording session id, tool, action summary, `GateOutcome`, and
      `answeredSurface` (design D11).

## 7. Docs & safety wording

- [ ] 7.1 Approval-surface and help copy says "approve each action the agent takes"; never
      "sandboxed" / "safe" / "isolated"; names the container path for real confinement; states
      that operator `!` shell and extension-initiated execution are not covered.
- [ ] 7.2 Delegate the `docs/` note (supervised mode: scope, approval ≠ sandbox,
      container-for-isolation, config keys) to a subagent in caveman style per the
      Documentation Update Protocol.

## 8. Folded test scenarios

### L1 — vitest (exemplars: `packages/chat-gateway/src/guard/__tests__/policy.test.ts` and `guard.test.ts`)

- [ ] 8.1 Default risky set gates exec+mutation, not read-family — see
      `packages/chat-gateway/src/guard/__tests__/policy.test.ts`. Triple: policy
      `{approval:["bash","powershell","write","edit","Agent"],defaultAction:"allow"}` ·
      `decideToolCall` for each of those five plus `read`/`grep`/`find`/`ls` · first five
      `approve`, last four `allow`. (test-plan #E1)
- [ ] 8.2 `defaultAction:"allow"` actually allows — see
      `packages/chat-gateway/src/guard/__tests__/policy.test.ts`. Triple: policy
      `{approval:["bash"],defaultAction:"allow"}` · `decideToolCall("read")` ·
      returns `{action:"allow"}`, not `deny`. (test-plan #E2)
- [ ] 8.3 Absent `defaultAction` still denies — see
      `packages/chat-gateway/src/guard/__tests__/policy.test.ts`. Triple: policy `{allow:["read"]}`
      with no `defaultAction` · `decideToolCall("rm_tool")` ·
      `{action:"deny",reason:"denied_by_default"}`. (test-plan #E3)
- [ ] 8.4 Gateway config rejects `"allow"` — see
      `packages/server/src/__tests__/config-api.test.ts`. Triple: gateway
      `toolPolicy.defaultAction="allow"` · `normalizeToolPolicy` + schema validation ·
      coerced to `"deny"` and schema-rejected. (test-plan #E4)
- [ ] 8.5 Env path rejects `"allow"` — see
      `packages/chat-gateway/src/guard/__tests__/guard.test.ts`. Triple:
      `PI_EXT_CHAT_GATEWAY_GUARD_POLICY='{"defaultAction":"allow"}'` · `policyFromEnv()` ·
      resolved `defaultAction` is `"deny"`. (test-plan #E5)
- [ ] 8.6 Case-insensitive tool matching — see
      `packages/chat-gateway/src/guard/__tests__/policy.test.ts`. Triple: risky set has `Agent` ·
      `decideToolCall("agent")` and `decideToolCall("AGENT")` · both `approve`. (test-plan #E6)
- [ ] 8.7 Configured set is authoritative over read-family — see
      `packages/chat-gateway/src/guard/__tests__/policy.test.ts`. Triple:
      `{approval:["read"],defaultAction:"allow"}` · `decideToolCall("read")` · `approve`.
      (test-plan #E7)
- [ ] 8.8 Tool-inventory drift check fails on an unclassified tool — see
      `packages/extension/src/__tests__/empty-actionable-guard-config.test.ts`. Triple: fixture
      inventory adds `patch_file` outside `readFamily ∪ riskySet` · session-start check ·
      check fails naming `patch_file`. (test-plan #E8)
- [ ] 8.9 Approval timeout boundary — see
      `packages/chat-gateway/src/guard/__tests__/guard.test.ts` (injectable `schedule`/`cancel`).
      Triple: timeout 120s, injected clock · decision at 119.9s / 120.0s / 120.1s · honored /
      `timeout` / `timeout`. (test-plan #E9)
- [ ] 8.10 Fan-out permit not leaked by a supervised deny — see
      `packages/extension/src/__tests__/subagent-fanout-admission.test.ts`. Triple: `Agent` call
      admitted by fan-out then denied by the supervised gate · repeat to the fan-out limit ·
      permits return to the pool. Settles spike 0.2 — if `tool_execution_end` does not fire,
      register the supervised gate before fan-out. (test-plan #X10)
- [ ] 8.11 Subagent tool-call visibility — see
      `packages/extension/src/__tests__/subagent-fanout-admission.test.ts`. Triple: Supervised
      session with an `Agent` child calling `bash` · the child's tool call · records whether it
      surfaces on the parent's `tool_call` stream. Settles spike 0.1. (test-plan #X11)
- [ ] 8.12 Approval timeout config default + fallback — see
      `packages/extension/src/__tests__/empty-actionable-guard-config.test.ts`. Triple: config
      without the key, with an explicit value, with a non-numeric/negative value · resolve
      config · 120s / explicit / 120s. (test-plan #E10)
- [ ] 8.13 Flag off never calls the approval surface — see
      `packages/chat-gateway/src/guard/__tests__/guard.test.ts`. Triple: `supervised:false` ·
      `bash` tool call reaches the gate · returns `undefined`, `request` never called.
      (test-plan #E11)
- [ ] 8.14 Shared-config supervised default starts sessions gated — see
      `packages/extension/src/__tests__/empty-actionable-guard-config.test.ts`. Triple:
      `supervised.default:true` · new session starts · initial mode is Supervised.
      (test-plan #E12)
- [ ] 8.15 `allow` beats `approval` precedence is pinned — see
      `packages/chat-gateway/src/guard/__tests__/policy.test.ts`. Triple:
      `{allow:["bash"],approval:["bash"],defaultAction:"allow"}` · `decideToolCall("bash")` ·
      `{action:"allow"}`. (test-plan #E13)
- [ ] 8.16 Non-supervised gate latency budget — see
      `packages/extension/src/__tests__/subagent-fanout-admission.test.ts` for the dispatch
      harness. Triple: 10 000 `tool_call` dispatches with `supervised:false` · timed run ·
      p95 added latency per call < 1ms. (test-plan #P1)
- [ ] 8.17 Unanswered approval fails closed — see
      `packages/chat-gateway/src/guard/__tests__/guard.test.ts`. Triple: surface never resolves ·
      timeout elapses · `{block:true}`, `GateOutcome:"timeout"`, tool never runs. (test-plan #X1)
- [ ] 8.18 Synchronous gate throw fails closed — see
      `packages/chat-gateway/src/guard/__tests__/guard.test.ts`. Triple: `request` throws
      synchronously · risky tool call · `{block:true}`, `GateOutcome:"error"`, not `undefined`.
      (test-plan #X2)
- [ ] 8.19 Rejected decision promise fails closed — see
      `packages/chat-gateway/src/guard/__tests__/guard.test.ts`. Triple: `decision` promise
      rejects · risky tool call · `{block:true}`, `GateOutcome:"error"`. (test-plan #X3)
- [ ] 8.20 Gate is never wrapped in `safe()` — see
      `packages/extension/src/__tests__/no-tui-multiselect-arm-regression.test.ts` (same
      substring-ban regression shape). Triple: bridge registration site · static assertion over
      the registration · supervised gate registered without `safe()`. (test-plan #X4)
- [ ] 8.21 Blocked outcomes are distinguishable — see
      `packages/chat-gateway/src/guard/__tests__/guard.test.ts`. Triple: deny / timeout / gate
      error runs · inspect the decision record · three distinct `GateOutcome` values and three
      distinct logged outcomes. (test-plan #X5)
- [ ] 8.22 Chat-gateway agent-visible reason unchanged — see
      `packages/chat-gateway/src/guard/__tests__/guard.test.ts` (assertions move unchanged).
      Triple: gateway surface, deny + timeout + throwing confirm · each negative path · all
      three yield `{block:true,reason:"chat-gateway: approval_denied_or_timed_out"}`.
      (test-plan #X6)
- [ ] 8.23 Decision logged durably — see
      `packages/extension/src/__tests__/subagent-fanout-admission.test.ts` (its `recordRefusal`
      `pi.appendEntry` assertion is the exemplar). Triple: approve then deny · each decision ·
      a `supervised-tool-decision` entry with session id, tool, action summary, outcome,
      answering surface. (test-plan #X7)
- [ ] 8.24 Timeout attributed to the timeout surface — see
      `packages/chat-gateway/src/guard/__tests__/guard.test.ts`. Triple: approval never answered ·
      timeout · logged `answeredSurface` is `timeout`, not `dashboard`. (test-plan #X8)
- [ ] 8.25 Missing approval surface fails loudly — see
      `packages/chat-gateway/src/guard/__tests__/guard.test.ts`. Triple: gate constructed with no
      `ApprovalSurface` · construct · construction fails; no chat-flavoured fallback.
      (test-plan #X12)

### L3 — Playwright vs the docker harness (exemplars: `tests/e2e/pending-prompt-recovery.spec.ts`, `tests/e2e/optimistic-prompt.spec.ts`, `tests/e2e/blackhole-settings.spec.ts`). Read the harness port from `.pi-test-harness.json` (`dashboardPort`) — never hardcode `:18000`.

- [ ] 8.26 Supervised session prompts before a risky tool — see
      `tests/e2e/faux-ask.spec.ts`. Triple: Supervised session, agent runs `bash echo hi` · tool
      call reaches the gate · approval card names `bash` and shows `echo hi`; command has not
      run. (test-plan #F1)
- [ ] 8.27 Approve runs the tool — see `tests/e2e/optimistic-prompt.spec.ts`. Triple: pending
      `bash` approval · click Approve · command executes, result appears in the transcript.
      (test-plan #F2)
- [ ] 8.28 Deny blocks and the turn continues — see `tests/e2e/optimistic-prompt.spec.ts`.
      Triple: pending `bash` approval · click Deny · no command output, transcript shows a
      blocked tool with the deny reason, turn does not hang. (test-plan #F3)
- [ ] 8.29 Approval inherits reconnect replay — see
      `tests/e2e/pending-prompt-recovery.spec.ts`. Triple: pending approval · browser reload ·
      card re-renders from cached PromptBus state and is still answerable. (test-plan #F4)
- [ ] 8.30 First response wins across surfaces — see
      `tests/e2e/pending-prompt-recovery.spec.ts`. Triple: pending approval, two browser
      contexts · Approve in A · B's card dismissed, exactly one decision recorded.
      (test-plan #F5)
- [ ] 8.31 Live toggle ON takes effect mid-turn — see `tests/e2e/blackhole-settings.spec.ts`
      for the toggle-control shape. Triple: Full-access session mid-turn · flip Supervised ON ·
      the next tool call in that same turn raises an approval card. (test-plan #F6)
- [ ] 8.32 Live toggle OFF takes effect mid-turn — see
      `tests/e2e/blackhole-settings.spec.ts`. Triple: Supervised session mid-turn · flip OFF ·
      next risky tool call runs with no prompt. (test-plan #F7)
- [ ] 8.33 Flag flip never auto-resolves a pending approval — see
      `tests/e2e/pending-prompt-recovery.spec.ts`. Triple: approval already pending · flip
      Supervised OFF · card stays pending, not auto-approved, tool does not run. (test-plan #F8)
- [ ] 8.34 `write` approval shows path + change summary — see `tests/e2e/faux-ask.spec.ts`.
      Triple: Supervised session, agent calls `write` on `/tmp/x.txt` · tool call reaches the
      gate · card shows the target path and a change summary, not a bare tool name.
      (test-plan #F9)
- [ ] 8.35 Expired approval leaves no answerable card — see
      `tests/e2e/pending-prompt-recovery.spec.ts`. Triple: pending approval with a 2s test
      timeout · timeout elapses · card cancelled on every surface; a late click cannot approve.
      (test-plan #F10)
- [ ] 8.36 Toggle hidden on a gateway-spawned session — see
      `tests/e2e/blackhole-settings.spec.ts`. Triple: chat-gateway-spawned session · open the
      session view · toggle absent, note names the active gateway policy. (test-plan #F11)
- [ ] 8.37 Gateway-spawned session raises exactly one approval — see
      `tests/e2e/faux-ask.spec.ts`. Triple: gateway-spawned session with supervised also enabled ·
      risky tool call · exactly ONE approval, governed by the gateway's deny-first policy.
      (test-plan #X9)

### Manual (deferred post-merge by `ship-change`)

- [ ] 8.38 Review the shipped approval/toggle/help strings: no "sandbox" / "safe" / "isolated";
      says "approve each action the agent takes"; names the container path for real confinement.
      (test-plan: manual-only, #F12)
- [ ] 8.39 Look at the tool-approval card beside `ConfirmRenderer` output in each theme and
      judge visual consistency with the existing interactive-renderer surface.
      (test-plan: manual-only, #F13)
