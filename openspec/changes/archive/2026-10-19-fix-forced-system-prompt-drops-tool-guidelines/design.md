## Context

pi `before_agent_start` (`ExtensionRunner.emitBeforeAgentStart`) passes one shared, mutable `systemPromptOptions` object to every handler, in extension load order. A handler that returns `{ systemPrompt }` sets `currentOptions.forceSystemPrompt` to that string. When `forceSystemPrompt` is set, `buildSystemPromptState` sends the forced string as the provider's system prompt and ignores the structured sections. The transcript still records the structured sections, so the JSONL looks correct.

`event.systemPrompt` is a getter that renders the options *at read time*. A forcer therefore freezes a snapshot that contains contributions from earlier handlers only. Later mutations to `toolGuidelines` / `promptGuidelines` / `sections` land in the options but never reach the provider.

Observed in session `01a1531a`: the transcript's `sections.rules` holds the roles bullet, but the provider prompt doesn't. Forcers: `dashboard-context-injector.ts` and `kb-extension/src/extension.ts`. Both run before the roles bridge (`packages[]` order).

pi's structured renderer (`buildSystemPromptSections`) puts built-ins in a fixed order (`preamble, tools, rules, docs, addendum?, project_context, skills, cwd`) and then custom `sections` in insertion order. Each is rendered `<name>\n…\n</name>`. Custom names must match `/^[a-z][a-z0-9_-]*$/` and must not be `preamble`. In structured mode there is no `Current working directory:` line. cwd is a `<cwd>` section, so the dashboard injector's anchor splice already falls through to fallback-append today.

## Goals / Non-Goals

**Goals:**
- No first-party `before_agent_start` handler forces the system prompt.
- Fragment text stays byte-for-byte the same as today, apart from the surrounding `<section>` tags.

**Non-Goals:**
- Policing third-party extensions that still force the prompt.
- Schema-driven role guidance for tools other than `Agent`, or `tool_call` enforcement. Both are separate follow-ups from the same explore session.
- Changing the roles bridge.

## Decisions

**D1 — Contribute through custom `sections`, not `promptGuidelines` or `appendSystemPrompt`.**
- `sections.<name>` is pi's documented extension point for prose blocks. It is keyed, so re-assigning it is idempotent, and pi diffs it for transcript deltas.
- `promptGuidelines` turns each entry into a `- bullet` inside `<rules>`. That breaks the multi-line doctrine and session block.
- `appendSystemPrompt` is a single shared string: two writers collide, and reload stacking returns.
- Rejected alternative: keep returning `systemPrompt` and make the roles bridge patch `forceSystemPrompt` (option B from explore). That only fixes roles, not other extensions.

**D2 — Section names: `dashboard_session` (bridge) and `dox_doctrine` (kb).**
- Both match pi's name regex, and neither clashes with a built-in.
- They appear as `<dashboard_session>` / `<dox_doctrine>` tags in the model-visible prompt.
- The existing delimiter lines (`── pi-dashboard session context ──`, `── dox doctrine ──`) stay as the first line of the section content. Tests, idempotency checks and human readers already key on them.

**D3 — Drop the `Current working directory:` anchor splice.**
- The anchor doesn't exist in structured rendering. The fragment already carries `cwd`. Pi's `<cwd>` section stays untouched.
- `spliceContextFragment` / `CWD_ANCHOR` become orphans of this change and are removed, together with their tests.
- `buildContextFragment` and `sanitizeChangeName` are kept.
- Same for kb: `insertFragment` (`doctrine.ts:88`) is no longer called from the hook. Remove it if nothing else imports it, otherwise leave it.

**D4 — Write to the event's options object; return `undefined`.**
- Mutate `event.systemPromptOptions.sections ??= {}` and then `sections[name] = fragment`.
- Return nothing, so `forceSystemPrompt` stays unset.
- When `systemPromptOptions` is missing or not an object, contribute nothing. The previous `typeof event.systemPrompt !== "string"` guard is replaced by this check.
- To disable (`doctrine.inject: off`, or kb has no fragment), `delete sections.dox_doctrine` so a stale value from an earlier turn's base options can't leak.

**D5 — Keep the `isActive()` reload guard on the dashboard injector.** With keyed assignment a stale generation would only overwrite the same key with the same content, so the guard is no longer needed for correctness. It stays because it costs nothing and keeps the bridge-wide handler pattern uniform.

**D6 — Regression test at the pi boundary.** A test builds a real `BuildSystemPromptOptions`, runs the two injectors plus a stub "later" handler that pushes `toolGuidelines.Agent`, then renders with pi's own `buildSystemPrompt(options)`. It asserts all three fragments are present, a seeded `sections.mcp_servers` survives, and `forceSystemPrompt === undefined`. This is the test that would have caught the original bug.

**D7 — kb tools: add `promptSnippet` + `promptGuidelines` at registration.**
- pi builds `<tools>` only from tools that declare a `promptSnippet`, and puts `promptGuidelines` into `<rules>` only for tools in the active set. `kb_get`, `kb_neighbors` and `kb_guard_pause` declare neither, so the model sees them only as bare function schemas, while the doctrine refers to them by name.
- Adding the fields at registration is static and needs no hook. It also obeys the active set automatically, so a deactivated tool's text disappears with it.
- Wording: one line each, matching `kb_search`'s style.
  - `kb_get`: "read the section a kb hit points at".
  - `kb_neighbors`: "chase related docs/imports from a kb hit before grepping".
  - `kb_guard_pause`: "bulk work only; never to skip a kb lookup".
- Rejected alternative: put the tool list into the `dox_doctrine` section. That would duplicate pi's tool rendering and drift when tools are toggled.

**D8 — `mcp_servers` and other pi-owned sections need no code.** Removing the forcers (D1/D4) restores them. The D6 boundary test also seeds a `sections.mcp_servers` entry and asserts it is rendered.

## Risks / Trade-offs

- [Prompt layout shifts: fragments move from raw trailing text into tagged sections] → Content is unchanged and only the wrapper differs. Check the `kb-doctrine` content tests and any snapshot tests.
- [Cache churn: the first turn after the upgrade sends a sections diff] → One-time cost. Afterwards the sections are stable across turns (better than today, where forced prompts are opaque full replacements).
- [`add-prompt-snapshot-audit-trail` reads `event.systemPrompt` mid-chain] → Recorded in the proposal's Impact section. That change should render from the final options after all handlers have run.
- [Third-party forcer installed later re-breaks role guidance] → Known limitation. A follow-up could detect `forceSystemPrompt` in a late handler and log a warning.
- [Older pi without `systemPromptOptions.sections`] → The pinned peer range `>=1.1.0` has it. If the options object is missing, D4 makes the injector a no-op instead of throwing.

## Migration Plan

- Extension-only change: `npm run reload` picks up the bridge and kb-extension. There is no persisted state.
- Rollback: revert the commit. The forced-prompt behaviour comes back, with no data impact.
- Post-deploy check: in a new turn, the session JSONL system entry has `sections.dashboard_session` and `sections.dox_doctrine`, and `content` is empty (not forced). The model can quote the roles bullet.
