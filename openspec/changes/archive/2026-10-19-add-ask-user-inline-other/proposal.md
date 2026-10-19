## Why

Issue: https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/872

When the agent calls `ask_user` and none of the options fit, the dashboard card offers no way to give a custom answer. The user has to leave the card and type in the separate chat composer. In `packages/client/src/components/interactive-renderers/`, `SelectRenderer` and `MultiselectRenderer` show only the listed options, and `BatchRenderer` uses `InputComposer` only for `input` sub-questions.

## What Changes

- **select:** an inline "Other" radio with a text field inside the card. The typed text becomes `value`.
- **multiselect:** an "Other" checkbox with a text field. The text is added to `values[]` next to the checked options.
- **batch:** the same row on every select/multiselect sub-step.
- No separate input step and no round-trip through the composer.
- **Opt-in.** Other shows only on prompts that carry `allowOther: true` (`ctx.ui.select`/`multiselect` opts, batch sub-question). The dashboard `ask_user` tool sets it by default. Every other select stays byte-for-byte unchanged, because pi-flows branch selects, path-gate approval and ACP permission prompts all route on an exact option. Even when opted in, the row is hidden when an option is already an "Other" option (e.g. `"Other (describe)"`). Same rules on the chat card, the grouped panel and the question dialog.
- **Plain string answers.** No `{custom:true}` marker. A value is custom when it is not one of the options. The response encoding is unchanged. The request side gains only the additive opt-in key `metadata.allowOther: true`.
- The `ask_user` tool marks custom answers for the model in a note line before the unchanged `User responded: …` line. The history tool card shows custom answers.
- `validateQuestionAnswer` (REST / question-dialog road) accepts one non-blank custom value exactly when the shared enablement predicate is true, so the UI and the validator always agree.
- `ask_user` gains `allowOther` (default true; the top-level value fans out to batch sub-questions; the description says it is dashboard-only). `allowCustom` (the pi-flows name) is rescued as an alias and removed. The `ask-user-tool` main spec's stale body-level `oneOf` schema requirement is corrected to the shipped flat schema.
- `confirm`, `input` and `editor` get no "Other" row.
- New strings go through i18n (en, zh-CN, hu).

## Capabilities

### Modified Capabilities
- `interactive-renderers` — inline "Other" row on select, multiselect and batch; opt-in enablement and own-Other suppression; Escape in the question dialog; i18n; plain-text display.
- `prompt-answer-response-encoding` — custom values encode like options (pinned by tests).
- `ask-user-tool` — `allowOther` opt-in (default true) with batch fan-out, `allowCustom` alias, custom-answer result text, history card, flat-schema requirement (ADDED). REMOVED: the stale body-level `oneOf` requirement. MODIFIED: the result-shape rule (custom note line), "Argument rescue for batch shapes" and "prepareArguments preserves empty-args rejection" (flat-schema wording).
- `bridge-extension` — `allowOther: true` core metadata key on `ctx.ui.select`/`multiselect`/batch. MODIFIED: "Bridge registers ask_user tool" (stale file reference dropped; select passes the opt-in).
- `pending-question-stack` — REST answer validation accepts custom values on opted-in prompts.

## Non-goals

- Free text on `confirm`, `input` or `editor`.
- Changing pi-flows (external repo). Its prompts are not opted in, so they behave as today. A follow-up issue may let pi-flows opt its free-choice selects in.
- Enabling Other on any first-party select other than `ask_user`.
- Changing how the TUI renders `ask_user`.
- A length cap on custom text (existing `input` answers have none).
- Validating answers on the chat WebSocket road (`relayBrowserPromptResponse`). It never validated options; this stays as it is (pre-existing).

## Discipline Skills

- `review-code` — before commit.
- `security-hardening` — a checkpoint for the relaxed REST validator, which now accepts free text into opted-in answers. The input is untrusted. Verify:
  - custom text renders as plain text and reaches the model only JSON-encoded;
  - the validator rejects blank, padded and duplicate values;
  - non-opted prompts (path-gate, ACP) validate exactly as before.
  No new auth boundary: the same control-tier user can already answer `input` prompts.
- No perf or observability triggers.

## Impact

- Client:
  - `interactive-renderers/{SelectRenderer,MultiselectRenderer,BatchRenderer}.tsx` plus a new shared `OtherOption.tsx` and enablement helper.
  - `hooks/useMessageHandler.ts` and `hooks/useSessionState.ts` (pass the opt-in into params).
  - `components/questions/QuestionDialog.tsx` (params, Escape handling).
  - `components/tool-renderers/AskUserToolRenderer.tsx` (custom response row).
  - i18n locale files.
- Shared: `prompt-answer.ts` (validator plus the shared enablement predicate), `protocol.ts` (`BatchQuestion.allowOther?`), `question-types.ts` (`QuestionDetail.allowOther?`).
- Server: `questions/question-store.ts` (record keeps the opt-in), `questions/question-routes.ts` (validator call).
- Extension: `prompt-meta.ts` (core key, early-return guard), `bridge-handlers/ui-prompt-patch.ts`, `ask-user-tool.ts` (schema, rescue with boolean coercion, batch dispatch map, result text), `multiselect-polyfill.ts` (opts type).
- Unchanged, but verified to pass params through: `ChatView.tsx` inline card, `MultiAskPanel.tsx` grouped panel.
- Behaviour change: none for `ctx.ui.select`/`multiselect` callers that do not opt in. Every dashboard `ask_user` select/multiselect is opted in by default, so the LLM may now receive a custom answer, which is flagged in the result text and can be disabled with `allowOther: false`. Noted in the CHANGELOG.
- Accessibility: the "Other" text field is labelled, focuses when chosen, and works with the keyboard.
- Compatibility: answers stay plain strings, and older clients ignore the extra metadata key (no Other row). Client and server ship in the same package; a stale server rejects dialog custom answers with `400`. Rollback = revert.
