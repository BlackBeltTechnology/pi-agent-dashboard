## 1. Regression test first (red)

- [x] 1.1 Add a boundary test (D6): build `BuildSystemPromptOptions` with `selectedTools` including `Agent`; run the dashboard injector handler, the kb doctrine handler, and a stub later handler that pushes a bullet to `toolGuidelines.Agent`; seed `sections.mcp_servers` (D8); render with pi's `buildSystemPrompt`. Assert that the dashboard delimiter, the dox delimiter, the Agent bullet and `<mcp_servers>` are all present and that no handler returned `systemPrompt`. Verify it FAILS on current code (`npx vitest run <test>`).

## 2. Dashboard session-context injector

- [x] 2.1 Update `packages/extension/src/__tests__/dashboard-context-injector.test.ts` to the new spec scenarios: `sections.dashboard_session` content, attach/detach, a missing `systemPromptOptions` is a no-op, no `systemPrompt` returned, reload yields one delimiter. Drop the anchor-splice / fallback-append / multiple-anchor cases. Verify the new cases fail first.
- [x] 2.2 Change `registerDashboardContextInjector` to write `event.systemPromptOptions.sections.dashboard_session = buildContextFragment(...)` and return `undefined` (D4). Remove the orphaned `spliceContextFragment` / `CWD_ANCHOR` (D3) after confirming there are no other importers (`rg -n "spliceContextFragment|CWD_ANCHOR" packages`). Verify that 2.1 passes.
- [x] 2.3 Update the module doc comment and `packages/extension/src/dashboard-context-injector.ts.AGENTS.md` (structured section, no splice, `See change: fix-forced-system-prompt-drops-tool-guidelines`). Verify that `rg -n "splice" packages/extension/src/dashboard-context-injector*` only hits history notes.

## 3. kb doctrine injector

- [x] 3.1 Update `packages/kb-extension/src/__tests__/doctrine-hook.test.ts`: doctrine, first-contact nudge and legacy-migration nudge land in `sections.dox_doctrine`; `inject: off` and an unreadable file leave no `dox_doctrine` key; no `systemPrompt` returned; reload yields one `── dox doctrine ──`. Verify the new cases fail first.
- [x] 3.2 Change the `before_agent_start` handler in `packages/kb-extension/src/extension.ts` to assign or delete `sections.dox_doctrine` and return `undefined` (D4). Replace the `typeof e.systemPrompt` guard with a `systemPromptOptions` object guard. Remove `insertFragment` from `doctrine.ts` only if `rg -n insertFragment packages` shows no other users. Verify that 3.1 and `doctrine.test.ts` / `doctrine-content.test.ts` pass.
- [x] 3.3 Check that the 20 ms p95 latency scenario still holds (existing latency test, if present, otherwise a 100-iteration timing in 3.1). Update the kb-extension `AGENTS.md` row for `extension.ts` / `doctrine.ts`.

## 4. kb tools listed in the prompt (D7)

- [x] 4.1 Add a test (in `packages/kb-extension/src/__tests__/`) that collects the `pi.registerTool` calls and asserts that `kb_search`, `kb_get`, `kb_neighbors` and `kb_guard_pause` each have a non-empty `promptSnippet` and at least one `promptGuidelines` entry, and that the `kb_guard_pause` guideline says never to skip a kb lookup. Verify it fails first.
- [x] 4.2 Add a one-line `promptSnippet` and one guideline to `kb_get`, `kb_neighbors` and `kb_guard_pause` in `packages/kb-extension/src/extension.ts`. Verify that 4.1 passes, and that a pi `buildSystemPrompt` render with all four tools active lists them in `<tools>`.

## 5. Integration and verification

- [x] 5.1 Run task 1.1 again and verify it is green. Then run `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` and grep for failures; verify there are no regressions.
- [x] 5.2 `npm run quality:changed` (Biome) is clean for the touched files.
- [x] 5.3 `npm run reload`, start a new turn, and inspect the newest session JSONL system entry. Verify that `sections.dashboard_session` and `sections.dox_doctrine` exist, `content` is empty (not forced), `sections.rules` holds the roles bullet, and `sections.tools` lists all four kb tools. Ask the agent to quote its Agent role guideline and its `<mcp_servers>` section, and verify it can.
- [x] 5.4 Add a cross-reference note to `openspec/changes/add-prompt-snapshot-audit-trail/` (proposal Impact or design) saying capture must render the final options after all handlers. Verify with `openspec validate add-prompt-snapshot-audit-trail`. (Note: that change is proposal-only, so it already failed with "no deltas"; the note is added and the failure is not caused by it.)
- [x] 5.5 `review-code` pass on the diff before commit. Then `openspec validate fix-forced-system-prompt-drops-tool-guidelines` passes.
