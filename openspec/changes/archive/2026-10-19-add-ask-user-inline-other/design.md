## Context

See proposal.md (Why). Current state that shapes the approach:

- **Prompt flow.**
  - The bridge patches `ctx.ui.select` and `ctx.ui.multiselect` to call `bus.request({ …, metadata: buildPromptMeta(opts) })` (`packages/extension/src/bridge-handlers/ui-prompt-patch.ts:67-69`, `:147-154`).
  - The bus emits `prompt_request`. The client reducers map `prompt.metadata.*` onto renderer `params` (`packages/client/src/hooks/useMessageHandler.ts:1849-1869`, `packages/client/src/hooks/useSessionState.ts:156-178`).
  - The renderer calls `onRespond(result)`, `encodePromptAnswer` turns the result into a string (`packages/shared/src/prompt-answer.ts:28-47`), and that string goes out as `prompt_response.answer`.
- **Decoders do not filter.** `ctx.ui.select` resolves `r.answer` verbatim (`ui-prompt-patch.ts:68-69`), and `decodeMultiselectAnswer` returns the parsed array unchanged (`packages/extension/src/multiselect-decode.ts`).
- **`buildPromptMeta`** emits only `message`, `toolCallId` and sanitized `plugin`. It returns `undefined` when none of these is present (`packages/extension/src/prompt-meta.ts:46-63`, early return at `:54`).
- **Second answer road.**
  - The pending-question stack keeps a `QuestionRecord` (`packages/server/src/questions/question-store.ts:71-88`) built from a live `base` in `onTracked` (`:313-326`). Persisted question files are a whitelisted `QuestionFile` (`question-files.ts`).
  - `QuestionDialog` mounts the standard renderers with `params={{title, options, questions}}` (`packages/client/src/components/questions/QuestionDialog.tsx:202`). It swallows every Escape in a capture handler (`:372-378`).
  - REST validation runs `validateQuestionAnswer`, which rejects any non-option select/multiselect value today (`packages/server/src/questions/question-routes.ts:97-101`; `prompt-answer.ts:69-79`, `:124`).
  - The chat road's `relayBrowserPromptResponse` does no validation (`packages/server/src/questions/question-answer.ts:46-55`).
- **Callers that require an exact option** (why the change is opt-in):
  - pi-flows branch routing: `step.branches[response.answer]` (external, `pi-flows/extensions/flow-engine/flow-execution.ts:903`, `:918`). pi-flows 0.3.2 sets no `metadata.flowId`, so flow prompts cannot be identified.
  - Path-gate approval, which fails closed (`packages/extension/src/path-gate/handler.ts:224`).
  - ACP permission, where an unknown answer resolves as `cancelled` (`packages/server/src/acp-bridge/permission-bridge.ts:89`).
- **History tool card.** `AskUserToolRenderer` parses `/User responded:\s*(.*)/s` (first occurrence). It highlights options by string equality and shows a Response row only when there are no options (`packages/client/src/components/tool-renderers/AskUserToolRenderer.tsx:143`, `:191`, `:209`).
- **`ask_user` batch dispatch** rebuilds each sub-question from an explicit field list (`packages/extension/src/ask-user-tool.ts:353-359`). Any new field is dropped unless it is added there.
- **Main-spec drift.** The `ask-user-tool` main spec still requires a body-level `oneOf` (`openspec/specs/ask-user-tool/spec.md:27-90`). The code forbids it (`ask-user-tool.ts:173-197`; guard test `packages/extension/src/__tests__/ask-user-schema-discriminator.test.ts`).
- **i18n.** `i18nT(key, vars, fallback)`, with locale tables in `packages/client/src/lib/i18n/i18n-{hu,zh-CN}.ts` and English via the fallback (spec `ui-i18n-coverage`).

## Goals / Non-Goals

**Goals:**
- One shared "Other" building block for Select, Multiselect and the Batch steps, with identical behaviour and a11y everywhere.
- Existing prompts unchanged. Answers stay plain strings. The request side gets one additive opt-in key.
- One enablement predicate, shared by client and server, so the UI shows Other exactly when the REST validator accepts a custom answer.

**Non-Goals:**
- A TUI equivalent.
- Validation on the chat WS road (pre-existing gap; see Risks).
- Opting in any caller other than the dashboard `ask_user`.
- The pre-existing missing multiselect highlighting in `AskUserToolRenderer`. Only the custom rows are added.

## Decisions

### D1 — Opt-in via a core metadata key, with one shared predicate
`isOtherAllowed({ allowOther, options })` lives in `packages/shared/src/prompt-answer.ts` and returns `allowOther === true && Array.isArray(options) && options.length > 0 && !hasOwnOtherOption(options)`. `hasOwnOtherOption(options)` is also in shared and returns `options.some(o => typeof o === "string" && /^other(?![\p{L}\p{N}])/iu.test(o.trim()))`; non-string options are never treated as "Other" and never throw. The server validator, the client reducers, `QuestionDialog` and the renderers all import this one copy; there is no client-local duplicate. So the dialog UI and the REST validator cannot disagree.
- Alternatives considered:
  - Default-on everywhere with an opt-out, plus a flow-tag rule. The user first chose this. It was abandoned in doubt-review cycle 2 because pi-flows 0.3.2 sets no `flowId`: its branch selects would have received free text, and there is no other marker to identify them.
  - The user then chose opt-in.
- `allowOther` becomes a **core** key in `buildPromptMeta`, emitted only when it is exactly `true`. The early-return guard at `prompt-meta.ts:54` must include it, or a call whose only key is `allowOther: true` loses its opt-in. Because it is core, `pluginMeta` cannot spoof it.
- The reducers copy `metadata.allowOther === true` into `params.allowOther`. Renderers call `isOtherAllowed({ allowOther: params.allowOther, options })`.
- `BatchQuestion` gains `allowOther?: boolean` (`packages/shared/src/protocol.ts:721-727`). Sub-questions travel whole in `metadata.questions`.
- Server: `QuestionRecord` and `QuestionDetail` (`packages/shared/src/question-types.ts:52`) gain `allowOther?: true`, set in `onTracked` from the live metadata. It is not persisted: on rebind it is recomputed from the re-sent prompt (`question-store.ts:333-340`). `batchQuestionsOf` already passes sub-question objects through (`:292-293`).
- **Typing.** pi core's `ExtensionUIDialogOptions` has no `allowOther`. The dashboard `ask_user` passes it through `ctx.ui` typed `any`. A third-party TS caller that wants to opt in needs a cast.

### D2 — Suppress when the caller already offers an "Other" option
This is part of `isOtherAllowed`, so it binds both the UI and the validator. The regex tests the whole trimmed option text. `"Other (describe)"`, `"other"`, `" Other: x"`, `"Other — describe"` and `"Other-wise"` suppress the row; `"Others"`, `"Otherwise"`, `"Others will decide"`, `"Other1"` and `"Otheré"` do not. The rule is English-only (`Egyéb` / `其他` do not suppress); the worst case there is a duplicate-looking row next to the caller's own option, and both answer paths still work. Worst case is a missing row; the caller's own option still answers.

### D3 — Plain string; "custom" is derived
A custom answer is the trimmed text in `value` / inside `values`. `encodePromptAnswer` is unchanged; tests only pin that behaviour. Consumers derive "custom" as `!options.includes(v)` (exact, case-sensitive). When the text equals an option, it *is* that option. Multiselect de-duplicates on submit.
- Alternative: a `{custom:true}` / `customValues[]` shape. Rejected because it changes the response shape and every `ctx.ui.select` caller would stop receiving a plain string.

### D4 — Shared `OtherOption` component
New file: `packages/client/src/components/interactive-renderers/OtherOption.tsx`. It is controlled (`active`, `text`, `onActiveChange`, `onTextChange`, `onSubmit?`) and has two variants:
- `radio`: a button row that reveals the text field.
- `checkbox`: a checkbox row that reveals the text field.

Behaviour:
- The input has an i18n `aria-label`. Focus moves to the field only when the user activates the row.
- Enter submits or commits when the trimmed text is non-empty.
- Escape collapses the field and is consumed: the input's handler calls `preventDefault()` and `stopPropagation()`. Two layers would otherwise also act on it:
  - The dialog's own capture handler (`QuestionDialog.tsx:372-378`) fires before the input sees the key. It gains an early return when `e.target` carries `data-other-input`.
  - The document-level escape stack (`QuestionDialog.tsx:349` `useEscapeDismiss`; `packages/client-utils/src/escape-stack.ts:55-63`) skips events with `defaultPrevented` set.
  The next Escape, from outside the field, closes the dialog as before.
- Text renders as a React text node only, never through `InlineMarkdown` or `MarkdownContent`.
- New i18n keys go into `i18n-hu.ts` and `i18n-zh-CN.ts`, with English as the fallback argument: the row label, the field label, and the resolved "Other" label.
- Multiselect "Select all" touches only the listed options and leaves Other's checked state and text untouched.

### D5 — Batch answer state
Per-step answers keep today's `Answer` union: `{value}` for select steps and `{values}` for multiselect steps. A parallel `otherDraft: Array<{active: boolean; text: string} | undefined>` lives in `BatchRenderer`'s own state, next to `answers`. It survives step changes because `StepBody` remounts per step while the state stays in the parent.
- A select step with "Other" active writes `{value: text.trim()}`, or leaves the answer `undefined` while the text is empty, which blocks `Next`.
- A multiselect step writes `values = [...checked, text.trim()]` (de-duplicated) when "Other" is checked with non-empty text. `Next` is disabled while "Other" is checked with empty text.
- The Review page and resolved summary already render strings and pills (`BatchRenderer.tsx:40-66`), so they need no change.

### D6 — Validator relaxes only for opted-in prompts
`validateQuestionAnswer(prompt, answer)` uses `isOtherAllowed({ allowOther: prompt.allowOther, options })`, and `isOtherAllowed(sub)` for each batch sub-question. When it is true:
- `select` accepts an option, or a non-option string that is non-blank after trimming.
- `multiselect` accepts distinct values: options plus at most one non-option, non-blank string. Duplicates are still invalid.

A non-option string counts as custom only if it is non-empty and equal to its own trim, which is the shape the UI produces. A padded string such as `" A "` is rejected (`400`) instead of being silently treated as custom. Otherwise the validator behaves exactly as today. `ValidatablePrompt` gains `allowOther?: boolean`, and `question-routes.ts:97-101` passes `rec.allowOther`. Valid answers are transmitted as posted, so the REST road and the UI produce byte-identical strings.

### D7 — `ask_user` tool
- **Schema:** add `allowOther` (optional boolean) at the top level and in `SubQuestionSchema`. The description is dashboard-only: "in the dashboard the user may type a custom answer beside the options; default true; terminal UI shows options only". The root stays flat. The stale `oneOf` main-spec requirement is REMOVED and replaced by an ADDED flat-schema requirement that matches the shipped code.
- **Rescue:** `prepareArguments` and `normalizeSubQuestion`:
  - coerce the strings `"true"`/`"false"` to booleans, and drop any other non-boolean `allowOther`/`allowCustom` (dropped counts as absent), so `allowOther: "false"` cannot silently become an opt-in;
  - map `allowCustom` → `allowOther` when the latter is absent, then delete `allowCustom`.
  No literal option is ever appended. The stale "schema branch" wording in "Argument rescue for batch shapes" is MODIFIED to match the flat schema.
- **Registration spec:** the bridge-extension "Bridge registers ask_user tool" requirement is MODIFIED. It drops the stale `.pi/extensions/ask-user.ts` reference, and its select scenario now passes `{allowOther: true}`.
- **Dispatch:**
  - The single branch passes `allowOther: true` in `msgOpts` when `params.allowOther !== false` and the method is select/multiselect. `polyfillMultiselect`'s `opts` type (`packages/extension/src/multiselect-polyfill.ts`) is widened to carry it.
  - The batch map at `ask-user-tool.ts:353-359` gains `allowOther: true` for select/multiselect sub-questions when `(sq.allowOther ?? params.allowOther) !== false`.
- **Result text:**
  - A pure helper `customValues(answer, options)` drives a note line before the unchanged final `User responded: ${JSON.stringify(result)}` line.
  - Batch select/multiselect lines get the ` (custom)` suffix; input and confirm lines never do.
  - `details` is unchanged.

### D8 — History tool card
`AskUserToolRenderer` parses the LAST LINE that starts with `User responded:` (for example `/^User responded:\s*(.*)$/gm`, taking the final match). It does not use a substring search, because `JSON.stringify` escapes newlines: marker text inside the note line or inside the payload is always mid-line, never at the start of a line.
- Select: when the string response is not among the options, show a "Response:" row with the plain text.
- Multiselect: `JSON.parse` the captured text as an array, filter it to non-option values, and when any remain show a "Response:" row listing only those.

The Response-row condition at `:209` becomes "no options, or there is a custom value".

## Risks / Trade-offs

- [The chat WS road (`relayBrowserPromptResponse`) does not validate, so a crafted client message can send a non-option answer to any prompt] → This gap already exists and this change leaves it untouched. Exact-match callers already handle unknown answers by failing closed, cancelling, or skipping the branch. Listed as a non-goal.
- [Heuristic suppression (D2) can misfire, e.g. on "Other-wise"] → The worst case is a missing row; the caller's own option still answers. The validator applies the same rule, so the two stay consistent.
- [pi-flows and the dashboard both register `ask_user`] → The dashboard tool overrides in dashboard-spawned sessions and is skipped otherwise (bridge-extension "Dashboard-spawned sessions override existing ask_user"), so the two are never active together. Only the dashboard tool sets the opt-in.
- [Default `allowOther: true` changes every dashboard `ask_user` select/multiselect: the LLM can now receive free text it did not list] → This is intended (issue #872). The model is told in the result text (`Custom answer (not one of the options).`) and can opt out with `allowOther: false`. Noted in the CHANGELOG.
- [`flow-question-routing` requires producers to attach `metadata.flowId`, but pi-flows 0.3.2 does not, and `buildPromptMeta` would drop it anyway] → This gap already exists and is untouched here. Opt-in makes this change independent of it.
- [A new client with an old server] → The question dialog shows Other on `ask_user` prompts, and the old validator returns `400`. Client and server ship in one package (`pi-dashboard`), so this only occurs with a manually mixed install. The error is shown and the question stays open.
- [An old client with a new bridge or server] → The old client ignores `metadata.allowOther` and shows no Other row. Nothing breaks.
- [Moving focus on reveal could disorient screen-reader users] → Focus moves only on the user's own activation, and the field is labelled.

## Migration Plan

- Additive only, with no persisted-data migration. The record's opt-in is recomputed from live prompt metadata and is never persisted.
- Rollout: `npm run reload` (extension), restart the server, then `npm run build` and restart (client). Client, server and extension ship together in one release.
- Rollback: revert the commit. Answers were plain strings all along, so nothing on the wire or in stored data needs undoing.
