# Test Plan — retire-anthropic-messages-bridge

Stage: design   Generated: 2026-10-28

Clarifications C1 (failed switch save → optimistic, then revert + error toast) and C2 (unreadable switch at sign-in → show prompt) were resolved before writing and are now spec requirements.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | compat: Docs-section rewrite on Anthropic sessions | decision-table | L1 | automated | handler with switch ∈ {on, off} × `ctx.model` ∈ {anthropic, openai, undefined} × `customPrompt` ∈ {unset, set}, `event.systemPrompt` = pi 1.4.0 default prompt | `before_agent_start` fires | `sections.docs` assigned **only** for (on, anthropic, unset), and then contains `the cli itself` and `cli packages` and neither `pi itself` nor `pi packages`; the other 11 combinations leave `sections.docs` undefined; the handler returns `undefined` in all 12 |
| E2 | compat: Docs-section rewrite; design D1 (exactly one anchored match) | EP | L1 | automated | `event.systemPrompt` with 0, 1 and 2 blocks matching `<docs>\nPi documentation (` … `\n</docs>`, plus one with a `<docs>` tag inside `<project_context>` only | handler runs (switch on, anthropic, no customPrompt) | 1 match → rewritten docs with the rest of the block byte-identical; 0, 2, or project_context-only → `sections.docs` undefined |
| E3 | compat: Docs-section rewrite (idempotence) | BVA | L1 | automated | docs text already containing `the cli itself` / `cli packages`, no flagged phrase | `rewriteDocsSection` called twice | output equals input on both calls; 0 replacements counted |
| E4 | compat: Rewrite preserves the rest of the prompt and tool names | invariant | L1 | automated | options with `sections.dashboard_session` and `toolGuidelines.Agent` already set by other handlers, 3 custom tools incl. `ask_user` | compat handler runs after them | `sections.dashboard_session` and `toolGuidelines` unchanged; `selectedTools` names unchanged; return value `undefined` (never `{ systemPrompt }`) |
| E5 | compat: Docs-section rewrite (pi drift canary) | invariant | L1 | automated | installed `@earendil-works/pi-coding-agent` default prompt built with no custom prompt | test builds it via `dist/core/system-prompt.js` `buildSystemPrompt` | output contains exactly one `<docs>\nPi documentation (` block that contains both `pi itself` and `pi packages`; fails on a pi version that rewords them |
| E6 | compat: Flow agents receive the same rewrite | decision-table | L1 | automated | factory from flows-plugin bridge with parent `readSwitch` ∈ {true, false}; stub agent `pi` whose `ctx.model.provider` ∈ {anthropic, openai} | factory applied to agent pi, then its `before_agent_start` invoked | rewrite only for (true, anthropic); the agent handler never calls `agentPi.events.emit` |
| E7 | compat: Flow agents; design D5 (stable factory) | state-transition | L1 | automated | flows-plugin bridge activated on a stub parent `pi` | `session_start` fired 3 times | `flow:register-agent-extension` emitted 4 times (activate + 3) with the **same** `factory` reference each time |
| E8 | global-preferences: Claude subscription compat toggle persisted | EP | L1 | automated | `preferences.json` without the field; with `true`; with a non-boolean `"yes"` | store loads, then PATCH sets `true` | absent → `false`; `true` → `true`; `"yes"` → `false`; after PATCH the file contains `"claudeSubscriptionCompat": true` (debounced atomic write) |
| E9 | global-preferences: relay; design D3 (optional fields, full snapshot) | decision-table | L1 | automated | bridge `inst` with autoName=true, compat=false; messages `{autoNameSessions:false}`, `{claudeSubscriptionCompat:true}`, `{both}`, `{claudeSubscriptionCompat:"x"}` | `dispatch` handles each `preferences_update` | each field changes only when present and boolean; the absent field keeps its prior value; `"x"` ignored |
| E10 | compat: Switch value reaches every connected session (register before initial prompt) | state-transition | L1 | automated | switch on; session spawned with a pending initial prompt in `pendingInitialPromptRegistry` | real gateway `onSessionRegistered` + `onEvent session_register` callbacks run | the session's outbound message list has `preferences_update {claudeSubscriptionCompat:true}` **before** `send_prompt` |
| E11 | compat: Switch value reaches every connected session (live change) | state-transition | L1 | automated | 3 registered sessions, switch off | PATCH sets switch on | each of the 3 sessions receives exactly one `preferences_update` with both fields; a 4th session registering afterwards gets `claudeSubscriptionCompat:true` on register |
| E12 | compat: Sign-in prompts to turn the switch on | decision-table | L1 | automated | `ProviderAuthSection` with switch read ∈ {off, on, read fails} | anthropic subscription sign-in completes | off → prompt with Turn on / Not now; on → no prompt; read fails → prompt (C2); in all cases no package install enqueued (`peerAutoInstallStore` not called) |
| E13 | compat: Sign-in prompt choices | state-transition | L1 | automated | prompt shown after sign-in | user clicks Turn on, or Not now | Turn on → PATCH sent with `true`, prompt closes; Not now → no PATCH, prompt closes, row stays authenticated |
| E14 | compat: One-time uninstall notice | decision-table | L1 | automated | switch ∈ {on, off} × installed list ∈ {`@blackbelt-technology/pi-anthropic-messages`, `@pi/anthropic-messages`, `pi-anthropic-messages-fork`, none} | providers/extensions surface renders | notice only when switch on and a normalized name equals one of the two package names; the `-fork` entry never matches; after dismiss + remount the notice stays hidden (same storage) |
| E15 | compat: Anthropic row shows and controls the switch | decision-table | L1 | automated | authenticated anthropic subscription row with switch ∈ {on, off} × flows plugin ∈ {enabled, disabled} | row renders | row shows state + switch control in all 4; disabled flows plugin → text says compat needs the Flows plugin; Sign out and expiry still rendered |
| E16 | landing-page-onboarding: Step ① done row reports compat state | decision-table | L1 | automated | Step ① done; anthropic ∈ {authenticated, not}; switch ∈ {on, off} | LandingPage renders | only (authenticated, off) shows the extra-usage notice with a secondary **Turn on**; region has `aria-live="polite"`; Step ② controls still enabled |
| E17 | compat: Applied compat state is logged per session | state-transition | L1 | automated | one session; runs in order: switch on + phrases present ×2, then a prompt without phrases ×2, then switch off ×1 | 5 `before_agent_start` runs | log lines: one "applied", one "matched nothing" warning, one "off"; no line contains text from the prompt (assert no substring of the docs body) |
| E18 | plugin removal (D8) | invariant | ci | automated | repo tree after the change | `rg -l` over the D8 pattern list with D8 exclusions | zero matches; knip, `check-conventions`, plugin-boundary ratchet and tailwind-source-coverage pass |
| E19 | eventbus forwarding (design D4) | invariant | L1 | automated | bridge with forwarder attached | `dashboard:preferences:get` probe and `flow:register-agent-extension` emitted on `pi.events` | neither reaches the server connection (extend `eventbus-rpc-probe-not-forwarded.test.ts`) |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | compat: Sign-in prompt + row (rendered) | state-transition | L3 | automated | docker harness, switch off (fresh `preferences.json`) | complete anthropic subscription sign-in via the provider-add flow, click Turn on | prompt visible → after click the anthropic row shows compat on; reloading the page still shows on; no package-install progress UI appears |
| F2 | compat: Switch value reaches sessions (rendered → bridge) | convergence | L3 | automated | docker harness with one connected session, switch off | toggle the anthropic row switch on | the session's bridge reports `claudeSubscriptionCompat:true` (via test hook / health) without a session restart |
| F3 | landing-page-onboarding: Turn on from Landing | state-transition | L3 | automated | harness, anthropic authenticated, switch off, no session selected | click **Turn on** under Step ① | the notice disappears and the anthropic row shows compat on; Step ② stays usable |
| F4 | compat: uninstall notice copy and placement | visual/subjective | — | manual-only | providers page with the package installed and switch on | human reads the notice | [judgment: wording is clear and the notice is not alarming] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | compat: A failed switch change reverts with an error toast | fault-injection (abort) | L1 | automated | PATCH returns 500 | user toggles the row switch on | control shows on, then off after the response; one error toast "not saved"; no second PATCH |
| X2 | compat: A failed switch change reverts (server unreachable) | fault-injection (abort) | L1 | automated | fetch rejects (network error) | user clicks Turn on in the sign-in prompt and in Landing | both controls revert to off with the error toast; prompt does not report success |
| X3 | compat: Docs-section rewrite (forced prompt) | fault-injection | L1 | automated | `event.systemPrompt` is a forced prompt (no anchored docs block) because another handler forced it | compat handler runs (switch on, anthropic) | `sections.docs` untouched, return `undefined`, one "forced/custom" log line |
| X4 | compat: probe unanswered (design D4) | fault-injection (abort) | L1 | automated | no listener on `dashboard:preferences:get` | flows-plugin handler runs on an anthropic model | treated as off: no rewrite, state logged as off |
| X5 | billing: rewrite keeps subscription billing | live check | — | manual-only | real Anthropic subscription OAuth, pi with the change, package uninstalled, switch on | one Sonnet/Opus request each from the main session and from a flow agent, re-run per the spike method (`anthropic-ratelimit-unified-representative-claim`) | [judgment/external: response claim is `five_hour` (subscription), never `400 out of extra usage`; requires a real account] |
| X6 | proposal: close `track-pi-anthropic-tool-removal-fix` | live check | — | manual-only | real anthropic OAuth session, package uninstalled, switch on, a dashboard plugin with tools | reload the plugin so its tools drop mid-session, then send a prompt | [external: no `tool_reference_unresolved` 400; outcome decides how the tracker closes] |
| X7 | design Risks (re-prime path) | code inspection | — | manual-only | `pi-coding-agent/dist/core/agent-session.js:550-562` re-prime path | read whether it builds a request without `emitBeforeAgentStart` | [inspection: documented yes/no; if yes, a follow-up task routes it through the handler] |

---

## Coverage summary

- Requirements covered: claude-subscription-compat 10/10 · global-preferences 1/1 · landing-page-onboarding 2/2 (MODIFIED empty-state copy is covered by E16/F3) · REMOVED-only and example-only deltas (anthropic-peer-hint, flows-anthropic-bridge-*, flow-plugin-e2e, pi-package-resolver, client-build-config, dashboard-plugin-loader, jiti-cjs-transpile-safety, publish-correctness-verification, plugin-settings-consistency) are covered by E18 (removal gate) plus the existing guard tests the change updates.
- Scenarios by class: edge 19 · perf 0 · frontend 4 · error 7
- Scenarios by level: L1 25 · L3 3 · ci 1 · manual 4
- Scenarios by disposition: automated 26 · manual-only 4

Performance: no spec threshold. The rewrite is one anchored regex over the ~44 KB prompt per run; no perf scenario.

## New infra needed

- E5 imports pi's internal `dist/core/system-prompt.js` by file path (not a public export). Acceptable for a canary; it fails loudly if pi moves the file.
- F2 needs a way to read a session bridge's current `claudeSubscriptionCompat` from the harness (existing health/test hook, or a debug field). Check for an existing hook before adding one.
