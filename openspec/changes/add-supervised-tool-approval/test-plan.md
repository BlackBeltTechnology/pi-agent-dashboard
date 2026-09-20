# Test Plan — add-supervised-tool-approval

Stage: design   Generated: 2026-09-22

Hard gate satisfied: C1 (timeout = dedicated key `supervised.approvalTimeoutSeconds`,
default 120s), C2 (config default + session-scoped live control message), C3 (per-call flag
read; immediate both directions), C4 (p95 < 1ms added latency on non-supervised sessions)
were answered before this plan was written. No open slots remain.

Harness note: L3 rows run against the docker harness port recorded in
`.pi-test-harness.json` (`dashboardPort`) — never a hardcoded `:18000`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Configurable risky-tool set — default set | decision-table | L1 | automated | policy `{approval:["bash","powershell","write","edit","Agent"], defaultAction:"allow"}` | `decideToolCall(name)` for each of `bash`, `powershell`, `write`, `edit`, `Agent`, `read`, `grep`, `find`, `ls` | first five return `action:"approve"`; last four return `action:"allow"` |
| E2 | Widen `ToolDefaultAction` with `"allow"` | EP | L1 | automated | policy `{approval:["bash"], defaultAction:"allow"}` | `decideToolCall("read", policy)` | returns `{action:"allow"}` — NOT `deny` (guards the silent-ternary bug: type widened without a resolution branch) |
| E3 | Chat-gateway posture unchanged | EP | L1 | automated | policy `{allow:["read"]}` with `defaultAction` **absent** | `decideToolCall("rm_tool", policy)` | returns `{action:"deny", reason:"denied_by_default"}` — absent still means deny |
| E4 | Widened type not exposed to gateway config | EP | L1 | automated | gateway config `toolPolicy.defaultAction = "allow"` | `normalizeToolPolicy(config)` and JSON-schema validation | normalizer coerces to `"deny"`; schema rejects `"allow"` (`enum:["deny","approve"]`) |
| E5 | Widened type not exposed via env | EP | L1 | automated | `PI_EXT_CHAT_GATEWAY_GUARD_POLICY='{"defaultAction":"allow"}'` | `policyFromEnv()` → shared `parseToolPolicy(raw,{allowedDefaults:["deny","approve"]})` | resolved policy has `defaultAction:"deny"` |
| E6 | Configurable risky-tool set — case-insensitive matching | EP | L1 | automated | risky set contains `Agent` | `decideToolCall("agent")` and `decideToolCall("AGENT")` | both return `action:"approve"` |
| E7 | Configured set is authoritative (no hidden read-family exemption) | decision-table | L1 | automated | operator set `{approval:["read"], defaultAction:"allow"}` | `decideToolCall("read")` | returns `action:"approve"` — `read` IS gated when explicitly configured |
| E8 | Default set does not silently drift from host tools | EP | L1 | automated | fixture tool inventory adding `patch_file` (outside `readFamily ∪ riskySet`) | inventory check at session start | check FAILS, naming `patch_file` — forces human classification instead of ungated execution |
| E9 | Approval timeout boundary | BVA | L1 | automated | `supervised.approvalTimeoutSeconds = 120`, injected clock | decision arrives at 119.9s / at 120.0s / at 120.1s | 119.9s ⇒ honored; 120.0s and 120.1s ⇒ `GateOutcome:"timeout"`, `{block:true}` |
| E10 | Approval timeout config default | EP | L1 | automated | `~/.pi/dashboard` with no `supervised.approvalTimeoutSeconds` | resolve config | resolves to 120s; an explicit value overrides; a non-numeric/negative value falls back to 120s |
| E11 | Per-session supervised mode — flag off | decision-table | L1 | automated | `supervised:false` | `bash` tool call reaches the gate | gate returns `undefined`; the injected approval surface's `request` is never called |
| E12 | Shared-config supervised default | EP | L1 | automated | `~/.pi/dashboard` with `supervised.default:true` | new session starts | session's initial mode is Supervised |
| E13 | `allow` beats `approval` (documented footgun) | decision-table | L1 | automated | policy `{allow:["bash"], approval:["bash"], defaultAction:"allow"}` | `decideToolCall("bash")` | returns `action:"allow"` — pins the shipped precedence so the extraction cannot silently change it |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Non-supervised sessions add no meaningful cost | tail-latency | L1 | automated | 10 000 `tool_call` dispatches through the gate with `supervised:false` | p95 added latency per call < 1ms | single timed run |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Supervised session prompts before a risky tool | state-transition | L3 | automated | Supervised session; agent runs `bash echo hi` | tool call reaches the gate | an approval card appears naming tool `bash` and showing the command text `echo hi`; the command has NOT run |
| F2 | Approve runs the tool | state-transition | L3 | automated | pending `bash` approval | operator clicks Approve | the command executes and its result appears in the transcript |
| F3 | Deny blocks the tool, agent continues | state-transition | L3 | automated | pending `bash` approval | operator clicks Deny | no command output; the transcript shows a blocked tool carrying the deny reason; the turn continues (does not hang) |
| F4 | Approval inherits reconnect replay | state-transition | L3 | automated | pending approval on a Supervised session | browser reload | the pending approval card re-renders from cached PromptBus state and is still answerable |
| F5 | First response wins across surfaces | state-transition | L3 | automated | pending approval; two browser contexts on the same session | Approve in context A | context B's card is dismissed; exactly one decision is recorded |
| F6 | Live toggle takes effect mid-turn (ON) | state-transition | L3 | automated | Full-access session mid-turn, before its next risky tool call | operator flips Supervised ON | the **next** tool call in that same turn raises an approval card |
| F7 | Live toggle takes effect mid-turn (OFF) | state-transition | L3 | automated | Supervised session mid-turn | operator flips Supervised OFF | the next risky tool call runs with no prompt |
| F8 | Flag flip never auto-resolves a pending approval | state-transition (illegal edge) | L3 | automated | an approval already pending | operator flips Supervised OFF while it is pending | the pending card stays pending — it is NOT auto-approved and the tool does NOT run |
| F9 | `write`/`edit` approval shows the concrete action | state-transition | L3 | automated | Supervised session; agent calls `write` on `/tmp/x.txt` | tool call reaches the gate | the card shows the target path and a change summary — not a bare tool name |
| F10 | Expired approval leaves no answerable card | state-transition | L3 | automated | pending approval with a 2s test timeout | timeout elapses | the card is cancelled on every connected surface; a late click cannot approve an already-blocked tool |
| F11 | Toggle hidden on a gateway-spawned session | decision-table | L3 | automated | chat-gateway-spawned session | open the session view | the Supervised toggle is absent, with a note naming the active gateway policy |
| F12 | Approval copy makes no isolation claim | manual review | — | manual-only | the toggle, the approval card, the help copy | a human reads the shipped strings | no "sandbox" / "safe" / "isolated"; says "approve each action the agent takes"; names the container path for real confinement |
| F13 | Approval card visual fit with existing renderers | visual/subjective | — | manual-only | the tool-approval card beside `ConfirmRenderer` output | a human looks at both in each theme | judgment: consistent with the existing interactive-renderer surface |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Unanswered approval fails closed | fault-injection (delay) | L1 | automated | approval surface never resolves | timeout elapses | gate returns `{block:true}` with `GateOutcome:"timeout"`; the tool never runs |
| X2 | Gate internal error fails closed | fault-injection (abort) | L1 | automated | injected surface's `request` throws synchronously | risky tool call | gate returns `{block:true}` with `GateOutcome:"error"` — NOT `undefined` |
| X3 | Gate internal rejection fails closed | fault-injection (abort) | L1 | automated | injected surface's `decision` promise rejects | risky tool call | gate returns `{block:true}`, `GateOutcome:"error"` |
| X4 | Gate is not wrapped in the allow-on-error wrapper | static assertion | L1 | automated | bridge registration site | lint/unit assertion over the registration | the supervised gate is registered WITHOUT `safe()` — a regression guard against re-introducing the fail-open path |
| X5 | Blocked outcomes are distinguishable | decision-table | L1 | automated | three runs: explicit deny / timeout / gate error | inspect the decision record | three distinct `GateOutcome` values and three distinct logged outcomes |
| X6 | Chat-gateway agent-visible reason is unchanged | fault-injection (abort+delay) | L1 | automated | chat-gateway approval surface; deny, timeout, and throwing confirm | each negative path | all three still produce `{block:true, reason:"chat-gateway: approval_denied_or_timed_out"}` — existing `guard.test.ts` assertions pass unchanged |
| X7 | Decision is logged durably | fault-injection | L1 | automated | approve then deny on a Supervised session | each decision | a `supervised-tool-decision` durable entry records session id, tool, action summary, outcome, and answering surface |
| X8 | Timeout is attributed to the timeout surface | fault-injection (delay) | L1 | automated | approval never answered | timeout | logged `answeredSurface` is `timeout`, not `dashboard` |
| X9 | Gateway-spawned session raises exactly one approval | decision-table | L3 | automated | gateway-spawned session with supervised also enabled | risky tool call | exactly ONE approval is raised, governed by the gateway's deny-first policy; no duplicate card |
| X10 | Fan-out permit is not leaked by a supervised deny | fault-injection (abort) | L1 | automated | `Agent` call admitted by the fan-out gate, then denied by the supervised gate | repeat until the fan-out limit would be reached | permits return to the pool — a denied `Agent` call never permanently consumes admission capacity (**settles design D8's open risk: if `tool_execution_end` does not fire for a later-handler block, the supervised gate must register BEFORE fan-out**) |
| X11 | Subagent tool-call visibility spike | fault-injection | L1 | automated | Supervised session; an `Agent` child that calls `bash` | the child's tool call | records whether the child's `bash` surfaces on the parent's `tool_call` stream (**settles design open question 5**; if it does not, `Agent`-in-the-risky-set is the only coverage and the D1 scope caveat is load-bearing) |
| X12 | Supervised gate survives a missing approval surface | fault-injection (abort) | L1 | automated | gate constructed with no `ApprovalSurface` | compile/construct | construction fails loudly — there is no chat-flavoured default presenter to silently fall back to |

---

## Coverage summary

- Requirements covered: 7/7 (all ADDED requirements in `specs/supervised-tool-approval/spec.md`)
- Scenarios by class: edge 13 · perf 1 · frontend 13 · error 12
- Scenarios by level: L1 24 · L2 0 · L3 11 · manual-only 2
- Scenarios by disposition: automated 37 · manual-only 2

No L2 rows: this change adds no install, spawn, or multi-OS runtime surface. The Windows
concern (`powershell` in the default set) is a pure policy-set assertion (E1) with no
OS-specific runtime behaviour, so it stays L1 rather than becoming a `qa/` smoke row.

## New infra needed

- A shared tool-gate workspace package (design D6/D13, open question 4) — the L1 rows E1–E13,
  X1–X8 and X12 are authored against it, so its home must be settled before those rows land.
- No new harness or test level. L1 extends the existing vitest tier
  (`packages/chat-gateway/src/guard/__tests__/` is the nearest exemplar); L3 extends the
  existing Playwright docker-harness tier (`tests/e2e/`).
