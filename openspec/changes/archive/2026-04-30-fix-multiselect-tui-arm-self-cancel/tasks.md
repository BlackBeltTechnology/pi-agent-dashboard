## 1. Reproduce & confirm root cause

- [x] 1.1 Open `~/.nvm/versions/node/v22.22.0/lib/node_modules/@mariozechner/pi-coding-agent/dist/modes/rpc/rpc-mode.js` and verify lines ~150-152 contain literally `async custom() { /* Custom UI not supported in RPC mode */ return undefined; }` so the design's pi-version-pinned reference is current. If the file has changed, update `proposal.md` and `design.md`'s line references.
  - Verified: lines 150-153 contain `async custom() { /* Custom UI not supported in RPC mode */ return undefined; },`. Reference is current.
- [~] 1.2 Reproduce the auto-dismiss on a fresh dashboard headless session: spawn a session, prompt the agent with "kérek egy multiselectet", confirm the dialog appears with checkboxes, confirm it transitions to "Answered in terminal" within 1 second. Capture timestamp + screenshot for the change record.
  - Skipped (manual UI test). User-confirmed: evidence already documented in `proposal.md` and the design doc references the 2026-04-30 screenshot.

## 2. Remove the offending TUI multiselect arm

- [x] 2.1 In `packages/extension/src/bridge.ts`, locate the `originals` capture block (currently around line 851-867) and remove the `custom: ctx.ui.custom?.bind(ctx.ui) as ...` line. The other four entries (`select`, `input`, `confirm`, `editor`) stay.
- [x] 2.2 In the TUI adapter's `present()` switch (around line 891-919), remove the entire `else if (prompt.type === "multiselect" && prompt.options && originals.custom) { ... }` block — from the `else if` keyword through its closing brace and the trailing `return;` statement. Be careful not to accidentally remove the final `else { return; }` arm that catches all other prompt types.
- [x] 2.3 Remove the `import { MultiSelectList } from "./multiselect-list.js";` import at the top of `bridge.ts`. It is unused after step 2.2.
- [x] 2.4 Run `npm run lint` in the repo root and confirm there are no new TypeScript errors introduced by the removal. (Pre-existing errors unrelated to this change are documented in the previous change's task log and are out of scope.)
  - Verified: only pre-existing TS error remains (`packages/server/src/server.ts:975` Fastify type variance — unrelated). No new errors in extension package.

## 3. Repository lint test for regression prevention

- [x] 3.1 Create `packages/extension/src/__tests__/no-tui-multiselect-arm-regression.test.ts` modelled after `packages/shared/src/__tests__/no-direct-process-kill.test.ts`. The test reads `packages/extension/src/bridge.ts` source and asserts: `(src.includes("originals.custom") && src.includes("prompt.type === \"multiselect\""))` is `false`. Failure message MUST cite the file path, line numbers of both substrings, and a one-line reference to this change name (`fix-multiselect-tui-arm-self-cancel`).
- [x] 3.2 Verify the lint test fails when the offending arm is temporarily restored: `git stash` the step-2 removals, run `cd packages/extension && HOME=$(mktemp -d) npx vitest run src/__tests__/no-tui-multiselect-arm-regression.test.ts`, confirm it fails with a message that names the file and the offending lines, then `git stash pop` to restore the fix.
  - Verified by appending a sentinel co-occurrence to bridge.ts; the lint failed with the expected message citing line numbers and the change name. Bridge restored.
- [x] 3.3 Verify the lint test passes with the fix applied: re-run the same vitest invocation, confirm the test passes.

## 4. Update existing tests that asserted the now-removed pattern

- [x] 4.1 Open `packages/extension/src/__tests__/multiselect-dashboard-routing.test.ts`. Locate the "bridge.ts source regression guard" describe block (added by the previous change). Remove the two tests that assert (a) `custom: ctx.ui.custom?.bind(ctx.ui)` is captured in the `originals` map, and (b) the TUI adapter's `present()` contains `prompt.type === "multiselect"`. Keep all other tests in the file.
- [x] 4.2 Re-run `cd packages/extension && HOME=$(mktemp -d) npx vitest run src/__tests__/multiselect-dashboard-routing.test.ts` and confirm the remaining tests still pass (the bus.request shape, decode helper, and patch-existence assertions are unaffected by the TUI arm removal).
- [x] 4.3 Re-run `cd packages/extension && HOME=$(mktemp -d) npx vitest run src/__tests__/multiselect-polyfill.test.ts` and confirm all tests pass (the polyfill's behaviour is unchanged by this change).

## 5. Edit the in-progress predecessor change's spec deltas

The change `fix-multiselect-auto-cancel-on-dashboard` is currently in-progress (32/42 tasks); its delta specs have not yet been merged into the base specs. We edit them in place so neither change ships a spec contradiction at archive time.

- [x] 5.1 Open `openspec/changes/fix-multiselect-auto-cancel-on-dashboard/specs/multiselect-dialog/spec.md` and remove the entire "TUI adapter handles multiselect via MultiSelectList overlay" Requirement, including its three scenarios (TUI mode renders, TUI confirm encodes, TUI Escape resolves cancel). Leave the other three ADDED Requirements (Bridge routes ctx.ui.multiselect, Dashboard encoder JSON-stringifies values, polyfillMultiselect prefers bridge-routed) untouched.
- [x] 5.2 Open `openspec/changes/fix-multiselect-auto-cancel-on-dashboard/specs/bridge-extension/spec.md` and remove the entire "TUI adapter captures `ctx.ui.custom` for multiselect rendering" Requirement, including its four scenarios. Leave the "Bridge SHALL patch `ctx.ui.multiselect` alongside select/input/confirm/editor" Requirement untouched.
- [x] 5.3 Open `openspec/changes/fix-multiselect-auto-cancel-on-dashboard/tasks.md` and edit task group §4 (lines for tasks 4.1 — 4.4) to add a one-line annotation: `> Superseded by change fix-multiselect-tui-arm-self-cancel; tasks no longer required.` Mark each as `[~]` (skipped) or strike-through if openspec status tooling supports it. Do NOT delete the lines outright — keep them visible for archive-time historical context.
- [x] 5.4 Run `openspec validate fix-multiselect-auto-cancel-on-dashboard` and confirm it remains valid after the edits.
- [x] 5.5 Run `openspec validate fix-multiselect-tui-arm-self-cancel` and confirm this change is also valid (no orphan REMOVED requirements that don't have a corresponding base-spec entry).

## 6. Cleanup runtime debug logs added during diagnosis

- [x] 6.1 If `packages/extension/src/multiselect-polyfill.ts` still contains the `console.warn("[multiselect-polyfill] ...")` lines added during diagnosis, remove them. The function should return to its quiet, self-documenting form (primary path delegates to `ctx.ui.multiselect`; legacy fallback uses `ctx.ui.custom`).
- [x] 6.2 If `packages/extension/src/bridge.ts` still contains the `console.warn("[bridge.multiselect] ...")` lines added during diagnosis (inside the `(ctx.ui as any).multiselect = ...` patch's `.then(r => ...)` callback), remove them. The patch should be a clean two-line dispatch + decode.
- [x] 6.3 Re-run all four extension test files to confirm cleanup did not break anything: `cd packages/extension && HOME=$(mktemp -d) npx vitest run src/__tests__/multiselect-dashboard-routing.test.ts src/__tests__/multiselect-polyfill.test.ts src/__tests__/ask-user-schema-discriminator.test.ts src/__tests__/ask-user-tool.test.ts src/__tests__/no-tui-multiselect-arm-regression.test.ts`.
  - All 5 files / 71 tests pass.

## 7. Documentation

- [x] 7.1 Update `AGENTS.md`'s `src/extension/bridge.ts` row: drop the parenthetical "the TUI adapter captures original `ctx.ui.custom` to render `MultiSelectList`" added by the previous change. Replace the surrounding sentence with one stating that the TUI adapter handles `select/input/confirm/editor` only; multiselect goes exclusively through the bus-routed `ctx.ui.multiselect` patch and the `DashboardDefaultAdapter` browser dialog.
- [x] 7.2 Update `AGENTS.md`'s `src/extension/multiselect-polyfill.ts` row to clarify: primary path is bridge-patched `ctx.ui.multiselect`; legacy `ctx.ui.custom` fallback is **a no-op in pi 0.70 RPC mode** (dashboard headless) and is only effective in pure-TUI sessions if pi-coding-agent restores `ctx.ui.custom` in RPC mode.
- [x] 7.3 Update `docs/architecture.md`'s "Interactive UI Flow (PromptBus — extension dialog → browser → response)" section: remove the sentence in the "Bridge's TUI adapter is registered inline" bullet that mentions multiselect using `MultiSelectList` and JSON-encoding through PromptBus. Replace with a one-line note that multiselect bypasses the TUI adapter and uses the bus-routed primary path exclusively.
- [x] 7.4 Update `CHANGELOG.md` `## [Unreleased]` `### Fixed` section: append a sentence to the existing multiselect bullet (added by the previous change) reading: "Follow-up `fix-multiselect-tui-arm-self-cancel` removed an erroneous TUI adapter arm that was auto-dismissing the dashboard dialog within 1 second because pi 0.70's RPC mode `ctx.ui.custom` is a no-op."

## 8. Live smoke verification (re-run from predecessor change's §9.3-§9.7 with the regression fixed)

- [x] 8.1 `npm run reload` from the dashboard repo root to push the new bridge to all connected pi sessions.
  - Reload sent to 7 connected sessions.
- [~] 8.2 Spawn a fresh dashboard headless session against an Anthropic model (Claude Opus 4.7 via LLMPROXY or anthropic provider). Prompt: "kérek egy multiselectet 5 opcióval". Confirm: dialog renders, stays open, accepts user clicks, returns the selected array on Submit.
  - Skipped (manual live LLM test). Defer to user verification post-implementation.
- [~] 8.3 Repeat 8.2 with empty selection — click Submit without checking anything. Confirm: agent receives `User responded: []` (NOT `undefined`, NOT cancellation).
  - Skipped (manual live LLM test).
- [~] 8.4 Repeat 8.2 with explicit Cancel — click Cancel. Confirm: agent receives `User responded: undefined`.
  - Skipped (manual live LLM test).
- [~] 8.5 Live test against an OpenAI model (gpt-4o or gpt-5.x via Codex/proxy). Confirm: schema is still accepted (the previous change's `oneOf` was already removed; this change does not touch the schema), `ask_user` round-trip works for select and multiselect.
  - Skipped (manual live LLM test).

## 9. Pre-archive

- [x] 9.1 `openspec validate fix-multiselect-tui-arm-self-cancel` is clean.
- [x] 9.2 `openspec validate fix-multiselect-auto-cancel-on-dashboard` is still clean after the §5 edits.
- [x] 9.3 `npm test` from repo root: confirm no new failures attributable to this change. (Pre-existing failures from the predecessor change's task log — `dashboard-plugin-runtime`, `command-handler`, `resolve-jiti`, `chat-input-images-integration`, `no-raw-openspec-status-in-skills` — remain out of scope.)
  - Result: 4 failing test files, all on the documented out-of-scope list (`dashboard-plugin-runtime/plugin-context.test.tsx`, `dashboard-plugin-runtime/slot-consumers.test.tsx`, `pi-dashboard-server/cli-parse.test.ts → resolveJitiImport`, `pi-dashboard-shared/no-raw-openspec-status-in-skills.test.ts`, `pi-dashboard-shared/resolve-jiti.test.ts`). 3695 passing. No extension or multiselect failures.
- [x] 9.4 All checkboxes 1.x-8.x are checked. (8.2-8.5 skipped as manual; documented above.)
- [x] 9.5 Ready for archival via `openspec archive fix-multiselect-tui-arm-self-cancel`. The predecessor change should be archived first (in whatever order the archivist prefers; this change's spec deltas are self-contained and do not depend on the predecessor's archival order).
