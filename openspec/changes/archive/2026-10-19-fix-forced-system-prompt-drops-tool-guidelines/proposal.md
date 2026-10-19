## Why

The roles plugin's Agent guideline ("prefer `model: "@<role>"`… Roles: @fast → …") never reaches the model, so agents keep passing literal model ids and bypass role assignments. The bridge does add it: session `01a1531a` records it in `sections.rules`. But two earlier `before_agent_start` handlers return `{ systemPrompt }`. That sets pi's `forceSystemPrompt` to a text snapshot taken *before* the roles handler runs. pi sends the forced text to the provider and keeps recording the structured sections in the transcript, so every later structured mutation is silently dropped, while the JSONL looks correct.

Forcers today:
- `packages/extension/src/dashboard-context-injector.ts` — returns `{ systemPrompt: spliceContextFragment(...) }` every turn.
- `packages/kb-extension/src/extension.ts` — returns `{ systemPrompt: insertFragment(...) }` (dox doctrine + nudges) every turn.

This affects every extension that uses pi's preferred structured API (`toolGuidelines`, `promptGuidelines`, `sections`), not just roles.

## What Changes

- The dashboard session-context injector stops returning `systemPrompt`. It writes its fragment into a named custom section on `event.systemPromptOptions.sections` instead. The fragment content (delimiter, `You are pi session …`, optional `Attached OpenSpec change: …`) is unchanged.
- The kb extension stops returning `systemPrompt`. The dox doctrine fragment and the first-contact / migration nudges go into a named custom section on `event.systemPromptOptions.sections`. The doctrine text is unchanged.
- The `Current working directory:` anchor splice goes away. pi renders `cwd` as its own structured section, and the anchor is already absent in structured mode (the injector currently takes its fallback-append path).
- Re-registering after `/reload` stays idempotent: assigning a section key overwrites instead of appending.
- Regression guard: a test asserts that a structured mutation made by a later `before_agent_start` handler (an Agent `toolGuidelines` bullet) appears in the provider-visible prompt when both injectors are active.
- **pi-owned sections survive too.** The same forced snapshot also drops sections pi adds itself. Session `01a1531a` records `<mcp_servers>` ("load `mcp__pi_dashboard` via `tool_search`"), but the model never receives it. Not forcing fixes this as well; a scenario and a test pin it.
- **kb tools listed in `<tools>`.** Only `kb_search` sets a `promptSnippet`, so pi leaves `kb_get`, `kb_neighbors` and `kb_guard_pause` out of the prompt's `<tools>` list, even though the dox doctrine names them. Each gets a one-line `promptSnippet` and one short `promptGuideline` (when to use it; for `kb_guard_pause`, never to skip a kb lookup).
- No change to the roles plugin bridge itself. Its existing `toolGuidelines.Agent` mutation starts working once nothing forces the prompt.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `agent-session-context-injection`: the injector contributes a structured section instead of returning a splice-replaced `systemPrompt`; the anchor-splice and fallback-append scenarios are replaced.
- `kb-doctrine-injection`: doctrine and nudges are contributed as a structured section instead of a returned `systemPrompt`; "coexists with other injectors" is extended to cover structured mutations from later handlers; ADDED: every kb retrieval tool is listed in the prompt's `<tools>` section with a guideline.
- `role-agent-guidance`: the guideline must reach the provider-visible system prompt, not just the recorded structured options.

## Impact

- Code: `packages/extension/src/dashboard-context-injector.ts` (+ its test), `packages/kb-extension/src/extension.ts` (hook + `kb_get`/`kb_neighbors`/`kb_guard_pause` registrations, + tests), the AGENTS.md rows for both.
- Runtime: the model-visible prompt gains `<dashboard_session>`/`<dox_doctrine>`-style tagged sections (names fixed in design) after `<cwd>`, and loses the forced-prompt override. pi can now send diffs of changed sections instead of the full prompt, so the prompt cache stays warm across turns.
- Related active change: `add-prompt-snapshot-audit-trail` captures `event.systemPrompt` in `before_agent_start`. Once nothing forces the prompt, the rendered text a handler sees still depends on handler order. That change should capture the final prompt, so note this as a dependency.
- Third-party extensions that still return `systemPrompt` will still clobber later structured mutations. Out of scope; recorded as a known limitation.
- pi version: needs `systemPromptOptions.sections` support (present in the pinned `>=1.1.0` line, verified against `dist/core/system-prompt.js`).

## Discipline Skills

- `review-code` — before commit (non-trivial change to two prompt injectors).
- `systematic-debugging` — root cause already established in explore (session `01a1531a`, transcript vs provider prompt diff); reuse that evidence for the regression test.
- None of `security-hardening`, `performance-optimization`, `observability-instrumentation` apply: no new untrusted input (the existing `sanitizeChangeName` is kept), no new latency path (the kb handler's 20 ms budget is unchanged), no new endpoint.
