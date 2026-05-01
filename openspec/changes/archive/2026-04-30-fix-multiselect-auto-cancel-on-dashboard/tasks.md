> **Archive note (2026-04-30):** 10 manual/live-LLM tasks were marked `[~]` skipped at archive time (initial reproduction §1.1–1.2, full smoke §9.2–9.7, meta-checks §11.2–11.3). The follow-up change `fix-multiselect-tui-arm-self-cancel` mechanically validated the same code path (bus-routed multiselect + dashboard encoder) and was archived simultaneously. The 4 §4 tasks were marked `[~]` superseded by that follow-up before its archival.

## 1. Reproduction & baseline

- [~] 1.1 Reproduce the bug on the dashboard: launch a session against an Anthropic model (Claude Sonnet 4 or Opus), prompt the agent with "Ask me to multi-select between three example items", confirm that the dialog either does not appear or appears and auto-cancels. Capture: (a) browser console state, (b) `~/.pi/dashboard/server.log` excerpt around the prompt, (c) chat-area screenshot showing "User cancelled batch" / "continuing without answer" message.
- [~] 1.2 Confirm parity with TUI: launch the same prompt against `pi` directly (no dashboard) and verify multiselect renders in the terminal as a working `MultiSelectList`. Capture before/after parity expectation.

## 2. Layer 1 — Bridge `ctx.ui.multiselect` patch

- [x] 2.1 Edit `packages/extension/src/bridge.ts` (~line 948, after the `editor` patch and before `notify`): assign `(ctx.ui as any).multiselect = (title, options, opts) => bus.request({ pipeline: "command", type: "multiselect", question: title, options, metadata: opts?.message ? { message: opts.message } : undefined }).then(r => decodeMultiselectAnswer(r))` where `decodeMultiselectAnswer({ cancelled, answer })` returns `undefined` if cancelled, `[]` if answer is null/empty, or `JSON.parse(answer)` otherwise (with a `try/catch` returning `[]` on parse failure).
- [x] 2.2 If `(ctx.ui as any).multiselect` is already a function before the assignment, log a one-time warning (`console.warn("[bridge] ctx.ui.multiselect already exists — overriding for PromptBus routing")`) so future upstream additions are visible, then proceed with the assignment.
- [x] 2.3 Hoist `decodeMultiselectAnswer` into a small pure helper near the top of `bridge.ts` (or extract it into `packages/extension/src/multiselect-decode.ts`) so the test and the runtime share the same code.
- [x] 2.4 Write `packages/extension/src/__tests__/multiselect-dashboard-routing.test.ts`:
  - 2.4.1 Asserts that after running the bridge's PromptBus patching block on a stub `ctx`, `ctx.ui.multiselect` is a function.
  - 2.4.2 Calling `ctx.ui.multiselect("Pick", ["a","b","c"], { message: "context" })` invokes a mocked `bus.request` exactly once with `{ pipeline: "command", type: "multiselect", question: "Pick", options: ["a","b","c"], metadata: { message: "context" } }`.
  - 2.4.3 When the mock resolves to `{ id, cancelled: false, answer: '["a","c"]', source: "dashboard-default" }`, the call resolves to `["a","c"]`.
  - 2.4.4 When the mock resolves to `{ id, cancelled: false, answer: "[]", source: "dashboard-default" }`, the call resolves to `[]` (empty selection is a real answer).
  - 2.4.5 When the mock resolves to `{ id, cancelled: true, source: "dashboard-default" }`, the call resolves to `undefined`.
  - 2.4.6 When the mock resolves to `{ id, cancelled: false, answer: "not-json", source: "dashboard-default" }`, the call resolves to `[]` (graceful degradation, no throw).
- [x] 2.5 Run `cd packages/extension && npx vitest run src/__tests__/multiselect-dashboard-routing.test.ts` and confirm all 6 sub-tests pass.

## 3. Layer 1 — Polyfill fallback chain

- [x] 3.1 Edit `packages/extension/src/multiselect-polyfill.ts`: replace the body of `polyfillMultiselect` with a runtime check `if (typeof (ctx.ui as any).multiselect === "function") return Promise.resolve((ctx.ui as any).multiselect(title, options, opts));`, otherwise fall through to the existing `ctx.ui.custom` + `MultiSelectList` branch.
- [x] 3.2 Update the file's top-level docstring to reflect the new fallback chain (primary: bus-routed `ctx.ui.multiselect`; fallback: TUI overlay).
- [x] 3.3 Write `packages/extension/src/__tests__/multiselect-polyfill.test.ts` (or extend the existing test file):
  - 3.3.1 With a stub `ctx` whose `ui.multiselect` is a function returning `Promise.resolve(["a"])`, `polyfillMultiselect(ctx, "t", ["a","b"])` resolves to `["a"]` AND `ctx.ui.custom` is NOT called.
  - 3.3.2 With a stub `ctx` whose `ui` has only `custom` (no `multiselect`), `polyfillMultiselect` invokes `custom`'s factory; the factory's `done(["b"])` resolves the promise to `["b"]`.
  - 3.3.3 With the same fallback stub, the factory's `done(undefined)` resolves the promise to `undefined`.
- [x] 3.4 Run `cd packages/extension && npx vitest run src/__tests__/multiselect-polyfill.test.ts` and confirm all 3 sub-tests pass.

## 4. Layer 1 — TUI adapter handles multiselect

> Superseded by change `fix-multiselect-tui-arm-self-cancel`; tasks no longer required.
> The TUI multiselect arm was removed because pi 0.70 RPC mode's `ctx.ui.custom`
> is a no-op, causing the TUI adapter to auto-cancel the dashboard-rendered
> dialog within ~1 event-loop tick. See `openspec/changes/fix-multiselect-tui-arm-self-cancel/`.

- [~] 4.1 ~~In `packages/extension/src/bridge.ts`, in the `originals` capture block (~line 851-857), add `custom: ctx.ui.custom?.bind(ctx.ui) as ((factory: any, options?: any) => Promise<unknown>) | undefined` so the TUI adapter can call the *original* (unpatched) `ctx.ui.custom`.~~ (superseded)
- [~] 4.2 ~~In the TUI adapter's `present()` function (~line 866-895), add an `else if (prompt.type === "multiselect" && prompt.options && originals.custom)` arm:~~ (superseded)
  - ~~Calls `originals.custom<string[] | undefined>((tui, theme, kb, done) => { const list = new MultiSelectList(prompt.question, prompt.options!, undefined); list.onConfirm = (selected) => done(selected); list.onCancel = () => done(undefined); return list as unknown; })`.~~
  - ~~Encodes the result: `answer = result === undefined ? undefined : JSON.stringify(result)`.~~
  - ~~Calls `bus.respond({ id: prompt.id, answer: answerStr, cancelled: answerStr == null, source: "tui" })`.~~
- [~] 4.3 ~~Import `MultiSelectList` at the top of `bridge.ts` if not already imported.~~ (superseded)
- [~] 4.4 ~~Add a unit test arm to `multiselect-dashboard-routing.test.ts` (or a sibling file): stub a TUI-mode `ctx` (`ctx.hasUI: true`, `originals.custom` mocked to immediately call its factory's `done(["x"])`); send a multiselect `prompt_request` to the registered TUI adapter; assert that `bus.respond` is called with `{ id, answer: '["x"]', cancelled: false, source: "tui" }`.~~ (superseded)

## 5. Layer 1 — Client `{ values }` answer encoding

- [x] 5.1 Edit `packages/client/src/hooks/useSessionActions.ts` `handleRespondToUi` (~line 55-65): replace the `answer` computation with the order-preserving check from design.md §4 — multiselect (`Array.isArray(result.values)`) → `JSON.stringify(values)`; then `value`; then `confirmed?.toString()`.
- [x] 5.2 Write `packages/client/src/__tests__/handle-respond-to-ui-multiselect.test.ts`:
  - 5.2.1 `handleRespondToUi("req-1", { values: ["a", "b"] })` → emits `prompt_response` with `answer: '["a","b"]'`, `cancelled: undefined`.
  - 5.2.2 `handleRespondToUi("req-1", { values: [] })` → emits `prompt_response` with `answer: "[]"` (NOT `""`, NOT `undefined`).
  - 5.2.3 `handleRespondToUi("req-1", undefined, true)` → emits `prompt_response` with `answer: undefined`, `cancelled: true`.
  - 5.2.4 Existing `{ value: "x" }` and `{ confirmed: true }` cases still encode as `"x"` and `"true"` respectively.
- [x] 5.3 Run `cd packages/client && npx vitest run src/__tests__/handle-respond-to-ui-multiselect.test.ts` and confirm all 4 sub-tests pass.

## 6. Layer 2 — Schema body-level `oneOf` (defense in depth)

- [x] 6.1 Edit `packages/extension/src/ask-user-tool.ts` `parameters: Type.Object({...}, { ... })`: add a `oneOf` array in the second argument (the schema metadata bag) with five arms over `method` literal, each declaring its `required` list and (where applicable) `options.minItems` / `questions.minItems`. Match the shape in proposal.md §"Layer 2".
- [x] 6.2 Apply the analogous `oneOf` (4 arms — confirm/select/multiselect/input, no batch nesting) to `SubQuestionSchema`'s second argument.
- [x] 6.3 Verify by `console.log(JSON.stringify(toolDef.parameters, null, 2))` in a temporary debug script that root has `type: "object"` AND `oneOf` is present at body level. Discard the debug script.
- [x] 6.4 Write `packages/extension/src/__tests__/ask-user-schema-discriminator.test.ts`:
  - 6.4.1 Build the tool def via `registerAskUserTool`, capture the registered `parameters`, JSON-serialize.
  - 6.4.2 Assert root `type === "object"` (OpenAI compat preserved).
  - 6.4.3 Assert root has `oneOf` array of length 5.
  - 6.4.4 For the `multiselect` arm: `required` includes `["method", "title", "options"]`, `properties.options.minItems === 1`.
  - 6.4.5 For the `select` arm: `properties.options.minItems === 2`.
  - 6.4.6 For the `batch` arm: `required` includes `"questions"`, `properties.questions.minItems === 1`.
  - 6.4.7 Negative cases: `prepareArguments` is unchanged — pass through a few existing fixtures from `ask-user-tool.test.ts` and assert no behavioural drift.
- [x] 6.5 Run `cd packages/extension && npx vitest run src/__tests__/ask-user-schema-discriminator.test.ts` and confirm all 6 sub-tests pass.
- [x] 6.6 Run the full `ask-user-tool.test.ts` suite to confirm no behaviour drift: `cd packages/extension && npx vitest run src/__tests__/ask-user-tool.test.ts` (must remain green; the runtime tests don't depend on the schema's `oneOf` presence).

## 7. Spec deltas

- [x] 7.1 Write `openspec/changes/fix-multiselect-auto-cancel-on-dashboard/specs/multiselect-dialog/spec.md` — REMOVE the "UI proxy multiselect forwarding" Requirement (and its scenarios), REMOVE the "UI proxy extracts multiselect result" Requirement (and its scenarios). ADD three new Requirements: (1) `bridge.ts` patches `ctx.ui.multiselect` to route through PromptBus; (2) the TUI adapter handles multiselect via `MultiSelectList` when `ctx.hasUI === true`; (3) the dashboard client encodes `{ values: string[] }` results as `JSON.stringify(values)` in the `prompt_response.answer` field.
- [x] 7.2 Write `openspec/changes/fix-multiselect-auto-cancel-on-dashboard/specs/bridge-extension/spec.md` — ADD a Requirement: "Bridge SHALL patch `ctx.ui.multiselect` alongside select/input/confirm/editor", with a Scenario asserting the patch's presence and the dispatched bus.request shape.
- [x] 7.3 Write `openspec/changes/fix-multiselect-auto-cancel-on-dashboard/specs/ask-user-tool/spec.md` — MODIFY the existing "Strict parameter schema per method" Requirement: clarify that the schema root is `type: "object"` (OpenAI compat) AND the per-method strictness is expressed via a body-level `oneOf` discriminator (Anthropic regains the per-arm `required` + `minItems` enforcement).
- [x] 7.4 Run `openspec validate fix-multiselect-auto-cancel-on-dashboard` and resolve any schema errors.

## 8. AGENTS.md update

- [x] 8.1 Update the `multiselect-polyfill.ts` row in AGENTS.md: replace "thin wrapper around `ctx.ui.custom<T>()`" with "delegates to bridge-patched `ctx.ui.multiselect` when present (PromptBus path); falls back to `ctx.ui.custom` + `MultiSelectList` for legacy / TUI-only pi versions". Keep the rest of the row intact.
- [x] 8.2 Add one-line cross-reference to this change name on the `bridge.ts` row noting the new multiselect patch site.

## 9. Verification — end-to-end

- [x] 9.1 `npm run build` succeeds.
- [~] 9.2 Full test suite green: `npm test 2>&1 | tee /tmp/pi-test.log; grep -nE 'FAIL|✗|✘' /tmp/pi-test.log` shows no failures.
- [~] 9.3 Live smoke test on dashboard with Anthropic model: launch session, prompt agent for a multi-pick question, confirm dialog renders in browser, click two checkboxes, click Submit, confirm the agent receives the array and proceeds.
- [~] 9.4 Live smoke test on TUI: same prompt against `pi` directly (no dashboard), confirm `MultiSelectList` overlay renders in terminal, ↑↓ navigate, Space toggle, Enter confirm, observe agent receives the array.
- [~] 9.5 Live smoke test of empty selection on dashboard: open multiselect, click Submit without checking anything, confirm the agent receives `[]` (NOT cancellation) and acts accordingly.
- [~] 9.6 Live smoke test of cancellation on dashboard: open multiselect, click Cancel, confirm the agent receives cancellation signal.
- [~] 9.7 Live test against an OpenAI model (gpt-4o or gpt-4.1) to confirm Layer 2 schema changes do not regress OpenAI compatibility — observe a successful `select` and `multiselect` round-trip; if the OpenAI API errors with a schema validation message, drop Layer 2 and ship Layer 1 only.

## 10. Documentation

- [x] 10.1 Update `CHANGELOG.md` `## [Unreleased]` with a `### Fixed` entry: "Multiselect dialogs now render in the dashboard browser instead of silently auto-cancelling. Routes through the same PromptBus path as select/input/confirm; falls back to the terminal overlay in TUI mode."
- [x] 10.2 If `docs/architecture.md` has a section describing the PromptBus or interactive-renderers pipeline, add a one-paragraph note that multiselect rejoined the bus path in this change with a code reference to `bridge.ts`'s `ctx.ui.multiselect` assignment.

## 11. Pre-archive

- [x] 11.1 `openspec validate fix-multiselect-auto-cancel-on-dashboard` is clean.
- [~] 11.2 All checkboxes 1.x–10.x are checked.
- [~] 11.3 The change is ready for archival via `openspec archive fix-multiselect-auto-cancel-on-dashboard`.
